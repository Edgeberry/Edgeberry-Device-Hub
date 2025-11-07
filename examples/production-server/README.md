# Production Server Configuration Examples

This directory contains configuration examples and helper scripts for deploying Edgeberry Device Hub in a production environment with proper security, SSL/TLS, and reverse proxy setup.

## Quick Start

### Option 1: Interactive Installation (Recommended)

```bash
# Download and run the production installer
wget https://raw.githubusercontent.com/Edgeberry/Edgeberry-Device-Hub/main/examples/production-server/scripts/install-with-domain.sh
sudo bash install-with-domain.sh
```

This script will:
- Prompt for your domain name
- Install Device Hub with domain in MQTT certificate
- Optionally configure firewall
- Provide next steps for Nginx and SSL setup

### Option 2: Manual Installation

```bash
# Set your domain
export DEVICEHUB_DOMAIN=devicehub.example.com

# Install Device Hub
wget -O install.sh https://github.com/Edgeberry/Edgeberry-Device-Hub/releases/latest/download/install.sh
sudo -E ./install.sh -y
```

## Directory Structure

```
examples/production-server/
├── nginx/
│   └── devicehub.conf           # Nginx reverse proxy configuration
├── scripts/
│   ├── install-with-domain.sh   # Interactive production installer
│   ├── setup-firewall.sh        # Firewall configuration helper
│   └── verify-certificate.sh    # Certificate validation tool
├── systemd/
│   └── core.env.example         # Environment variables template
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

### 2. Environment Variables (`systemd/core.env.example`)

Environment variable template for core service customization:
- JWT secret configuration
- Admin credentials
- Port settings
- Database and certificate paths

**Installation:**
```bash
# Create config directory
sudo mkdir -p /etc/Edgeberry/devicehub

# Copy and customize
sudo cp systemd/core.env.example /etc/Edgeberry/devicehub/core.env
sudo nano /etc/Edgeberry/devicehub/core.env

# Generate secure JWT secret
openssl rand -base64 32

# Restart service
sudo systemctl restart devicehub-core.service
```

## Helper Scripts

### 1. Production Installer (`scripts/install-with-domain.sh`)

Interactive installation script that:
- Prompts for domain name
- Sets `DEVICEHUB_DOMAIN` environment variable
- Installs Device Hub with proper certificate configuration
- Offers firewall setup
- Provides next steps

**Usage:**
```bash
wget https://raw.githubusercontent.com/Edgeberry/Edgeberry-Device-Hub/main/examples/production-server/scripts/install-with-domain.sh
sudo bash install-with-domain.sh
```

### 2. Firewall Setup (`scripts/setup-firewall.sh`)

Configures UFW with production-ready rules:
- Allow SSH (22), HTTP (80), HTTPS (443), MQTT (8883)
- Block external access to port 3000
- Allow localhost access to port 3000 (for Nginx)

**Usage:**
```bash
sudo bash scripts/setup-firewall.sh
```

**Manual firewall configuration:**
```bash
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 80/tcp      # HTTP
sudo ufw allow 443/tcp     # HTTPS
sudo ufw allow 8883/tcp    # MQTT mTLS
sudo ufw deny 3000         # Block external access
sudo ufw allow from 127.0.0.1 to any port 3000  # Allow Nginx
sudo ufw enable
```

### 3. Certificate Verification (`scripts/verify-certificate.sh`)

Validates MQTT server certificate configuration:
- Checks if certificate exists
- Verifies domain is in Subject Alternative Names
- Tests MQTT connection and certificate validation

**Usage:**
```bash
bash scripts/verify-certificate.sh devicehub.example.com
```

## Complete Setup Guide

### Step 1: Install Device Hub

```bash
export DEVICEHUB_DOMAIN=devicehub.example.com
wget -O install.sh https://github.com/Edgeberry/Edgeberry-Device-Hub/releases/latest/download/install.sh
sudo -E ./install.sh -y
```

### Step 2: Configure Firewall

```bash
wget https://raw.githubusercontent.com/Edgeberry/Edgeberry-Device-Hub/main/examples/production-server/scripts/setup-firewall.sh
sudo bash setup-firewall.sh
```

### Step 3: Install Nginx

```bash
sudo apt update
sudo apt install nginx -y
```

### Step 4: Configure Nginx

```bash
# Copy example configuration
sudo cp examples/production-server/nginx/devicehub.conf /etc/nginx/sites-available/devicehub

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
sudo systemctl status devicehub-core.service

# Verify certificate
bash examples/production-server/scripts/verify-certificate.sh devicehub.example.com

# Check Nginx
sudo nginx -t
sudo systemctl status nginx

# Test HTTPS access
curl -I https://devicehub.example.com
```

### Step 7: Change Default Credentials

1. Access `https://devicehub.example.com`
2. Login with default credentials (admin/admin)
3. Click Settings (⚙️) → Account & Security
4. Change password immediately

## Security Checklist

- [ ] Domain set in MQTT certificate (`DEVICEHUB_DOMAIN`)
- [ ] Firewall configured (port 3000 blocked externally)
- [ ] Nginx installed and configured
- [ ] SSL certificate obtained and auto-renewal working
- [ ] Default admin password changed
- [ ] JWT secret changed from default
- [ ] Environment variables secured (`/etc/Edgeberry/devicehub/core.env`)
- [ ] Regular backups configured (`/var/lib/edgeberry/devicehub/`)

## Troubleshooting

### Port 3000 Not Accessible

**Symptom:** Nginx shows "502 Bad Gateway"

**Solution:**
```bash
# Check if service is running
sudo systemctl status devicehub-core.service

# Check port binding
sudo ss -tlnp | grep :3000

# Check logs
sudo journalctl -u devicehub-core.service -n 50
```

### Certificate Validation Fails

**Symptom:** Devices can't connect, error: "Hostname/IP does not match certificate's altnames"

**Solution:**
```bash
# Verify domain is in certificate
bash scripts/verify-certificate.sh devicehub.example.com

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
# All Device Hub services
sudo systemctl status 'devicehub-*'

# Individual services
sudo systemctl status devicehub-core.service
sudo systemctl status devicehub-twin.service
sudo systemctl status devicehub-application.service
```

### Logs

```bash
# Core service logs
sudo journalctl -u devicehub-core.service -f

# All Device Hub services
sudo journalctl -u 'devicehub-*' -f

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
sudo systemctl stop 'devicehub-*'

# Backup persistent data
sudo tar -czf devicehub-backup-$(date +%Y%m%d).tar.gz \
  /var/lib/edgeberry/devicehub/

# Restart services
sudo systemctl start 'devicehub-*'
```

### Restore

```bash
# Stop services
sudo systemctl stop 'devicehub-*'

# Restore data
sudo tar -xzf devicehub-backup-YYYYMMDD.tar.gz -C /

# Restart services
sudo systemctl start 'devicehub-*'
```

## Additional Resources

- **Full Documentation:** [documentation/PRODUCTION_SETUP.md](../../documentation/PRODUCTION_SETUP.md)
- **Architecture Guide:** [documentation/alignment.md](../../documentation/alignment.md)
- **GitHub Issues:** https://github.com/Edgeberry/Edgeberry-Device-Hub/issues
- **License:** GNU GPLv3

## Support

For questions or issues:
1. Check the [troubleshooting section](#troubleshooting)
2. Review [documentation/PRODUCTION_SETUP.md](../../documentation/PRODUCTION_SETUP.md)
3. Search or create an issue on GitHub
4. Ensure you're using the latest release
