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
    - `AI_CONSUMPTION_CRON_SECRET`

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
