#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

cd "$(dirname "$0")/.."

lan_ip="${1:-$(ip -4 route get 1.1.1.1 | sed -n 's/.* src \([^ ]*\).*/\1/p' | head -n 1)}"
if [[ -z "$lan_ip" ]]; then
  echo 'Could not determine the LAN IPv4 address. Pass it as the first argument.' >&2
  exit 1
fi
if ! openssl x509 -help >/dev/null 2>&1; then
  echo 'OpenSSL is required to create the local HTTPS certificate.' >&2
  exit 1
fi

cert_dir='infra/certs'
mkdir -p "$cert_dir"

if [[ ! -s "$cert_dir/lan-root-ca.key" || ! -s "$cert_dir/lan-root-ca.crt" ]]; then
  openssl genrsa -out "$cert_dir/lan-root-ca.key" 4096
  openssl req -x509 -new -sha256 -days 3650 \
    -key "$cert_dir/lan-root-ca.key" \
    -subj '/CN=R0TT3D Local Demo Root CA' \
    -addext 'basicConstraints=critical,CA:TRUE,pathlen:0' \
    -addext 'keyUsage=critical,keyCertSign,cRLSign' \
    -addext 'subjectKeyIdentifier=hash' \
    -out "$cert_dir/lan-root-ca.crt"
fi

openssl genrsa -out "$cert_dir/server.key" 2048
openssl req -new -key "$cert_dir/server.key" \
  -subj '/CN=R0TT3D LAN Demo' \
  -out "$cert_dir/server.csr"
cat >"$cert_dir/server.ext" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost,IP:127.0.0.1,IP:${lan_ip}
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
EOF
openssl x509 -req -sha256 -days 397 \
  -in "$cert_dir/server.csr" \
  -CA "$cert_dir/lan-root-ca.crt" \
  -CAkey "$cert_dir/lan-root-ca.key" \
  -CAcreateserial \
  -extfile "$cert_dir/server.ext" \
  -out "$cert_dir/server.crt"
rm -f "$cert_dir/server.csr" "$cert_dir/server.ext" "$cert_dir/lan-root-ca.srl"
mkdir -p web/tls
cp "$cert_dir/server.key" web/tls/server.key
cp "$cert_dir/server.crt" web/tls/server.crt
echo "LAN address: https://${lan_ip}:5173"
echo "Root CA fingerprint (verify this before trusting the CA on another device):"
openssl x509 -in "$cert_dir/lan-root-ca.crt" -noout -fingerprint -sha256
echo "Root CA certificate: ${cert_dir}/lan-root-ca.crt"
