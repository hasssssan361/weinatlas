# Weinatlas — Einrichtung und Betrieb

Der Weinatlas besteht aus **einer einzigen Webseite** (`index.html`, gebaut aus `app/`) und einer **Datenbank bei Supabase**.
Alles läuft im kostenlosen Rahmen (GitHub Pages + Supabase Free). Kosten entstehen nur, wenn du die KI-Auslese von PDFs nutzt (Anthropic-API, siehe Abschnitt 5).

Was die Seite kann:

| Bereich | Wer | Funktion |
|---|---|---|
| **Karte** | alle | Weltkarte → Land → Anbaugebiet → Erzeuger/Weine mit Preisen, Lagen auf Klick |
| **Lernen** | alle | Karteikarten (Wiederholung nach Leitner), Quiz „Woher kommt der Wein?“, „Wer macht den Wein?“, Blind-Verkostung, „Passt zu …“, Nachschlagen, Bestenliste |
| **Verwalten** | Inhaber, Bearbeiter | Weine bearbeiten/anlegen/löschen, Weinkarte als PDF importieren, Geschmacks-PDF importieren, Team verwalten (nur Inhaber) |

Die Daten jedes Restaurants sind durch Zugriffsregeln in der Datenbank getrennt: Ein Mitarbeiter sieht nur sein Restaurant, nur Inhaber/Bearbeiter dürfen Weine ändern.
Die Weindaten stehen **nicht** mehr im Quelltext der Seite, sondern werden erst nach der Anmeldung aus der Datenbank geladen.

---

## 1. Datenbank einrichten (einmalig, ca. 10 Minuten)

Supabase-Dashboard → dein Projekt → **SQL Editor** → „New query“. Die folgenden Dateien nacheinander einfügen und mit **Run** ausführen.
Fehlermeldungen wie „already exists“ bei den ersten Dateien sind harmlos, wenn du sie früher schon ausgeführt hast.

| Reihenfolge | Datei | Zweck |
|---|---|---|
| 1 | `datenbank/schema.sql` | Tabellen und Zugriffsregeln (falls noch nicht geschehen) |
| 2 | `datenbank/migrations/002_api.sql` | Funktionen für die App, Lernfortschritt, Team (darf mehrfach laufen) |
| 3 | `datenbank/import_stammdaten.sql` | Anbaugebiete, Gebietsflächen, Lagen |
| (nach den Importen) | `datenbank/migrations/003_profile_tasks_plans.sql` | Geschmacksprofil, Freigabe, Lernaufgaben, Wein der Woche, Tarife (darf mehrfach laufen; bestehende Restaurants werden auf den Tarif „enterprise“ gesetzt) |
| (danach) | `datenbank/migrations/004_datenschutz.sql` | Daten herunterladen und Konto löschen (Konto-Menü in der App); darf mehrfach laufen |
| (danach) | `datenbank/migrations/005_restaurant_limit.sql` | Höchstens 3 Restaurants pro Konto (Missbrauchsschutz); darf mehrfach laufen |
| 4 | `datenbank/privat/import_chefs_warehouse.sql` | Weinkarte Chefs Warehouse |
| 5 | `datenbank/privat/import_estancia.sql` | Weinkarte Estancia Steakhaus |
| 6 | `datenbank/privat/import_zugang.sql` | verknüpft **dein Konto** mit den Restaurants (vorher `DEINE@EMAIL.DE` durch deine Login-E-Mail ersetzen) |

Die Dateien in `datenbank/privat/` liegen nur auf deinem Rechner (stehen in `.gitignore`), weil sie Kundendaten enthalten.
Datei 3 ist groß (Gebietsflächen); falls der SQL-Editor sie nicht in einem Stück annimmt, in zwei Hälften ausführen.

## 2. Konten und Anmeldung

Supabase → **Authentication**:

1. **Sign In / Providers → Email**: „Allow new users to sign up“ **ausschalten**. Sonst kann sich jeder ein Konto anlegen und sich ein eigenes Restaurant erstellen.
2. **Users → Add user → Create new user**: E-Mail und Passwort eintragen, „Auto Confirm User“ anhaken. Das machst du für dich und später für jeden Kollegen.
3. **URL Configuration**: *Site URL* = `https://hasssssan361.github.io/weinatlas/` (damit der Link in der „Passwort vergessen“-Mail zurück zur Seite führt).

