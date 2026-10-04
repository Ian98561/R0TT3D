#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/.."
docker compose exec -it synapse register_new_matrix_user \
  -c /data/homeserver.yaml \
  --admin \
  http://localhost:8008
