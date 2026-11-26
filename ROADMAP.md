# Weinatlas — Bestandsaufnahme und Roadmap zum SaaS-Produkt

Stand: 2026-11-26. Grundlage ist der Code im Repository (Commit `7de3e9c`) und die Tests, die dabei liefen.

## A. Ehrliche Bewertung

Weinatlas ist heute ein **funktionierender Pilot für zwei bekannte Kunden**, kein verkaufsfähiges SaaS-Produkt.
Die Kernarchitektur ist tragfähig: Mandantentrennung per Row Level Security, alle Zugriffe über geprüfte Datenbankfunktionen, Rollen, eine Karte mit eigenen Geodaten, ein PDF-Import mit Prüfschritt, ein Lernbereich. Die Datenbanklogik ist gegen echtes PostgreSQL getestet (inkl. Mandantentrennung).

Was **nicht** belegt ist: Der Betrieb gegen das echte Supabase-Projekt wurde noch nicht von mir gesehen (erster Login steht aus), die Server-Funktion für die KI-Auslese ist nie gelaufen, und es gibt keine automatisierten Tests für die Oberfläche.

## B. Vorhanden / teilweise / fehlend

| Bereich | Stand |
|---|---|
| Karte (Welt → Land → Gebiet → Weine, Lagen, Flächen) | **vollständig**, bleibt unverändert |
| Anmeldung, Passwort-Reset, Rollen (Inhaber/Bearbeiter/Mitarbeiter) | **vollständig** (Reset-Mail ungetestet gegen echtes Supabase) |
| Mandantentrennung (RLS + Funktionen) | **vollständig, getestet** |
| Weinverwaltung (anlegen, ändern, löschen, ausblenden) | **vollständig** |
| PDF-Import Weinkarte (Prüfschritt, Abgleich, Ersetzen) | **vollständig**, KI-Teil ungetestet |
| Geschmacks-PDF-Import mit Zuordnung | **vollständig**, nur mit simulierter Antwort getestet |
| Lernbereich (Karteikarten, 4 Quizarten, Nachschlagen, Bestenliste) | **vollständig**, aber Fragen nur aus Freitextnotizen |
| Team-Verwaltung | **vollständig** (Konten legt weiter der Betreiber in Supabase an) |
| Strukturiertes Geschmacksprofil (Körper, Säure, Tannine …) | **fehlt** (nur Freitext: Aroma/Geschmack/Passt zu) |
| Herkunftsstatus je Information, Quellen, Freigabe | **fehlt** |
| Intelligente Weinsuche (Filter, KI-Freitext, Match-Score) | **fehlt** |
| Lernaufgaben der Geschäftsführung, Fortschrittsübersicht | **fehlt** |
| Wein der Woche | **fehlt** |
| Import Excel/CSV/Word | **fehlt** |
| Automatische Recherche und Beschreibungserstellung | **fehlt** |
| Tarife, Kontingente, Freischaltung | **fehlt** (nur ein Monatszähler für PDF-Auslesen in der Server-Funktion) |
| Onboarding / Selbstregistrierung | **fehlt** (Konten legt der Betreiber an) |
| Datenschutz (Löschen/Export, Einwilligung, Auftragsverarbeitung) | **fehlt** |
| Tests Oberfläche / Ende-zu-Ende | **fehlt** |

## Sicherheitsbefunde und technische Schulden

