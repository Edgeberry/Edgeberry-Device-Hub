# Production Server Configuration Examples

This directory contains configuration examples and helper scripts for deploying Edgeberry Device Hub in a production environment with proper security, SSL/TLS, and reverse proxy setup.

## Quick Start

```bash
# Set your domain (included as a SAN in the MQTT/TLS server certificate)
export DEVICEHUB_DOMAIN=devicehub.example.com

# Install Device Hub - install.sh prompts for an admin password
# interactively, or set ADMIN_PASSWORD beforehand for an unattended install
wget -O install.sh https://github.com/Edgeberry/Edgeberry-Device-Hub/releases/latest/download/install.sh
sudo -E ./install.sh
```

## Directory Structure

```
documentation/production-server/
├── nginx/
│   └── devicehub.conf           # Nginx reverse proxy configuration
├── systemd/
│   └── devicehub.env.example         # Environment variables template
└── README.md                    # This file
```

## Production Architecture

```
Internet
   ↓
Firewall (UFW)
   ↓
Nginx (443/80) → SSL/TLS Termination
   ↓
Device Hub (localhost:3000)
   ├── Core Service
   ├── Provisioning Service
   ├── Twin Service
   └── Application Service
   ↓
Mosquitto MQTT (8883) ← mTLS with domain in certificate
   ↓
Devices (IoT devices connect here)
```

## Configuration Files

### 1. Nginx Configuration (`nginx/devicehub.conf`)

