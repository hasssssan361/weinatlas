# Datenschutzerklärung – Vorlage für Weinatlas

> **Wichtig:** Das ist eine fachlich vorbereitete Vorlage, **keine Rechtsberatung**. Alle Felder in `[eckigen Klammern]` musst du ausfüllen.
> Bevor du Weinatlas an Kunden verkaufst, lass diesen Text und den Auftragsverarbeitungsvertrag (AVV) von einer Anwältin / einem Anwalt oder einem Datenschutzgenerator prüfen.

## 1. Verantwortlicher
[Dein Name / Firma], [Straße Hausnummer], [PLZ Ort], E-Mail: [Adresse]

Für die Daten der Mitarbeiter eines Restaurants ist in der Regel das Restaurant der Verantwortliche und du der Auftragsverarbeiter (dann ist ein AVV nach Art. 28 DSGVO nötig).

## 2. Welche Daten werden verarbeitet?
| Daten | Zweck | Rechtsgrundlage |
|---|---|---|
| E-Mail-Adresse, Passwort (nur als Hash bei Supabase) | Anmeldung, Konto | Art. 6 Abs. 1 lit. b DSGVO (Vertrag) |
| Anzeigename | Bestenliste im Team | lit. b / berechtigtes Interesse (lit. f) |
| Lernfortschritt, Quiz-Ergebnisse, Lernaufgaben | Mitarbeiterschulung | lit. b / lit. f (Arbeitgeber: Beschäftigtendatenschutz prüfen, § 26 BDSG) |
| Weinkarte, Preise, Geschmacksprofile, Notizen | Kern der Anwendung (Daten des Restaurants) | lit. b |
| IP-Adresse, technische Zugriffsdaten | Auslieferung der Seite, Sicherheit | lit. f |

Schriftarten werden selbst ausgeliefert; es erfolgt keine Verbindung zu Google Fonts. Es werden keine Tracking- oder Werbe-Cookies verwendet. Gespeichert wird nur die Anmelde-Sitzung im Browser (technisch notwendig).

## 3. Empfänger / Dienstleister
- **Supabase** (Datenbank, Anmeldung): Serverstandort [prüfen: Region deines Supabase-Projekts, z. B. Frankfurt/EU], AVV und Standardvertragsklauseln abschließen.
- **GitHub Pages** (Auslieferung der Webseite): GitHub Inc. (USA); dabei wird die IP-Adresse verarbeitet. [Prüfen: Alternative mit EU-Hosting erwägen.]
- **Anthropic** (nur bei Nutzung von „PDF auslesen“ und „Wunsch als Satz“): übertragen werden das hochgeladene PDF bzw. der eingegebene Satz, **keine** Konto- oder Personendaten. Nur Inhaber/Bearbeiter lösen das PDF-Auslesen aus. [AVV / Datenschutzbedingungen von Anthropic prüfen; Drittlandübermittlung USA beachten.]
- [Zahlungsdienstleister, falls aktiviert, z. B. Stripe]

## 4. Speicherdauer
Konto- und Lerndaten bis zur Löschung des Kontos durch die Person selbst (Konto-Menü → „Konto löschen“) oder durch Kündigung des Restaurants. Wein- und Restaurantdaten bis zur Beendigung des Vertrags. [Aufbewahrungsfristen für Rechnungsdaten ergänzen.]

## 5. Rechte der Betroffenen
Auskunft und Datenübertragbarkeit (Konto-Menü → „Meine Daten herunterladen“), Berichtigung, Löschung (Konto-Menü → „Konto löschen“), Einschränkung, Widerspruch, Beschwerde bei der Aufsichtsbehörde ([zuständige Landesdatenschutzbehörde]).

## 6. KI-Funktionen (Transparenz)
- „PDF auslesen“: eine KI liest Weine und Preise aus einem hochgeladenen PDF. Das Ergebnis wird **immer vor dem Speichern von einem Menschen geprüft**.
- „Wunsch als Satz“: eine KI übersetzt einen Satz in Suchfilter. Gesucht wird danach nur im eigenen Sortiment; die KI erfindet keine Weine und keine Eigenschaften.
- „Texte vorschlagen“ ist regelbasiert (keine KI) und nutzt nur ausgefüllte Angaben.
- Geschmacksprofile werden erst nach Freigabe durch das Restaurant für Mitarbeiter sichtbar. Die Herkunft jedes Feldes (vom Restaurant eingegeben, automatisch erzeugt) wird gespeichert.

## 7. Sicherheit
Verschlüsselte Übertragung (HTTPS), strikte Trennung der Restaurants auf Datenbankebene (Row Level Security), Rollen (Inhaber / Bearbeiter / Mitarbeiter), keine KI-Schlüssel im Browser der Nutzer.