1. **Google Fonts werden von Google-Servern geladen.** In Deutschland datenschutzrechtlich kritisch (IP-Übertragung ohne Einwilligung). → Schriften selbst ausliefern.
2. **Kundendaten in der Git-Historie** des öffentlichen Repositories (alte HTML-Dateien mit Weinkarten und Preisen). → Repo privat stellen oder Historie bereinigen.
3. **`create_restaurant` ist für jedes angemeldete Konto offen** und ohne Limit. Mit abgeschalteter Registrierung unkritisch, bei Selbstregistrierung braucht es Limit und Prüfung.
4. **`ensure_region` legt global sichtbare Gebiete an.** Gebiete sind mandantenübergreifend; ein Bearbeiter könnte Müll anlegen. → Gebiete eines Restaurants als „vorgeschlagen“ markieren, Prüfung durch den Betreiber.
5. **Sitzungstoken liegt im Browser-Speicher.** Üblich, aber bei einer XSS-Lücke angreifbar. Mitigation: Alle Ausgaben werden maskiert (`esc`), zusätzlich fehlt noch eine Content-Security-Policy.
6. **Server-Funktion für KI-Auslese:** CORS offen, Zählung des Kontingents nicht atomar (zwei gleichzeitige Aufrufe können das Limit um 1 überschreiten), „Verify JWT“ ausgeschaltet (Prüfung im Code).
7. **Keine Ratenbegrenzung** auf die Datenbankfunktionen (Supabase-Standardgrenzen gelten).
8. **Tests brauchen die privaten Importdateien**; Mandantentest-Daten sollten synthetisch sein.
9. `get_wine_list` liefert immer alle Weine (bis ca. 2000 unkritisch).

## C. Roadmap (Phasen aus dem Auftrag, mit Entscheidungen)

**Phase 2 – Technische Grundlage** *(Migration 003)*: strukturiertes Geschmacksprofil, Herkunftsstatus je Feld, Quellen, Freigabestatus, Lernaufgaben-Tabellen, Tarifmodell mit Limits, Rechte-Funktionen. Alles mandantenfähig und getestet.
**Phase 3 – Weinsuche:** Filter + Match-Score als reine Funktion im Browser (nachvollziehbar, testbar, ohne Kosten). KI-Freitext als Server-Funktion mit kleinem, günstigem Modell, das nur Suchkriterien als JSON zurückgibt und kein Wissen erfindet.
**Phase 4 – Training:** Lernaufgaben zuweisen, Fortschritt je Mitarbeiter, Fragen aus dem strukturierten Profil, Wein der Woche.
**Phase 5 – Anreicherung:** zuerst alles, was ohne Webzugriff geht (Excel/CSV, Beschreibungen aus *vorhandenen* Daten, Herkunftsstatus, Freigabe). Webrecherche zuletzt (siehe Risiken).
**Phase 6 – Verwaltungsbereich:** neue Funktionen in Übersichtsseite bündeln.
**Phase 7 – SaaS:** Einrichtungsassistent, Tarif-Freischaltung in Oberfläche, Selbstregistrierung mit Limits. Stripe nur vorbereiten.
**Phase 8 – Qualität:** Ende-zu-Ende-Tests, Datenschutz (Schriften lokal, Löschen/Export, Hinweise zu KI), Content-Security-Policy, Security-Review.
**Phase 9 – Marktreife.**

## D. Größte Risiken

**Technisch**
- **Automatische Webrecherche** ist der riskanteste Punkt: Nutzungsbedingungen und Urheberrecht vieler Weinseiten verbieten automatisiertes Auslesen; die Zuordnung eines Jahrgangs ist fehleranfällig. Realistisch ist nur eine Recherche über Quellen, die **ausdrücklich** erlaubt sind (z. B. offizielle Datenblätter des Weinguts, die der Betrieb selbst hochlädt oder verlinkt), mit Pflicht zur Freigabe. Eine reine KI-Behauptung „aus dem Netz“ ohne belegte Quelle wird als „nicht verifiziert“ gekennzeichnet.
- **KI darf nicht halluzinieren:** Beschreibungen nur aus belegten Feldern erzeugen und jedes Feld mit Herkunftsstatus führen.
- Supabase Free: Pausierung, Limits, keine Datensicherung auf Free-Ebene.

**Wirtschaftlich**
- KI-Kosten wachsen mit Nutzung; Kontingente je Tarif sind Pflicht.
- Datenqualität der Kundenweinkarten ist uneinheitlich; Prüfaufwand beim Onboarding bleibt.
- Ohne Auftragsverarbeitungsvertrag mit Supabase/Anthropic und Datenschutzhinweise ist ein Verkauf in Deutschland angreifbar.
- Wettbewerb (Weinkarten-Software, Sommelier-Apps) — Alleinstellung ist Lernbereich + Sortimentssuche.

