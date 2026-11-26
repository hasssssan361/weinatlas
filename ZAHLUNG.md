# Zahlung (Stripe) – vorbereitet, bewusst noch nicht aktiviert

Stand: Die App kennt die Tarife schon technisch (`plan_limits`, `restaurants.plan`, Anzeige unter Verwalten → Tarif). Der Tarif kann nur vom Betreiber geändert werden (Trigger `protect_plan`). Es gibt **keine** Preise im Code und keine Zahlungsabwicklung.

## Warum noch nicht?
- Du hast Preise, Rechtstexte (AGB, AVV, Impressum) und Gewerbeanmeldung noch nicht festgelegt. Ohne sie darfst und solltest du keine Zahlungen annehmen.
- Stripe verlangt ein geprüftes Konto (Identität, Bankkonto). Das kann nur du einrichten.

## So wird es später gebaut (ca. 1 Tag Arbeit)
1. In Stripe: Produkte „Starter“, „Professional“, „Enterprise“ mit deinen Preisen anlegen, Testmodus nutzen.
2. Migration: Spalten `stripe_customer_id`, `subscription_status` an `restaurants` (nur service_role darf schreiben).
3. Edge Function `stripe-checkout`: Inhaber klickt „Tarif wählen“ → Checkout-Sitzung bei Stripe (Weiterleitung zur Stripe-Seite; Zahlungsdaten sehen nur Stripe).
4. Edge Function `stripe-webhook`: prüft die Stripe-Signatur und setzt `plan` per service_role nach `checkout.session.completed`, `customer.subscription.updated/deleted`.
5. Geheimnisse (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) nur als Supabase-Secrets, nie im Browser.
6. Tests im Stripe-Testmodus mit Teststeckkarten, danach erst Livemodus.

Bis dahin: Tarife manuell setzen, z. B. im Supabase-SQL-Editor:
```sql
update public.restaurants set plan = 'professional' where name = 'Name des Restaurants';
```
(`starter`, `professional` oder `enterprise`). Die Limits stehen in der Tabelle `plan_limits` und können dort angepasst werden.
