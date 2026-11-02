#!/bin/sh
# Online backup of the Hexhaven SQLite database (safe while the game is running).
# Usage, from the repo root:  sh deploy/backup.sh   → deploy/backups/hexhaven-YYYYmmdd-HHMMSS.sqlite
# Keeps the newest $KEEP backups (default 14); KEEP=0 keeps all.
# Nightly at 04:17 (crontab -e):
#   17 4 * * * cd /path/to/hexhaven && sh deploy/backup.sh >> deploy/backups/backup.log 2>&1
set -eu

cd "$(dirname "$0")/.."
COMPOSE="docker compose -f deploy/docker-compose.yml"
KEEP=${KEEP:-14}
STAMP=$(date +%Y%m%d-%H%M%S)
NAME="hexhaven-$STAMP.sqlite"
mkdir -p deploy/backups

# SQLite's online backup API (via better-sqlite3 inside the running app container), then an
# integrity check of the copy, so a broken backup fails loudly instead of being kept.
$COMPOSE exec -T -e BACKUP_TO="/data/$NAME" app node -e "
  const Database = require('/app/apps/server/node_modules/better-sqlite3');
  const db = new Database(process.env.DB_PATH, { readonly: true });
  db.backup(process.env.BACKUP_TO).then(() => {
    db.close();
    const copy = new Database(process.env.BACKUP_TO);
    // A single self-contained file (no -wal/-shm companions) is easier to copy around.
    copy.pragma('journal_mode = DELETE');
    const result = copy.pragma('integrity_check', { simple: true });
    copy.close();
    if (result !== 'ok') throw new Error('integrity_check: ' + result);
  }).catch((e) => { console.error(e); process.exit(1); });
" || { $COMPOSE exec -T app rm -f "/data/$NAME"; exit 1; }
$COMPOSE cp "app:/data/$NAME" "deploy/backups/$NAME"
$COMPOSE exec -T app rm -f "/data/$NAME"
echo "Backup written to deploy/backups/$NAME"

if [ "$KEEP" -gt 0 ]; then
  # Names sort by date; delete everything but the newest $KEEP.
  ls -1 deploy/backups/hexhaven-*.sqlite 2>/dev/null | sort -r | tail -n +"$((KEEP + 1))" |
    while IFS= read -r old; do rm -f -- "$old" && echo "Removed old backup $old"; done
fi
