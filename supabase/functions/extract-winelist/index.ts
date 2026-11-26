// Supabase Edge Function: liest eine Weinkarte (PDF) mit Claude aus.
// Der Anthropic-Key liegt nur hier als Secret (ANTHROPIC_API_KEY), nie im Browser.
// Geprüft wird: angemeldet? Inhaber/Bearbeiter des Restaurants? Monatskontingent frei?
//
// Einrichtung: siehe ANLEITUNG.md, Abschnitt "PDF-Auslese per Server".
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5-5";
const MAX_B64 = 28 * 1024 * 1024; // ca. 20 MB PDF

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

function buildPrompt(known: string): string {
  return `Du erhältst die Weinkarte eines Restaurants als PDF. Erfasse JEDEN Wein, Schaumwein und Champagner (keine Speisen, keine alkoholfreien Getränke, keine Spirituosen, kein Bier) und ordne ihn seinem Herkunftsland und Anbaugebiet zu.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt, ohne Erklärtext und ohne Markdown-Codeblock, in genau dieser Form:
{"gebiete":[{"land":"Deutschland","gebiet":"Mosel","lat":49.9,"lon":7.1}],"weine":[{"g":0,"e":"Weingut","w":"2023 · Lage · Rebsorte","p":"38"}]}

Regeln:
- "land": der deutsche Landesname (z. B. Deutschland, Frankreich, Österreich, Italien, Spanien, Portugal, Südafrika, USA, Australien, Schweiz, Neuseeland, Argentinien).
- "gebiet": Anbaugebiet bzw. Appellation in gebräuchlicher deutscher Schreibweise (z. B. Burgund, Rhône, Piemont, Südtirol, Toskana). Wenn das Gebiet zu einem dieser bekannten Namen passt, genau diese Schreibweise verwenden: ${known}.
- "lat"/"lon": ungefähre Mitte des Anbaugebiets in Dezimalgrad (WGS84).
- Jedes Gebiet steht nur einmal in "gebiete"; "g" in "weine" ist der Index (ab 0) in diese Liste.
- "e": Erzeuger, Weingut bzw. Champagnerhaus. Nicht erkennbar: "–".
- "w": Jahrgang (falls vorhanden) · Lage oder Cuvée-Name · Rebsorte bzw. Stil, getrennt mit " · ". Nichts erfinden, nur Angaben aus der Karte verwenden.
- "p": Flaschenpreis als Zahl ohne Währungszeichen (z. B. "38" oder "38.5"). Bei mehreren Größen die 0,75-l-Flasche. Kein Preis: "".
- Reihenfolge wie in der Karte.`;
}

function buildNotesPrompt(): string {
  return `Du erhältst ein PDF mit Beschreibungen zu Weinen eines Restaurants (Geschmack, Aromen, Speiseempfehlungen, Hintergrundinfos).
Erfasse zu JEDEM Wein, der beschrieben wird, die Angaben aus dem PDF.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt, ohne Erklärtext und ohne Markdown-Codeblock, in genau dieser Form:
{"weine":[{"e":"Erzeuger","w":"Bezeichnung des Weins","aroma":"…","geschmack":"…","passt":"…","info":"…"}]}

Regeln:
- "e": Erzeuger bzw. Weingut, "w": Bezeichnung des Weins (Jahrgang, Lage, Rebsorte soweit angegeben), jeweils so wie im PDF.
- "aroma": Duft und Aromen; "geschmack": Geschmack, Stil, Struktur; "passt": Speiseempfehlungen; "info": sonstiges Wissenswertes (Region, Ausbau, Besonderheiten).
- Nur Angaben verwenden, die im PDF stehen. Nichts erfinden, nichts ergänzen. Fehlt eine Angabe: leerer Text "".
- Kurz und sachlich auf Deutsch, ggf. wörtlich aus dem PDF übernehmen.
- Reihenfolge wie im PDF.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json(405, { error: "Nur POST erlaubt." });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json(500, { error: "Der Server-Dienst ist nicht fertig eingerichtet (ANTHROPIC_API_KEY fehlt)." });

  // 1. Wer ruft auf?
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer /i, "");
  const userClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: u, error: uerr } = await userClient.auth.getUser(token);
  if (uerr || !u?.user) return json(401, { error: "Nicht angemeldet." });

  // 2. Eingabe prüfen
  let body: { restaurant_id?: string; pdf_base64?: string; known?: string; mode?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Ungültige Anfrage." });
  }
  const rid = String(body.restaurant_id ?? "");
  const pdf = String(body.pdf_base64 ?? "");
  const known = String(body.known ?? "").slice(0, 6000);
  if (!/^[0-9a-f-]{36}$/i.test(rid)) return json(400, { error: "Restaurant fehlt." });
  if (!pdf || pdf.length > MAX_B64) return json(400, { error: "PDF fehlt oder ist größer als 20 MB." });

  // 3. Darf dieser Nutzer für das Restaurant auslesen? (Regeln der Datenbank gelten: nur eigene Mitgliedschaft sichtbar)
  const { data: m } = await userClient.from("restaurant_members").select("role")
    .eq("restaurant_id", rid).eq("user_id", u.user.id).maybeSingle();
  if (!m || (m.role !== "owner" && m.role !== "editor")) return json(403, { error: "Dafür fehlt die Berechtigung." });

  // 4. Monatskontingent laut Tarif (atomar in der Datenbank gezählt, siehe Migration 003)
  const admin = createClient(url, service);
  const { data: allowed, error: qerr } = await admin.rpc("consume_quota", { p_restaurant: rid, p_kind: "import" });
  if (qerr) return json(500, { error: "Kontingent konnte nicht geprüft werden. Wurde Migration 003 ausgeführt?" });
  if (!allowed) return json(429, { error: "Das KI-Kontingent dieses Monats ist aufgebraucht (oder im Tarif nicht enthalten)." });

  // 5. Claude aufrufen und den Text direkt durchreichen (hält die Verbindung offen)
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 32000,
      stream: true,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf } },
          { type: "text", text: body.mode === "notes" ? buildNotesPrompt() : buildPrompt(known) },
        ],
      }],
    }),
  });
  if (!upstream.ok || !upstream.body) {
    await admin.rpc("refund_quota", { p_restaurant: rid, p_kind: "import" }); // Fehlversuch nicht anrechnen
    return json(502, { error: "Die KI-Auslese ist gerade nicht erreichbar (" + upstream.status + ")." });
  }

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buf = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line.startsWith("data:")) continue;
            try {
              const ev = JSON.parse(line.slice(5).trim());
              if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
                controller.enqueue(enc.encode(ev.delta.text));
              } else if (ev.type === "error") {
                controller.enqueue(enc.encode(JSON.stringify({ error: ev.error?.message ?? "Fehler der KI." })));
              }
            } catch { /* unvollständige Zeile ignorieren */ }
          }
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { ...cors, "content-type": "text/plain; charset=utf-8" } });
});
