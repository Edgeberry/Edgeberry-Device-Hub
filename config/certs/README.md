# Certificate Management

This directory contains TLS certificates for the Edgeberry Device Hub.

## Certificate Types

- **`ca.crt`** - Root Certificate Authority certificate
- **`ca.key`** - Root CA private key  
- **`server.crt`** - MQTT broker server certificate
- **`server.key`** - MQTT broker server private key
- **`provisioning.crt`** - Client certificate for device provisioning
- **`provisioning.key`** - Provisioning client private key

## Permissions

All certificate files are automatically configured with proper permissions:

- **File Mode**: `0640` (rw-r-----)
- **Ownership**: `root:mosquitto`
- **Purpose**: Allows Mosquitto broker to read certificates while maintaining security

## Automatic Management

Certificate permissions are handled automatically by:

1. **Core Service**: Sets proper permissions when generating new certificates
2. **Install Script**: Ensures correct permissions during deployment
3. **Certificate Sync**: Maintains permissions during certificate updates

## Production Deployment

In production, certificates are stored in `/var/lib/edgeberry/devicehub/certs/` and automatically synchronized to `/etc/mosquitto/certs/` with proper permissions for the Mosquitto broker.

## Development

For local development, ensure the Mosquitto service has read access to these certificate files. The system will attempt to set proper permissions automatically, but manual adjustment may be needed in some development environments.
