## Fridge Stock (PWA)

Mobile-first Web-App (PWA) zur Verwaltung von Getränkebeständen in **mehreren Kühlschränken und Lagerplätzen**.

### Setup

- **1) Supabase Projekt erstellen**
  - Erstelle ein Supabase-Projekt (nur DB, kein Auth).
  - Öffne den SQL Editor und führe `supabase/schema.sql` aus.

- **2) Env Vars setzen**
  - Kopiere `.env.local.example` nach `.env.local`
  - Trage `NEXT_PUBLIC_SUPABASE_URL` und `NEXT_PUBLIC_SUPABASE_ANON_KEY` ein
  - Für serverseitige Jobs (Backup) zusätzlich:
    - `SUPABASE_SERVICE_ROLE_KEY`
    - `CRON_SECRET` (für Vercel Cron — Vercel sendet `Authorization: Bearer …`)
    - `ADMIN_BACKUP_CODE` (verpflichtend für `/api/backup` POST aus dem UI)
    - `SERVER_ACTION_SECRET` (verpflichtend für geschützte Admin-Aktionen über API)
  - Optional:
    - `NEXT_PUBLIC_ADMIN_CODE` (Override des clientseitigen Admin-Toggle-Codes,
      Default `1402`. Landet im Browser-Bundle — also kein Geheimnis, aber rotierbar.)
    - `RESEND_API_KEY` + `BACKUP_EMAIL` für Email-Backups
    - Supabase Storage Bucket `backups` (privat) für tägliche Backup-CSV-Uploads
    - Kunden-Chat (nur `/order`, unabhängig vom Bestellsystem):
      - `CUSTOMER_CHAT_AI=1` aktiviert den smarten Kunden-Chat
      - `OPENAI_API_KEY` (Pflicht, sobald `CUSTOMER_CHAT_AI=1`)
      - `OPENAI_MODEL` optional (Default `gpt-4o-mini`)
      - `CUSTOMER_CHAT_ASSISTANT_ID` (Option A): Wenn gesetzt, nutzt /order OpenAI **Assistants v2**
        (Threads/Runs + Tool-Calls) für flexiblere Gespräche. Ohne diese Env-Var nutzt der Chat
        weiterhin die leichtere Chat-Completions-Variante als Fallback.
      - `BAKERY_HOMEPAGE_URL` (optional): offizielle Homepage, die der Chat bei Fragen ausgibt
      - `BAKERY_FACEBOOK_URL` (optional): offizielle Facebook-Seite, die der Chat bei Fragen ausgibt

- **3) Starten**

```bash
npm install
npm run dev
```

### Login

- **Name + Passwort** gegen Tabelle `users`
- Session bleibt via **localStorage** eingeloggt

### QR Codes

- Inhalt pro Location: `loc_<id>`
- Admin → Tab **QR** → Download PNG

### Bestellvorschlag (klassisch)

Es gibt genau **eine** Formel für Bestellvorschläge — den klassischen
7-Tage-Verbrauch aus `inventory_history`. Siehe Abschnitt
„Bedarf · 10-Tage-Rückblick" weiter unten für die Normalisierung bei älteren
Inventuren.

> Die früher vorhandene parallele „KI-Verbrauchsprognose" (Tabellen
> `ai_consumption`, `ai_consumption_jobs`, Trigger, `/api/ai/consumption/*`,
> zugehöriger Vercel-Cron und Admin-Toggle „KI-Prognose") wurde entfernt.
> Wer die Migration `supabase/ai_consumption_jobs_trigger.sql` früher
> ausgeführt hat, führt einmalig `supabase/retire_ai_consumption.sql` aus,
> um Trigger, Funktion und Tabellen zu entfernen.

### Tägliches Backup

Es laufen zwei unabhängige Backups parallel:

**1. CSV-Backup (Vercel Cron, 02:00 UTC)**

- `vercel.json` ruft `/api/backup` einmal täglich um **02:00 UTC** auf
  (GET, mit `Authorization: Bearer $CRON_SECRET`).
- Backup wird als CSV erstellt und (a) in den Supabase-Storage-Bucket `backups`
  hochgeladen und (b) optional per Email versendet (wenn `RESEND_API_KEY`
  gesetzt ist).
- Voraussetzungen:
  - Supabase Storage → Bucket `backups` einmalig anlegen (privat).
  - Env-Vars: `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`,
    `NEXT_PUBLIC_SUPABASE_URL`. Email zusätzlich: `RESEND_API_KEY`,
    `BACKUP_EMAIL`, optional `RESEND_FROM`.
- Zweck: lesbares, importierbares Format (Excel, manuelle Inspektion).
- Limit: nur Daten, kein Schema. Aktuell **kein** vollständiger Restore möglich.

**1b. Manueller Download aus der Admin-Seite**

- Admin-Übersicht → Button **"Backup herunterladen"** → Backup-Code eingeben →
  CSV landet sofort im Download-Ordner. Kein Email/Bucket nötig.
- Nutzt intern `POST /api/backup` mit `{ download: true }`.

**2. pg_dump-Backup (GitHub Actions, 02:30 UTC)**