Neue Mitarbeiter ordnest du danach in der App zu: **Verwalten → Team → Person hinzufügen** (E-Mail des Kontos + Rolle).
Rollen: *Inhaber* (alles inkl. Team), *Bearbeiter* (Weine pflegen), *Mitarbeiter* (Karte ansehen und lernen).

## 3. Seite veröffentlichen

Die Seite wird aus den Quelldateien in `app/src` zusammengebaut:

```bash
python app/build.py --out ../index.html
```

Danach `index.html` committen und pushen; GitHub Pages veröffentlicht sie automatisch unter
`https://hasssssan361.github.io/weinatlas/`. Wer die Seite ändern will, ändert die Dateien in `app/src` und baut neu.

## 4. Supabase wach halten (Free-Plan)

Gratis-Projekte werden nach etwa 7 Tagen ohne Zugriff pausiert. Der Workflow `.github/workflows/supabase-keepalive.yml` ruft alle 3 Tage die Datenbank an.
Dafür in GitHub → Repository → **Settings → Secrets and variables → Actions** zwei Secrets anlegen:

* `SUPABASE_URL` = `https://txtmyvmpxtnxuyyflaws.supabase.co`
* `SUPABASE_ANON_KEY` = der *publishable* Key (`sb_publishable_…`, steht unter Project Settings → API Keys)

Nie den *secret* Key irgendwo eintragen, der nicht ausdrücklich dafür vorgesehen ist.

## 5. PDF-Auslese (Weinkarte und Geschmacks-PDF)

Die Auslese macht Claude (Anthropic-API). **Das ist der einzige Teil, der Geld kostet** — grob einige Cent pro PDF. Es gibt zwei Wege:

**A) Eigener Key im Browser (sofort nutzbar, einfach).**
Im Import-Dialog den eigenen Anthropic-API-Key eintragen (`console.anthropic.com` → API Keys, mit Guthaben aufladen). Der Key bleibt im Browser, die PDF geht direkt an Anthropic.
Geeignet für dich als Betreiber.

**B) Server-Dienst (Kunden laden selbst hoch, ohne eigenen Key).**
Der Key liegt dann bei dir in Supabase; jedes Restaurant hat ein Monatskontingent (Standard: 10 Auslesen), damit Kosten planbar bleiben.
Einrichtung (Dashboard, ca. 10 Minuten):

1. Migration `003_profile_tasks_plans.sql` muss gelaufen sein (Kontingentzähler).
2. Supabase → **Edge Functions → Deploy a new function → Via Editor**, Name exakt `extract-winelist`, Inhalt von `supabase/functions/extract-winelist/index.ts` einfügen, deployen.
3. In den Einstellungen dieser Funktion **„Verify JWT“ ausschalten** (die Funktion prüft die Anmeldung selbst).
4. **Edge Functions → Secrets**: `ANTHROPIC_API_KEY` = dein Anthropic-Key. Optional `ANTHROPIC_MODEL`. Das Monatskontingent kommt aus dem Tarif des Restaurants (Tabelle `plan_limits`, Migration 003).

Ohne Schritt B zeigt der Import-Dialog einen Hinweis und bietet Weg A an.

Wichtig nach jedem Import: Zuordnung in der Prüfansicht kurz ansehen. Die KI kann sich bei Gebieten irren; Land und Gebiet lassen sich dort ändern.
Bei einer erneuten Weinkarte erkennt der Import vorhandene Weine (gleicher Erzeuger + gleiche Bezeichnung): Preise werden aktualisiert, Notizen und Lernfortschritt bleiben erhalten; „Bisherige Karte ersetzen“ entfernt Weine, die nicht mehr auf der Karte stehen.

## 6. Geschmacksnotizen für die Lern-App

* **Einzeln**: Verwalten → Wein bearbeiten → „Geschmack & Wissen“.
* **Per PDF**: Verwalten → „Geschmacks-PDF importieren“. Claude liest Aromen, Geschmack und Speiseempfehlungen aus; die App ordnet sie den Weinen zu (Erzeuger + Bezeichnung). Unsichere Zuordnungen sind markiert und lassen sich im Auswahlfeld korrigieren.

Blind-Verkostung und „Passt zu …“ schalten sich frei, sobald mindestens 4 Weine entsprechende Notizen haben.

