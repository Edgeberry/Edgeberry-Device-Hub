# Device Hub Broker Certificates (Dev)

Place development TLS materials here to use with `config/mosquitto-dev.conf` and `config/mosquitto.conf`:

- `ca.crt` — Root CA certificate that issued client and server certs
- `server.crt` — Broker/server certificate
- `server.key` — Broker/server private key

Client devices/services must use certificates issued by the same `ca.crt`. The broker is configured for mTLS and uses the certificate Subject CN as the username for ACLs.

## Quick (dev-only) certificate generation

These commands generate a throwaway CA and a server cert for localhost. Do not use in production.

```bash
# From repo root
mkdir -p config/certs
pushd config/certs

# 1) Dev Root CA
openssl genrsa -out ca.key 4096
openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 \
  -subj "/C=XX/ST=Dev/L=Dev/O=Edgeberry Dev CA/CN=edgeberry-dev-ca" \
  -out ca.crt

# 2) Broker/server key + CSR
openssl genrsa -out server.key 2048
openssl req -new -key server.key -out server.csr -subj "/CN=localhost"

# 3) Minimal server cert signed by CA (subjectAltName=DNS:localhost)
cat > server-ext.cnf <<EOF
subjectAltName=DNS:localhost,IP:127.0.0.1
extendedKeyUsage=serverAuth
keyUsage = digitalSignature, keyEncipherment
EOF
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days 365 -sha256 -extfile server-ext.cnf

popd
```

## Example: run broker (dev mTLS)

```bash
mosquitto -c "$(pwd)/config/mosquitto-dev.conf"
```

## Example: test publish/subscribe with client certs

Generate a client cert (CN=my-device) signed by the same CA:

```bash
pushd config/certs
openssl genrsa -out my-device.key 2048
openssl req -new -key my-device.key -out my-device.csr -subj "/CN=my-device"
openssl x509 -req -in my-device.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out my-device.crt -days 365 -sha256
popd
```

Subscribe and publish over TLS/mTLS:

```bash
# Terminal 1: subscribe as my-device
mosquitto_sub -h localhost -p 8883 --cafile config/certs/ca.crt \
  --cert config/certs/my-device.crt --key config/certs/my-device.key \
  -t 'devices/my-device/#' -v

# Terminal 2: publish as my-device
mosquitto_pub -h localhost -p 8883 --cafile config/certs/ca.crt \
  --cert config/certs/my-device.crt --key config/certs/my-device.key \
  -t 'devices/my-device/test' -m 'hello'
```

Services that connect should set their MQTT URL to `mqtts://localhost:8883` and pass TLS options (ca, cert, key).