- `.github/workflows/db-backup.yml` ruft `pg_dump` täglich um **02:30 UTC**
  auf und speichert das Ergebnis als GitHub-Artifact (Retention: 30 Tage).
- Format: `--format=custom`, kompakt + selektiv via `pg_restore` wiederherstellbar.
- Setup einmalig:
  - GitHub Repo → Settings → Secrets and variables → Actions → New repository secret
    - Name: `DATABASE_URL`
    - Value: Connection-String aus Supabase Dashboard → Project Settings →
      Database → Connection string → URI. Port **5432** verwenden, NICHT den
      Pooler-Port 6543.
- Manueller Trigger via Actions-Tab → "DB Backup (pg_dump)" → "Run workflow".
- Restore lokal:
  ```bash
  pg_restore --clean --if-exists --no-owner --no-privileges \
    --dbname="$DATABASE_URL" backup-YYYY-MM-DD.dump
  ```
- Zweck: vollständiges, restore-fähiges Disaster-Recovery-Backup.

**2b. Manueller pg_dump (lokal)**

```bash
./scripts/backup.sh
```

- Liest `DATABASE_URL` aus Env oder aus `.env.local`.
- Output: `./backups/backup-YYYY-MM-DD_HH-MM-SS.dump` (Verzeichnis ist gitignored).
- Voraussetzung einmalig: `brew install libpq && brew link --force libpq`.

### Audit-Log

- Tabelle `admin_audit_log` (Migration: `supabase/admin_audit_log.sql`).
- Geschriebene Aktionen (Server-Routes mit `SERVER_ACTION_SECRET`):
  `orders.process_open`, `orders.archive_location`, `orders.update_items`,
  `orders.confirm_delivery`, `inventory.shrinkage.book`, `inventory.shrinkage.ignore`.
- Eintrag enthält Action, Actor (Header `x-actor` oder IP), Payload, Result,
  ok/error. Lesbar im Supabase-Dashboard.

### Schwund · Lager (Inventur-Differenzen)

Nach jeder Lager-Inventur kann im Admin kontrolliert werden, ob der gezählte
Bestand mit dem erwarteten Bestand übereinstimmt. Differenzen (`expected > counted`)
lassen sich **dokumentarisch verbuchen** oder **ignorieren**. Der tatsächliche
Bestand wird dabei **nicht** verändert — das Booking dient nur der Nachverfolgung.

**Einmal-Setup (SQL-Migration):**

1. Supabase → SQL Editor → `supabase/inventory_discrepancies.sql` vollständig ausführen.
   - Legt Tabelle `public.inventory_discrepancies` + RLS an (nur Service-Role).
   - Erstellt die SQL-Funktion `public.inventory_shrinkage_for_session(location, session_no, gap)`,
     die für eine Inventur-Session pro Produkt `expected` vs `counted` vergleicht.
   - Idempotent (`IF NOT EXISTS` / `CREATE OR REPLACE`).

**Nutzung:**

- Admin-Nav → **Monitoring** → **Schwund · Lager** (sichtbar wenn „Monitoring & Debug"
  eingeblendet ist).
- Seite fragt einmalig den Admin-Code (`SERVER_ACTION_SECRET`) ab, zeigt dann alle
  Inventur-Sessions des Lagers sowie Produkte mit Differenz.
- Pro Zeile: **Verbuchen** → Status `booked` + Zeitstempel + Actor; **Ignorieren** → Status `ignored`.
- Alle Aktionen landen zusätzlich im Audit-Log (`inventory.shrinkage.book/ignore`).

**Logik (vereinfacht):**

- Für jede `mode='count'`-Zeile der Ziel-Session sucht die SQL-Funktion die
  unmittelbar davorliegende `inventory_history`-Zeile (beliebiger Modus) pro Produkt.
  Deren `quantity` = erwartete Menge zum Zeitpunkt des Counts.
- `shrink = max(0, expected - counted)`. Differenzen `≤ 0` (erwartet ≤ gezählt) werden
  nicht gelistet — eine positive Überzählung ist kein Schwund.
- Produkte ohne Vorgeschichte (erste Erfassung) werden ausgelassen — hier gibt es
  keine belastbare Baseline.

### Überzähl-Dialog bei Inventur (Auto-Transfer-Vorschlag)

Wenn an einer Verkaufsstelle bei der Inventur **mehr gezählt wird als erwartet**,
schlägt der Dialog vor, die Differenz als Transfer vom Lager nachzubuchen.
Damit wird der häufige Fall „Ware aus dem Lager geholt, aber Transfer nicht
gebucht" korrekt dokumentiert:

- Differenz wird über den bestehenden RPC `public.transfer_stock(...)`
  gebucht: Lager −Δ, Verkaufsstelle +Δ (zwei `is_transfer=true`-Rows in
  `inventory_history`).
- Anschließend wird der gezählte Wert als regulärer Count abgespeichert.

**Auslösung** (beim Speichern einer Inventur an einer Verkaufsstelle):

- Ort hat `warehouse_location_id` (Teich, Rabenstein, Hofstetten, Kirchberg).
- Erwarteter Bestand > 0 (Erstbuchungen lösen keinen Dialog aus).
- Gezählter Wert > erwarteter Wert.
- Online (offline → wie bisher in die Queue).