## 7. Lokal testen (ohne Supabase)

Für Entwickler: `datenbank/tests` enthält Tests mit einer eingebetteten PostgreSQL-Datenbank (PGlite) und einen Testserver, der Supabase nachbildet.

```bash
cd datenbank/tests
npm install
node t2_rpc.mjs            # Datenbankfunktionen und Zugriffsregeln prüfen
cd ../.. && python app/build.py --test
node datenbank/tests/ui-server.mjs   # dann http://localhost:54321 öffnen
```

Testkonten dort: `chef@test.de`, `kellner@test.de`, `cw@test.de` (Passwort `test1234`). Der Test setzt die privaten Import-Dateien voraus.

## 8. Datenschutz und Sicherheit — was du wissen solltest

* Das GitHub-Repository ist **öffentlich**. Der *publishable* Key in der Seite ist dafür gedacht; geschützt wird über die Zugriffsregeln der Datenbank. Kundendaten (`datenbank/privat/`) gehören nie ins Repository.
* In der **Git-Historie** liegen die älteren Dateien (`weinatlas 8.html`, `weinatlas 9 estancia.html` …) mit Weinkarten und Preisen. Wenn das nicht öffentlich sein soll: Repository auf *privat* stellen (dann braucht GitHub Pages einen bezahlten Plan; Alternative: Cloudflare Pages oder Netlify, beide gratis) oder die Historie bereinigen.
* Registrierungen abschalten (Abschnitt 2), sonst kann sich jeder ein Konto und ein eigenes Restaurant anlegen.
* Passwörter ändert jeder selbst im Konto-Menü (oben rechts).
* Free-Plan-Grenzen von Supabase (500 MB Datenbank, begrenzte Nutzer-/Datenmenge) reichen für viele Restaurants; bei Wachstum auf den bezahlten Plan wechseln.

## Weine aus Excel oder CSV importieren (kostenlos, ohne KI)
Verwalten → „Weinkarte importieren“ → oben „Excel oder CSV“. Erste Zeile = Spaltennamen, z. B. `Erzeuger, Wein, Jahrgang, Rebsorte, Preis, Land, Region` (nur „Wein“ ist Pflicht; „Name“, „Bezeichnung“, „Weingut“, „Gebiet“ usw. werden ebenfalls erkannt). Es wird das erste Tabellenblatt gelesen; das alte Format .xls bitte als .xlsx oder CSV speichern. Danach folgt dieselbe Prüfung wie beim PDF-Import.

## KI-Suche „Wunsch als Satz“ einrichten (optional, kostet pro Suche Bruchteile eines Cents)
Ohne diese Einrichtung funktioniert die Filtersuche normal; das Satzfeld meldet dann „noch nicht eingerichtet“.
1. Voraussetzung: der Server-Dienst fürs PDF-Auslesen ist eingerichtet (gleicher `ANTHROPIC_API_KEY`-Secret, siehe oben).
2. Edge Function anlegen: `supabase/functions/ai-search/index.ts` als neue Funktion `ai-search` deployen (gleiches Vorgehen wie `extract-winelist`).
3. Optional Secret `ALLOWED_ORIGIN` = `https://hasssssan361.github.io` (erlaubt nur diese Seite) und `ANTHROPIC_SEARCH_MODEL` (Standard: kleines, günstiges Modell).
4. Das Monatskontingent kommt aus dem Tarif (`plan_limits.ai_search_month`: Starter 100, Professional 1000, Enterprise unbegrenzt).

## Tarif eines Restaurants ändern (bis Zahlung eingerichtet ist, siehe ZAHLUNG.md)
Im Supabase-SQL-Editor: `update public.restaurants set plan = 'professional' where name = 'Name';` (`starter`, `professional`, `enterprise`). Neue Restaurants starten mit `starter`.

## Texte für Datenschutz, Impressum, AGB
Siehe Ordner `rechtliches/` (Vorlagen, bitte prüfen lassen).

## Tests
`datenbank/tests`: `npm install`, dann `node t2_rpc.mjs`, `t3_…`, `t4_…`, `t5_…`, `t6_audit.mjs` (Sicherheits-Audit). App-Logik: `node app/tests/searchcore.test.mjs`, `tableparse.test.mjs`, `textgen.test.mjs`.
