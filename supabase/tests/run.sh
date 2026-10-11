#!/usr/bin/env bash
# Needs local PostgreSQL 15+ superuser connection (PGUSER/PGHOST/PGPORT etc.).
# Uses unique throwaway databases and only removes databases this invocation created.
set -euo pipefail
cd "$(dirname "$0")"
suffix="$(date +%s)_$$"
fresh="applysignal_test_fresh_${suffix}"
upgrade="applysignal_test_upgrade_${suffix}"
created=()
tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/applysignal-dbtest.XXXXXX")"
cleanup() {
  for db in "${created[@]}"; do
    # Never drop a database unless this script successfully created it.
    dropdb --if-exists --force "$db" >/dev/null 2>&1 || true
  done
  rm -rf "$tmpdir"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

stub="create schema if not exists auth; create table if not exists auth.users(id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as \$\$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid \$\$;
insert into auth.users values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') on conflict do nothing;"
# Simulates ONLY the platform baseline of a 2026 Supabase project: schema USAGE, and NO default table privileges.
# Table access must therefore come from the project's own SQL (explicit GRANTs), exactly like a new hosted project.
grants="grant usage on schema public, auth to anon, authenticated, service_role;"
create_test_db() {
  local db="$1"
  if psql -X -qAt -d postgres -v ON_ERROR_STOP=1 -c "select 1 from pg_database where datname='${db}'" | grep -q '^1$'; then
    echo "Refusing to use existing database: ${db}" >&2
    exit 1
  fi
  createdb "$db"
  created+=("$db")
  psql -X -q -v ON_ERROR_STOP=1 -d "$db" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'create role authenticated nologin'; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then execute 'create role service_role nologin'; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then execute 'create role anon nologin'; end if;
end $$;
SQL
  psql -X -q -v ON_ERROR_STOP=1 -d "$db" -c "$stub"
}

echo "== fresh install (${fresh})"
create_test_db "$fresh"
psql -X -q -v ON_ERROR_STOP=1 -d "$fresh" -f ../schema.sql -c "$grants" -f ownership.sql

echo "== upgrade (${upgrade})"
create_test_db "$upgrade"
psql -X -q -v ON_ERROR_STOP=1 -d "$upgrade" -f legacy_schema.sql
psql -X -q -v ON_ERROR_STOP=1 -d "$upgrade" -c "insert into opportunities(id,user_id,company) values ('44444444-4444-4444-4444-444444444444','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','A-owned');
 insert into applications(id,user_id,company,role,opportunity_id) values ('55555555-5555-5555-5555-555555555555','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','B','role','44444444-4444-4444-4444-444444444444');"
psql -X -q -v ON_ERROR_STOP=1 -d "$upgrade" -f ../migrations/002_ownership.sql -f ../migrations/002_ownership.sql -f ../migrations/003_ai_profile.sql -f ../migrations/003_ai_profile.sql -f ../migrations/004_quota_dismissals.sql -f ../migrations/004_quota_dismissals.sql -f ../migrations/005_notifications_realtime.sql -f ../migrations/005_notifications_realtime.sql -f ../migrations/006_data_api_grants.sql -f ../migrations/006_data_api_grants.sql -c "$grants"
cleared="$(psql -X -qAt -v ON_ERROR_STOP=1 -d "$upgrade" -c "select opportunity_id is null from applications where id='55555555-5555-5555-5555-555555555555'")"
[ "$cleared" = "t" ] && echo "PASS cross-user opportunity link cleared" || { echo "FAIL cross-user opportunity link was not cleared"; exit 1; }
psql -X -q -v ON_ERROR_STOP=1 -d "$upgrade" -f ownership.sql

echo "== AI quota under 15 concurrent requests, limit 5 (${upgrade})"
A=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
for i in $(seq 15); do psql -X -qAt -v ON_ERROR_STOP=1 -d "$upgrade" -c "select consume_ai_quota('$A', 5)" > "$tmpdir/q.$i" & done
wait
ok="$(cat "$tmpdir"/q.* | grep -c '^t$' || true)"
rows="$(psql -X -qAt -v ON_ERROR_STOP=1 -d "$upgrade" -c "select count(*) from ai_usage where user_id='$A'")"
[ "$ok" = "5" ] && [ "$rows" = "5" ] && echo "PASS exactly 5 of 15 concurrent calls granted, 5 rows recorded" || { echo "FAIL quota: granted=$ok rows=$rows"; exit 1; }
echo "ALL DATABASE OWNERSHIP TESTS PASSED"