**Drei Optionen:**

1. **Als Transfer vom Lager nachbuchen (Lager −Δ)** — empfohlen, wenn die
   Differenz von einem nicht gebuchten Transfer stammt.
2. **Einfach speichern (kein Transfer)** — wenn die Differenz eine andere
   Ursache hat (Retoure, Direktlieferung, Zählkorrektur).
3. **Abbrechen** — Dialog schließen, Count nicht speichern.

**Wirkung auf Bestellvorschläge:** bei (1) sinkt der Lagerbestand um Δ; der
Verbrauch der Verkaufsstelle wird nicht künstlich durch eine „+Δ"-Zählung
überdeckt, weil der positive Diff dann aus einem Transfer statt aus einem Count
stammt (Transfers zählen ohnehin nicht als Verbrauch).

### Artikel-Tracking (Bewegungshistorie pro Artikel)

Für einen einzelnen Artikel läßt sich die komplette Bewegungshistorie einsehen:
Wann, an welchem Standort, welche Aktion (Inventur, Zugang, Transfer rein/raus,
Bruch, Verlust, Korrektur) und mit welcher Veränderung (Δ).

**Aktivierung:**

- Admin-Nav → unten → Schalter **„Artikel-Tracking"** einschalten.
- Aktiviert automatisch das Monitoring-Menü und zeigt den Eintrag
  **Monitoring → Artikel-Tracking**. Ausschalten blendet ihn wieder aus.

**Seite (`/admin/article-tracking`):**

- Filter: Produkt (Suche + Select), Standort (optional) und Zeitraum (7 – 180 Tage).
- Tabelle: Zeitpunkt · Standort · Aktion (Badge) · Δ · Vorher · Nachher · Hinweis.
  Hinweis-Spalte zeigt passende Admin-Audit-Log-Einträge, sofern zeitlich nah
  (±5 s) eine Server-Action mit passendem Produkt ausgeführt wurde.
- Totals: Σ Zugang, Σ Abgang, Inventuren, Transfers im Zeitraum.

**Datenquelle:**

- `public.inventory_history` (alle Bewegungen).
- Δ wird aus dem zeitlich davorliegenden History-Eintrag pro `(location, product)`
  berechnet — auch der Eintrag *vor* dem Fenster dient als Anker, damit der
  erste sichtbare Δ-Wert korrekt ist.
- `public.admin_audit_log` für die Hinweis-Spalte (wenn ein `product_id` in
  `payload` hinterlegt ist).

### Bedarf · 10-Tage-Rückblick (7-Tage-Äquivalent)

Die Bestellvorschläge basieren auf dem berechneten Verbrauch der letzten Tage.
Damit auch Verkaufsstellen mit *älteren* Inventuren (8–10 Tage) korrekt bewertet
werden, arbeitet die Verbrauchsfunktion so:

- Die Bestellvorschlags-Quelle
  `public.usage_by_location_product_since_with_coverage(p_since)` schaut
  **immer mindestens 10 Tage** zurück (auch wenn der Client `p_since = now()-7d`
  übergibt).
- `raw_usage` = Summe der negativen Diffs in diesem Fenster; Transfers,
  `waste` und `loss` werden weiterhin ausgeschlossen (Basisfunktion
  `usage_by_location_product_since`).
- Rückgabe-`usage` = `round(raw_usage * 7 / observed_days)` mit
  `observed_days = min(10, Tage seit erstem History-Eintrag) ∈ [1..10]`
  → konsistentes **7-Tage-Äquivalent**, auch wenn die Inventur älter ist.
- `days_covered` bleibt auf 0..7 gekappt, damit die Early-Stage-Glättung im
  Client (wenig Historie → moderaterer Vorschlag) unverändert greift.
- Die Basisfunktion `usage_by_location_product_since` (z. B. Übersicht) bleibt
  strikt auf das angefragte `p_since`-Fenster und **unverändert**.

**Migration ausführen (einmalig im Supabase SQL-Editor):**

1. `supabase/usage_10d_normalize.sql` komplett ausführen.
2. Neu laden — Bestellvorschläge ziehen jetzt auch ältere Inventuren mit ein.

### Tests

- `npm test` — einmalig (Vitest)
- `npm run test:watch` — Watch-Modus
- `npm run test:coverage` — mit Coverage-Report
- Aktuell abgedeckt: `lib/orderSuggestions.ts` (25 Tests, Bestellvorschlag-Kernlogik).

### Service Worker

- `public/service-worker.js` ist seit Cleanup-Refactor ein Self-Destruct-SW:
  loescht alle Caches und deregistriert sich selbst beim Activate. Damit
  verschwinden alte SWs auf User-Geraeten beim naechsten Pageload.
- Zusaetzlich: `app/_components/ServiceWorkerCleanup.tsx` triggert beim
  Mount `update()` auf alle SW-Registrierungen und loescht alte Caches.
- Wenn echte Offline-Faehigkeit gebraucht wird, hier neu schreiben (z.B. mit Workbox).
