#!/usr/bin/env bash
set -Eeuo pipefail

: "${SYNAPSE_DB_PASSWORD:?SYNAPSE_DB_PASSWORD must be set}"

psql \
  --set=ON_ERROR_STOP=1 \
  --set=app_password="$SYNAPSE_DB_PASSWORD" \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" <<'SQL'
CREATE ROLE synapse_app LOGIN PASSWORD :'app_password';
CREATE DATABASE synapse OWNER synapse_app ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0;
SQL