## E. Reihenfolge der Umsetzung

1. Migration 003 (Datenmodell, Rechte, Tarife) + Tests ← **fertig und getestet** (`datenbank/migrations/003_…`, `datenbank/tests/t3_…`); Oberfläche dazu folgt in den Schritten 2–4
2. Weinsuche (Filter, Score, KI-Freitext)
3. Profile bearbeiten + Freigabe + Herkunftsstatus (Verwaltung)
4. Lernaufgaben + Fortschrittsübersicht
5. Datenschutz-Basis (Schriften lokal, CSP, Löschen/Export)
6. Excel/CSV-Import, Beschreibungserstellung aus belegten Daten
7. Einrichtungsassistent, Tarife in der Oberfläche
8. Wein der Woche
9. Webrecherche (nur mit erlaubten Quellen)
10. Zahlungsvorbereitung

## F. Zwingend für die erste verkaufsfähige Version

Zwingend: Weinsuche (Filter + Score), Geschmacksprofil mit Freigabe, Lernaufgaben, sichere Mandantentrennung (vorhanden), Datenschutz-Basis (Schriften, Löschen, Hinweise), Excel/CSV-Import, Einrichtungsassistent, Tarif-Limits, Handy-Tauglichkeit, Tests.
Später: KI-Freitextsuche (Filtersuche genügt für den Start), Wein der Woche, Webrecherche, Word-Import, Stripe, Mehrere Standorte.

## Tarifvorschlag (Entwurf, keine Preise)

| | Starter | Professional | Enterprise |
|---|---|---|---|
| Mitarbeiter | 5 | 25 | unbegrenzt |
| Weine | 300 | 1500 | unbegrenzt |
| KI-Auslesen/Monat | 3 | 20 | nach Vereinbarung |
| KI-Suche/Monat | 100 | 1000 | nach Vereinbarung |
| Lernaufgaben & Auswertungen | – | ja | ja |
| Recherche/Anreicherung | – | ja | ja |
| Standorte | 1 | 1 | mehrere |

Die Preise bestimmst du nach den tatsächlichen KI-Kosten pro Nutzung und deinem Markt.


---
## Stand 2026-11-26 (Update)
Umgesetzt und getestet: Suche (Filter), Profile mit Freigabe und Herkunftsstatus, regelbasierte Textvorschläge (ohne KI), Lernaufgaben, Wein der Woche,
Excel/CSV/PDF-Import, Datenschutz (Export, Löschung, eigene Schriften, CSP), Einrichtungs-Checkliste und Tarif-Anzeige unter Verwalten,
Restaurant-Limit pro Konto, KI-Suche „Wunsch als Satz“ (Server-Funktion `ai-search`, nicht live ausgeführt), Sicherheits-Audit (`t6_audit.mjs`).
Vorbereitet, nicht aktiv: Zahlung (ZAHLUNG.md), Rechtstexte (rechtliches/).
Bewusst NICHT gebaut: automatische Web-Recherche. Gründe: Urheberrecht und Nutzungsbedingungen der Quellen, Qualitätsrisiko (falsche Weindaten wären ein Produktfehler),
nicht automatisiert testbar. Stattdessen: Quellen manuell hinterlegen (Link, Art, Datum), Profile selbst pflegen oder aus eigenen Dokumenten importieren,
Texte regelbasiert vorschlagen. Eine spätere Recherche-Funktion nur für ausdrücklich erlaubte Quellen und mit Pflicht-Freigabe.
Offen: Rechtstexte final, Preise, Stripe-Anbindung, Einrichtung der Server-Funktionen, Live-Test von PDF-Auslesen und KI-Suche, Entscheidung zum öffentlichen Repo (Kundendaten in der Historie).
