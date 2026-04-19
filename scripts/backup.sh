#!/usr/bin/env bash
# Lokales pg_dump-Backup der Supabase-DB.
#
# Nutzung:
#   ./scripts/backup.sh
#
# Setup einmalig:
#   1. brew install libpq && brew link --force libpq
#   2. In .env.local einen Eintrag DATABASE_URL hinterlegen, z.B.:
#      DATABASE_URL=postgres://postgres.<PROJECT_REF>:<DB_PASSWORD>@<HOST>:5432/postgres
#      (Supabase Dashboard -> Project Settings -> Database -> Connection string -> URI)
#      WICHTIG: Port 5432 verwenden, NICHT den Pooler-Port 6543.
#
# Output: ./backups/backup-YYYY-MM-DD_HH-MM-SS.dump
#
# Restore in eine andere Datenbank:
#   pg_restore --clean --if-exists --no-owner --no-privileges \
#     --dbname="$DATABASE_URL" backups/backup-XYZ.dump

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="$ROOT_DIR/backups"
ENV_FILE="$ROOT_DIR/.env.local"

mkdir -p "$BACKUP_DIR"

if [[ -z "${DATABASE_URL:-}" && -f "$ENV_FILE" ]]; then
  # DATABASE_URL aus .env.local lesen, falls nicht im Environment gesetzt.
  # Wir greifen gezielt nur auf diese Zeile zu, ohne andere Vars zu sourcen.
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"
  export DATABASE_URL
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL ist nicht gesetzt (weder als Env-Variable noch in $ENV_FILE)." >&2
  echo "       Tragn das Connection-URI aus dem Supabase-Dashboard ein:" >&2
  echo "       Project Settings -> Database -> Connection string -> URI (Port 5432)." >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "ERROR: pg_dump nicht gefunden." >&2
  echo "       Install: brew install libpq && brew link --force libpq" >&2
  exit 1
fi

STAMP="$(date -u +%F_%H-%M-%S)"
OUT="$BACKUP_DIR/backup-${STAMP}.dump"

echo "==> Starte pg_dump ($STAMP)"
pg_dump "$DATABASE_URL" \
  --schema=public \
  --no-owner --no-privileges \
  --format=custom \
  --file="$OUT"

SIZE="$(du -h "$OUT" | cut -f1)"
echo "==> Fertig: $OUT (${SIZE})"
echo
echo "Restore-Test (in eine andere DB):"
echo "  pg_restore --clean --if-exists --no-owner --no-privileges \\"
echo "    --dbname=\"\$DATABASE_URL_TARGET\" \\"
echo "    \"$OUT\""
