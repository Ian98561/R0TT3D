#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/.."

synapse_image='ghcr.io/element-hq/synapse:v1.161.0@sha256:6b95dd129e35e97e8032cb759e5db4a516a5f7ef6c98d34d716fea1ae239b62a'
synapse_volume='r0tt3d_synapse_data'

if [[ ! -f .env ]]; then
  if docker volume inspect "$synapse_volume" >/dev/null 2>&1; then
    echo "Refusing to replace missing .env while the Synapse data volume exists. Restore the original database passwords from a secure backup." >&2
    exit 1
  fi
  umask 077
  node <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const contents = [
  `POSTGRES_ADMIN_PASSWORD=${crypto.randomBytes(32).toString('hex')}`,
  `SYNAPSE_DB_PASSWORD=${crypto.randomBytes(32).toString('hex')}`,
  '',
].join('\n');
fs.writeFileSync('.env', contents, { flag: 'wx', mode: 0o600 });
NODE
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

docker compose pull synapse
docker compose build database

docker volume create "$synapse_volume" >/dev/null

if ! docker run --rm --entrypoint /bin/sh \
  --volume "$synapse_volume:/data" \
  "$synapse_image" -c 'test -s /data/homeserver.yaml'; then
  docker run --rm \
    --env SYNAPSE_SERVER_NAME=localhost \
    --env SYNAPSE_REPORT_STATS=no \
    --volume "$synapse_volume:/data" \
    "$synapse_image" generate

  docker run --rm -i \
    --entrypoint python \
    --env SYNAPSE_DB_PASSWORD="$SYNAPSE_DB_PASSWORD" \
    --volume "$synapse_volume:/data" \
    "$synapse_image" - <<'PY'
import os
from pathlib import Path
import yaml

config_path = Path('/data/homeserver.yaml')
config = yaml.safe_load(config_path.read_text())
config['public_baseurl'] = 'http://localhost:8008/'
config['database'] = {
    'name': 'psycopg2',
    'args': {
        'user': 'synapse_app',
        'password': os.environ['SYNAPSE_DB_PASSWORD'],
        'dbname': 'synapse',
        'host': 'database',
        'port': 5432,
        'cp_min': 5,
        'cp_max': 10,
    },
}
config['listeners'] = [{
    'port': 8008,
    'tls': False,
    'type': 'http',
    'x_forwarded': False,
    'bind_addresses': ['0.0.0.0'],
    'resources': [{'names': ['client'], 'compress': False}],
}]
config['enable_registration'] = True
config['registration_requires_token'] = False
config['enable_registration_without_verification'] = True
config['rc_registration'] = {'per_second': 0.17, 'burst_count': 3}
config['enable_3pid_lookup'] = False
config['federation_domain_whitelist'] = []
config['allow_public_rooms_without_auth'] = False
config['allow_public_rooms_over_federation'] = False
config['url_preview_enabled'] = False
config['session_lifetime'] = '12h'
config_path.write_text(yaml.safe_dump(config, sort_keys=False))
config_path.chmod(0o600)
PY
fi

# The demo is used by two teammates behind one LAN IP, and device recovery may
# require repeated authenticated logins while a browser profile is repaired.
# Keep failed-password throttling at Synapse defaults; set a bounded request
# burst for the shared demo account and LAN address.
docker run --rm -i \
  --entrypoint python \
  --volume "$synapse_volume:/data" \
  "$synapse_image" - <<'PY'
from pathlib import Path
import yaml

config_path = Path('/data/homeserver.yaml')
config = yaml.safe_load(config_path.read_text())
config.setdefault('rc_login', {})['address'] = {
    'per_second': 0.02,
    'burst_count': 10,
}
config['rc_login']['account'] = {
    'per_second': 0.02,
    'burst_count': 10,
}
# Each visible incoming message currently produces an encrypted room event,
# receipt, and redaction. Keep a bounded burst for the two-person LAN demo so
# cleanup traffic does not throttle the next user message.
config['rc_message'] = {
    'per_second': 5,
    'burst_count': 50,
}
config_path.write_text(yaml.safe_dump(config, sort_keys=False))
config_path.chmod(0o600)
PY

bash scripts/setup-lan-https.sh
docker compose up --detach --build --remove-orphans
docker compose ps
