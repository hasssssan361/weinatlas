# Weinatlas — Projektstand

Stand: siehe Datum dieser Datei. Diese Notiz fasst zusammen, was bisher entschieden und gebaut wurde, damit die Arbeit in Claude Code nahtlos weitergeht.

## Worum es geht

Ein interaktiver "Weinatlas" für **Chefs Warehouse Hamburg**: eine Karte, die von Hamburg aus zu den Herkunftsländern der Wein-/Champagnerkarte führt, dort in die einzelnen Anbaugebiete hineinzoomt und pro Gebiet die Erzeuger/Weine (mit Preisen) zeigt. Ausgangsmaterial war die vollständige Wein- & Champagnerkarte von Chefs Warehouse (PDF), die vollständig erfasst wurde (alle Länder, Anbaugebiete, Erzeuger, Weine).

Langfristiges Ziel: daraus perspektivisch ein **SaaS-Produkt** für mehrere Restaurants machen (siehe Abschnitt "Größere Zukunftsplanung" unten) — aktuell aber bewusst zurückgestellt, um zuerst eine einfache, funktionierende Version für Chefs Warehouse selbst zu haben.

## Design-Sprache (unbedingt beibehalten)

- Dunkles "Wein-Atlas"-Thema: Farben `--ink:#100d0b`, `--panel:#1c1613`, `--gold:#c9a35d`, `--wine:#7c2434`, Parchment-Textfarbe `#eee3d2`
- Schriften: Fraunces (Headlines, kursiv), Inter (Fließtext), IBM Plex Mono (Preise/Labels) — via Google Fonts
- Ton: edel, reduziert, wie ein gedrucktes Weinbuch, nicht wie eine Standard-Web-App

## Technischer Stand der Karte (bereits fertig, funktioniert)

1. **Basis-Ansicht:** radiale "Hamburg-Karte" — Hamburg im Zentrum, gestrichelte Linien zu neun Länder-Pins (Größe je nach Anzahl Positionen). **Bleibt unverändert**, das ist bewusst so festgelegt.
2. **Klick auf ein Land:** Zoom-Animation in eine Länderansicht.
3. **Länderansicht:** zeigt **echte, eingebettete Landesgrenzen** (aus einer vom Nutzer selbst besorgten GeoJSON-Datei, `custom.geo.json`, Quelle: geojson-maps.kyd.au, Auflösung "Medium"). Keine Kartenkacheln, kein Leaflet, **keine Laufzeit-Internetabhängigkeit** — das war eine bewusste, mehrfach bestätigte Entscheidung.
4. **Anbaugebiete** sind als Punkte an echten Koordinaten (lat/lon) auf der Länderkarte platziert.
5. **Lesbarkeit bei dichten Clustern** (z. B. Kapregion: Stellenbosch, Paarl, Franschhoek, Walker Bay, Hemel-en-Aarde liegen eng beieinander): **Hover zeigt den Gebietsnamen** als Tooltip, **Klick öffnet die Weinliste** im Seitenpanel. Vorherige Versuche mit permanent sichtbaren Kreisen/Labels führten zu Überlappung — deshalb diese Lösung.
6. **Weindaten:** vollständig, alle neun Länder (Deutschland, Frankreich, Österreich, Italien, Spanien, Portugal, Südafrika, USA, Australien), alle Anbaugebiete, alle Erzeuger/Weine mit Preisen — fest im JavaScript der Datei (`const DATA = {...}`).

**Wichtiger technischer Kompromiss, bewusst in Kauf genommen:** Aktuell stehen die Weindaten weiterhin im sichtbaren HTML/JavaScript-Quelltext — das Login (siehe unten) blendet sie im Browser nur per CSS aus, verhindert aber **nicht**, dass sie über "Seite untersuchen"/"Quelltext anzeigen" auslesbar sind. Das ist der nächste offene Punkt (siehe "Nächste Schritte").

## Login (gerade neu eingebaut)

