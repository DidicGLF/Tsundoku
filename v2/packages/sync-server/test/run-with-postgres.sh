#!/usr/bin/env bash
# Lance le test de bout en bout avec un PostgreSQL temporaire (nécessite initdb/pg_ctl : nix-shell -p postgresql).
set -euo pipefail
dir="$(mktemp -d)"
port=54329
trap 'pg_ctl -D "$dir/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$dir"' EXIT
initdb -D "$dir/data" -U test --auth=trust >/dev/null
pg_ctl -D "$dir/data" -o "-p $port -k $dir -c listen_addresses=''" -l "$dir/log" -w start >/dev/null
createdb -h "$dir" -p $port -U test tsundoku_test
SYNC_TEST_DATABASE_URL="postgres://test@localhost:$port/tsundoku_test?host=$dir" pnpm exec vitest run packages/sync-server
