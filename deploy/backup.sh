#!/bin/sh
# Online backup of the Hexhaven SQLite database (safe while the game is running).
# Usage, from the repo root:  sh deploy/backup.sh   → deploy/backups/hexhaven-YYYYmmdd-HHMMSS.sqlite
set -eu

COMPOSE="docker compose -f deploy/docker-compose.yml"
STAMP=$(date +%Y%m%d-%H%M%S)
NAME="hexhaven-$STAMP.sqlite"
mkdir -p deploy/backups

# Uses SQLite's backup API through better-sqlite3 inside the running app container.
$COMPOSE exec -T app node -e "
  const Database = require('/app/apps/server/node_modules/better-sqlite3');
  const db = new Database(process.env.DB_PATH, { readonly: true });
  db.backup('/data/$NAME').then(() => { db.close(); }, (e) => { console.error(e); process.exit(1); });
"
$COMPOSE cp "app:/data/$NAME" "deploy/backups/$NAME"
$COMPOSE exec -T app rm -f "/data/$NAME"
echo "Backup written to deploy/backups/$NAME"