- Verwendet **Supabase** (Backend-as-a-Service: Datenbank + Authentifizierung), kostenloser Plan.
- Ein einzelner Nutzer wurde manuell in Supabase angelegt (unter "Authentication → Users").
- Supabase-Projekt-URL: `https://txtmyvmpxtnxuyyflaws.supabase.co`
- Der "anon public" Key ist bereits im Code hinterlegt — **das ist normal und sicher so vorgesehen**, dieser Schlüssel ist für die öffentliche Nutzung im Frontend gedacht (nicht mit einem geheimen Schlüssel verwechseln).
- Login-Ablauf: Login-Maske erscheint zuerst, nach erfolgreicher Anmeldung (`supabase.auth.signInWithPassword`) wird der Weinatlas sichtbar; Sitzung bleibt nach Neuladen bestehen; "Abmelden"-Button oben rechts.
- **Bekannte Einschränkung:** siehe oben — Login schützt aktuell nur die Ansicht, nicht die im Quelltext liegenden Daten.

## Hosting / Repository

- GitHub-Repository `weinatlas` unter dem Account des Nutzers angelegt, **öffentlich** (GitHub Pages erfordert das im kostenlosen Plan).
- Lokaler, mit GitHub verbundener Ordner: `C:\Users\hscan\Desktop\Git clone\weinatlas`
- Geplanter Hosting-Weg: **GitHub Pages** (kostenlos), Datei muss dafür `index.html` heißen.
- Git ist lokal installiert und eingerichtet (`user.name`/`user.email` gesetzt, Standardeinstellungen bei allen Installationsfragen übernommen).
- Bereits mehrere Versionsstände als `weinatlas 1.html` bis `weinatlas 5.html` sowie `weinatlas.html`/`index.html` im Ordner — **diese sollen jetzt in Claude Code verglichen und zu einer sauberen Endversion zusammengeführt werden.** Das war der unmittelbare Anlass für den Wechsel zu Claude Code.
- Zusätzlich im Ordner: `custom.geo.json` (Grenzdaten), ein `json`-Unterordner, ein `notizen`-Unterordner (Inhalt bisher nicht geprüft — vor jedem `git push` sicherstellen, dass dort nichts Privates/Sensibles liegt, da das Repository öffentlich ist).

## Offene, im Gespräch bereits diskutierte Entscheidungen

- **Datenmodell für eine echte Datenbank** (Tabellen etwa: `nutzer`, `laender`, `anbaugebiete`, `erzeuger`, `weine`, jeweils mit Beziehungen) wurde angekündigt, aber **noch nicht im Detail ausgearbeitet** — das war der empfohlene nächste Schritt vor dem Wechsel zu Claude Code.
- Ziel für den nächsten technischen Schritt: Weindaten aus dem sichtbaren Code in eine Supabase-Tabelle verschieben und erst nach Login von dort laden — löst den oben genannten Sicherheits-Kompromiss.

## Größere Zukunftsplanung (bewusst zurückgestellt, aber nicht vergessen)

Der Nutzer verfolgt langfristig einen SaaS-Gedanken (Weinatlas als Dienstleistung für mehrere Restaurants, ggf. kostenpflichtig). Besprochener Stufenplan dafür:

0. Datenmodell fertig ausarbeiten
1. Backend/Datenbank mit echtem Login für **nur Chefs Warehouse**, aber von Anfang an mit einem "gehört zu Restaurant X"-Feld in jeder Tabelle angelegt, damit späteres Erweitern kein kompletter Umbau wird
2. Mandantenfähigkeit (mehrere Restaurants) aktivieren
3. Bezahlfunktion/Vermarktung

Empfohlene Reihenfolge war: zuerst Stufe 1 sauber und einfach für Chefs Warehouse fertigstellen, SaaS-Ausbau erst danach angehen — nicht aus Zeitdruck vorziehen.

Hintergrund des Nutzers (relevant für Tonfall/Empfehlungen): 10+ Jahre Gastronomie-Erfahrung, strebt Selbstständigkeit an, bevorzugt Modelle mit direktem Kundenkontakt statt Content-Business, hat 30–40 Std./Woche Zeit zum Aufbau, möchte die Fähigkeit erlernen, Machbarkeitsstudien selbstständig durchzuführen.

## Empfohlene nächste Schritte in Claude Code

1. Alle sechs HTML-Versionen sichten, Unterschiede identifizieren, zu **einer** sauberen Datei zusammenführen (Basis: die zuletzt beschriebene Funktionalität oben).
2. Datenmodell (Schritt 0 aus dem SaaS-Plan) konkret ausarbeiten.
3. Weindaten in eine Supabase-Tabelle verschieben, Frontend so umbauen, dass es sie nach Login von dort abruft statt aus eingebettetem JavaScript.
4. Finale Datei als `index.html` ins Repository, GitHub Pages aktivieren, Ergebnis live testen.
