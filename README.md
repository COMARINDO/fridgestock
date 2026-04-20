## Fridge Stock (PWA)

Mobile-first Web-App (PWA) zur Verwaltung von Getränkebeständen in **mehreren Kühlschränken und Lagerplätzen**.

### Setup

- **1) Supabase Projekt erstellen**
  - Erstelle ein Supabase-Projekt (nur DB, kein Auth).
  - Öffne den SQL Editor und führe `supabase/schema.sql` aus.

- **2) Env Vars setzen**
  - Kopiere `.env.local.example` nach `.env.local`
  - Trage `NEXT_PUBLIC_SUPABASE_URL` und `NEXT_PUBLIC_SUPABASE_ANON_KEY` ein
  - Für serverseitige Jobs (Backup / AI) zusätzlich:
    - `SUPABASE_SERVICE_ROLE_KEY`
    - `OPENAI_API_KEY`
    - `AI_CONSUMPTION_CRON_SECRET` (für manuelle Trigger via `x-ai-cron-secret`)
    - `CRON_SECRET` (für Vercel Cron — Vercel sendet `Authorization: Bearer …`)
    - `ADMIN_BACKUP_CODE` (verpflichtend für `/api/backup` POST aus dem UI)
    - `SERVER_ACTION_SECRET` (verpflichtend für geschützte Admin-Aktionen über API)
  - Optional:
    - `NEXT_PUBLIC_ADMIN_CODE` (Override des clientseitigen Admin-Toggle-Codes,
      Default `1402`. Landet im Browser-Bundle — also kein Geheimnis, aber rotierbar.)
    - `RESEND_API_KEY` + `BACKUP_EMAIL` für Email-Backups
    - Supabase Storage Bucket `backups` (privat) für tägliche Backup-CSV-Uploads
    - `CUSTOMER_CHAT_AI=1` aktiviert den smarten Kunden-Chat (/order)
    - `CUSTOMER_CHAT_ASSISTANT_ID` (Option A): Wenn gesetzt, nutzt /order OpenAI **Assistants v2**
      (Threads/Runs + Tool-Calls) für flexiblere Gespräche. Ohne diese Env-Var nutzt der Chat
      weiterhin die leichtere Chat-Completions-Variante (gpt-4o-mini) als Fallback.
    - `OPENAI_MODEL` optional (Default `gpt-4o-mini`)

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

### KI-Verbrauchsprognose (immer mitlernen)

Damit die KI bei jeder Inventur „mitlernt“:

1. **Migration ausführen** (Supabase → SQL Editor):
   - `supabase/ai_consumption_jobs_trigger.sql`
   - Legt Tabellen `ai_consumption_jobs` / `ai_consumption` (falls fehlt) an
     und einen Trigger auf `inventory_history`, der nach jeder
     Count-Inventur einen Job in `ai_consumption_jobs` einreiht
    (nur wenn der Bestand tatsächlich gesunken ist).
2. **Vercel Cron** (`vercel.json`) ruft `/api/ai/consumption/process?limit=50`
   einmal täglich um **03:00 UTC** auf.
   - Erforderliche Env-Var auf Vercel: `CRON_SECRET` (wird von Vercel
     automatisch als `Authorization: Bearer …` Header mitgeschickt).
   - Manueller Trigger weiterhin möglich:
     `POST /api/ai/consumption/process` mit Header
     `x-ai-cron-secret: $AI_CONSUMPTION_CRON_SECRET`, optional `?limit=25` (1–50).
   - Der Worker verarbeitet pending Jobs, ruft OpenAI auf (`OPENAI_MODEL`,
     default `gpt-4o-mini`), glättet 70/30 mit Historie und schreibt das
     Ergebnis in `ai_consumption`. Stale „processing“-Jobs werden nach 15 Min
     auto-reset.
3. **In Bestellungen nutzen**: Toggle „KI Prognose aktiv“ in der Admin-Nav
   schaltet das Overlay ein — der KI-`suggested_order_7_days` ersetzt dann
   den klassischen 7-Tages-Verbrauch in der Bestell-Berechnung.

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
  `orders.confirm_delivery`.
- Eintrag enthält Action, Actor (Header `x-actor` oder IP), Payload, Result,
  ok/error. Lesbar im Supabase-Dashboard.

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
