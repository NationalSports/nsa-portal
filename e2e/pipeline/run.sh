#!/usr/bin/env bash
# e2e/pipeline/run.sh
#
# Creates a FRESH scratch Postgres database, seeds it (seed.sql), applies the
# real migrations 00191-00212 and drives + asserts the full Team Shop / Club
# pipeline (drive.sql). Prints a clear PASS/FAIL and exits non-zero on any
# failure. Safe to re-run any number of times (drops and recreates its own
# database each time; touches nothing else).
#
# Env vars (all optional):
#   PGHOST        default: /tmp        (unix socket dir of the scratch Postgres)
#   PGPORT        default: 55433
#   PGSUPERUSER   default: postgres    (role used to create/drop the scratch DB)
#   E2E_DB        default: nsa_e2e_pipeline
#   E2E_AS_POSTGRES  default: auto     ("1" forces `su postgres -s /bin/bash -c`
#                    wrapping around every psql call, "0" forces plain `psql`,
#                    unset = auto-detect: wrap only when running as root AND an
#                    OS user named `postgres` exists — the posture documented
#                    for this task's sandbox.)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PGHOST="${PGHOST:-/tmp}"
PGPORT="${PGPORT:-55433}"
PGSUPERUSER="${PGSUPERUSER:-postgres}"
E2E_DB="${E2E_DB:-nsa_e2e_pipeline}"

if [ -z "${E2E_AS_POSTGRES:-}" ]; then
  if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1; then
    E2E_AS_POSTGRES=1
  else
    E2E_AS_POSTGRES=0
  fi
fi

# `su -c` takes a single command STRING, so argument boundaries (e.g. the
# "drop database if exists ..." -c payload, which contains spaces) must be
# re-quoted with printf %q before being handed to su, or su's inner shell
# re-splits them on whitespace and psql sees garbage extra arguments.
pg() {
  if [ "$E2E_AS_POSTGRES" = "1" ]; then
    local cmd
    cmd=$(printf '%q ' psql "$@")
    su "$PGSUPERUSER" -s /bin/bash -c "$cmd"
  else
    psql "$@"
  fi
}

fail() {
  echo ""
  echo "=============================================="
  echo "FAIL: $1"
  echo "=============================================="
  exit 1
}

echo "=============================================="
echo "NSA Team Shop / Club pipeline e2e harness"
echo "  host=$PGHOST port=$PGPORT db=$E2E_DB as_postgres=$E2E_AS_POSTGRES"
echo "=============================================="

echo "--- dropping + recreating $E2E_DB (fresh scratch DB) ---"
pg -p "$PGPORT" -h "$PGHOST" -U "$PGSUPERUSER" -v ON_ERROR_STOP=1 -d postgres \
   -c "drop database if exists $E2E_DB;" \
  || fail "could not drop existing $E2E_DB"
pg -p "$PGPORT" -h "$PGHOST" -U "$PGSUPERUSER" -v ON_ERROR_STOP=1 -d postgres \
   -c "create database $E2E_DB;" \
  || fail "could not create $E2E_DB"

echo "--- running seed.sql (Supabase-parity stubs + baseline seed data) ---"
if ! pg -p "$PGPORT" -h "$PGHOST" -U "$PGSUPERUSER" -v ON_ERROR_STOP=1 -d "$E2E_DB" \
        -f "$HERE/seed.sql"; then
  fail "seed.sql did not complete cleanly"
fi

echo "--- running drive.sql (apply 00191-00212 + drive/assert the pipeline) ---"
if ! pg -p "$PGPORT" -h "$PGHOST" -U "$PGSUPERUSER" -v ON_ERROR_STOP=1 -d "$E2E_DB" \
        -f "$HERE/drive.sql"; then
  fail "drive.sql failed -- a migration did not apply, an RPC errored, or an assertion failed (see output above for the exact ASSERTION FAILED / ERROR line)"
fi

echo ""
echo "=============================================="
echo "PASS: full pipeline verified end to end on real Postgres 16"
echo "  (migrations 00191-00212, real RPCs, no mocks)"
echo "=============================================="