Complete Nginx reverse proxy configuration with:
- HTTP to HTTPS redirect
- SSL/TLS configuration (Let's Encrypt ready)
- WebSocket support for real-time updates
- Security headers (HSTS, XSS protection, etc.)
- Proper proxy headers for Express trust proxy

**Installation:**
```bash
# Copy configuration
sudo cp nginx/devicehub.conf /etc/nginx/sites-available/devicehub

# Update domain name
sudo nano /etc/nginx/sites-available/devicehub
# Change: server_name devicehub.example.com

# Enable site
sudo ln -s /etc/nginx/sites-available/devicehub /etc/nginx/sites-enabled/

# Test and reload
sudo nginx -t
sudo systemctl reload nginx
```

### 2. Environment Variables (`systemd/devicehub.env.example`)

`install.sh` already creates `/etc/Edgeberry/devicehub/devicehub.env` and seeds it with a generated admin password and JWT secret on first install - don't overwrite that file. `systemd/devicehub.env.example` documents the handful of settings you might want to add on top (port, JWT session TTL, online threshold, MQTT URL).

**Usage:** open the real file and append/edit only what you need:
```bash
sudo nano /etc/Edgeberry/devicehub/devicehub.env

# Restart service to pick up changes
sudo systemctl restart devicehub.service
```

## Complete Setup Guide

### Step 1: Install Device Hub

```bash
export DEVICEHUB_DOMAIN=devicehub.example.com
wget -O install.sh https://github.com/Edgeberry/Edgeberry-Device-Hub/releases/latest/download/install.sh
sudo -E ./install.sh
```

`install.sh` prompts for the admin password interactively. For a fully unattended run, also `export ADMIN_PASSWORD=...` beforehand and pass `-y`.

### Step 2: Configure Firewall

```bash
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 80/tcp      # HTTP
sudo ufw allow 443/tcp     # HTTPS
sudo ufw allow 8883/tcp    # MQTT mTLS
sudo ufw deny 3000         # Block external access
sudo ufw allow from 127.0.0.1 to any port 3000  # Allow Nginx
sudo ufw enable
```

### Step 3: Install Nginx

```bash
sudo apt update
sudo apt install nginx -y
```

### Step 4: Configure Nginx

```bash
# Copy example configuration
sudo cp documentation/production-server/nginx/devicehub.conf /etc/nginx/sites-available/devicehub

# Edit and update domain
sudo nano /etc/nginx/sites-available/devicehub

# Enable site
sudo ln -s /etc/nginx/sites-available/devicehub /etc/nginx/sites-enabled/
```

### Step 5: Obtain SSL Certificate

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx -y

# Obtain certificate (automatic Nginx configuration)
sudo certbot --nginx -d devicehub.example.com

# Test auto-renewal
sudo certbot renew --dry-run
```

### Step 6: Verify Setup

```bash
# Check Device Hub service
sudo systemctl status devicehub.service

# Verify the server certificate includes your domain
openssl x509 -in /var/lib/edgeberry/devicehub/certs/server.crt -text -noout | grep -A1 "Subject Alternative Name"

# Check Nginx
sudo nginx -t
sudo systemctl status nginx

# Test HTTPS access
curl -I https://devicehub.example.com
```

### Step 7: Confirm Admin Access

Log in at `https://devicehub.example.com` with the admin password you set in Step 1. To change it later, run directly on the Hub:

```bash
sudo devicehub --update-password "yourNewPassword"
```

## Security Checklist

- [ ] Domain set in MQTT certificate (`DEVICEHUB_DOMAIN`)
- [ ] Firewall configured (port 3000 blocked externally)
- [ ] Nginx installed and configured
- [ ] SSL certificate obtained and auto-renewal working
- [ ] Admin password set to something other than a generated/default value you haven't recorded
- [ ] Environment variables secured (`/etc/Edgeberry/devicehub/devicehub.env`)
- [ ] Regular backups configured (`/var/lib/edgeberry/devicehub/`)

## Troubleshooting

### Port 3000 Not Accessible

**Symptom:** Nginx shows "502 Bad Gateway"

**Solution:**
```bash
# Check if service is running
sudo systemctl status devicehub.service

# Check port binding
sudo ss -tlnp | grep :3000

# Check logs
sudo journalctl -u devicehub.service -n 50
```

### Certificate Validation Fails

**Symptom:** Devices can't connect, error: "Hostname/IP does not match certificate's altnames"

**Solution:**
```bash
# Verify domain is in certificate
openssl x509 -in /var/lib/edgeberry/devicehub/certs/server.crt -text -noout | grep -A1 "Subject Alternative Name"

# Regenerate certificate if needed (see documentation/PRODUCTION_SETUP.md)
```

### WebSocket Connection Issues

**Symptom:** Real-time updates don't work in UI

**Check:** Ensure Nginx configuration includes WebSocket headers:
```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection 'upgrade';
```

## Monitoring

### Service Status

```bash
sudo systemctl status devicehub.service
```

### Logs

```bash
# Device Hub logs
sudo journalctl -u devicehub.service -f

# Nginx logs
sudo tail -f /var/log/nginx/devicehub_access.log
sudo tail -f /var/log/nginx/devicehub_error.log
```

### Health Check

```bash
# API health endpoint
curl -s https://devicehub.example.com/api/health | jq

# MQTT connection test
openssl s_client -connect devicehub.example.com:8883
```

## Backup & Restore

### Backup

```bash
# Stop services
sudo systemctl stop devicehub.service

# Backup persistent data
sudo tar -czf devicehub-backup-$(date +%Y%m%d).tar.gz \
  /var/lib/edgeberry/devicehub/

# Restart services
sudo systemctl start devicehub.service
```

### Restore

```bash
# Stop services
sudo systemctl stop devicehub.service

# Restore data
sudo tar -xzf devicehub-backup-YYYYMMDD.tar.gz -C /

# Restart services
sudo systemctl start devicehub.service
```

## Additional Resources

- **Full Documentation:** [PRODUCTION_SETUP.md](../PRODUCTION_SETUP.md)
- **GitHub Issues:** https://github.com/Edgeberry/Edgeberry-Device-Hub/issues
- **License:** GNU GPLv3

## Support

For questions or issues:
1. Check the [troubleshooting section](#troubleshooting)
2. Review [PRODUCTION_SETUP.md](../PRODUCTION_SETUP.md)
3. Search or create an issue on GitHub
4. Ensure you're using the latest release
