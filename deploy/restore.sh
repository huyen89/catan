#!/bin/sh
# Restore the Hexhaven database from a backup made by deploy/backup.sh.
# Usage, from the repo root:  sh deploy/restore.sh deploy/backups/hexhaven-YYYYmmdd-HHMMSS.sqlite
# Stops the app, checks the backup, replaces the database (and its WAL files), starts the app.
set -eu

FILE=${1:?usage: sh deploy/restore.sh <backup.sqlite>}
[ -f "$FILE" ] || { echo "No such file: $FILE" >&2; exit 1; }
FILE=$(cd "$(dirname "$FILE")" && pwd)/$(basename "$FILE")
cd "$(dirname "$0")/.."
COMPOSE="docker compose -f deploy/docker-compose.yml"

$COMPOSE stop app
# Runs as the app's own user, so the restored file has the right owner. The backup is streamed
# in, verified, and only then moved over the live database.
$COMPOSE run --rm --no-deps -T app sh -c '
  set -e
  cat > /data/restore.tmp
  node -e "
    const Database = require(\"/app/apps/server/node_modules/better-sqlite3\");
    let result;
    try {
      const db = new Database(\"/data/restore.tmp\");
      result = db.pragma(\"integrity_check\", { simple: true });
      db.close();
    } catch (e) { result = e.message; }
    if (result !== \"ok\") { console.error(\"Not a usable backup:\", result); process.exit(1); }
  " || { rm -f /data/restore.tmp /data/restore.tmp-wal /data/restore.tmp-shm; exit 1; }
  rm -f "$DB_PATH-wal" "$DB_PATH-shm"
  mv /data/restore.tmp "$DB_PATH"
' < "$FILE" || {
  echo "Restore failed; the database was not changed." >&2
  $COMPOSE start app
  exit 1
}
$COMPOSE start app
echo "Restored $FILE"
