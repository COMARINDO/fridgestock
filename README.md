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
    - `ADMIN_BACKUP_CODE` (verpflichtend für `/api/backup`)
    - `SERVER_ACTION_SECRET` (verpflichtend für geschützte Admin-Aktionen über API)

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
