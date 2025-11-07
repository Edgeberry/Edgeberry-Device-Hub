# Production Setup Guide

This guide covers deploying Edgeberry Device Hub in a production environment with proper security, SSL/TLS, and reverse proxy configuration.

## Architecture Overview

**Production Stack:**
- Device Hub services run on port 3000 (localhost only)
- Nginx reverse proxy on ports 80/443 (public)
- Firewall blocks direct access to port 3000
- SSL/TLS termination at Nginx
- Trust proxy enabled for correct client IP detection

## Prerequisites

- Debian/Ubuntu Linux server
- Root or sudo access
- Domain name pointing to your server (e.g., `devicehub.edgeberry.io`)
- 2GB RAM minimum
- 20GB disk space

## 1. Install Device Hub

**For production with custom domain**, set the domain before installation:

```bash
export DEVICEHUB_DOMAIN=devicehub.edgeberry.io
wget -O install.sh https://github.com/Edgeberry/Edgeberry-Device-Hub/releases/latest/download/install.sh
chmod +x install.sh
sudo -E ./install.sh -y
```

**For local/development installation**:

```bash
wget -O install.sh https://github.com/Edgeberry/Edgeberry-Device-Hub/releases/latest/download/install.sh
chmod +x install.sh
sudo ./install.sh -y
```

The installer will:
- Install all services under `/opt/Edgeberry/devicehub/`
- Create persistent data directory at `/var/lib/edgeberry/devicehub/`
- Configure systemd services
- Set up MQTT broker with mTLS on port 8883
- Generate server certificate with domain in SANs (if `DEVICEHUB_DOMAIN` is set)

## 2. Configure Firewall

Block direct external access to port 3000 while allowing Nginx access:

```bash
# Allow essential services
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 80/tcp      # HTTP
sudo ufw allow 443/tcp     # HTTPS
sudo ufw allow 8883/tcp    # MQTT mTLS (for devices)

# Block port 3000 from external access
sudo ufw deny 3000

# Allow localhost to access port 3000 (for Nginx)
sudo ufw allow from 127.0.0.1 to any port 3000

# Enable firewall
sudo ufw --force enable

# Verify rules
sudo ufw status numbered
```

**Expected output:**
```
[ 1] 3000                  DENY IN     Anywhere
[ 2] 3000                  ALLOW IN    127.0.0.1
[ 3] 22/tcp                ALLOW IN    Anywhere
[ 4] 80/tcp                ALLOW IN    Anywhere
[ 5] 443/tcp               ALLOW IN    Anywhere
[ 6] 8883/tcp              ALLOW IN    Anywhere
```

## 3. Install Nginx

```bash
sudo apt update
sudo apt install nginx -y
sudo systemctl enable nginx
```

## 4. Obtain SSL Certificate

Using Let's Encrypt (recommended):

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d devicehub.edgeberry.io
```

Follow prompts to obtain and install certificate. Certbot will automatically configure Nginx for HTTPS.

**Manual certificate:** If using your own certificate, place files at:
- `/etc/ssl/certs/devicehub.crt` (certificate)
- `/etc/ssl/private/devicehub.key` (private key)

## 5. Configure Nginx Reverse Proxy

Create Nginx configuration:

```bash
sudo nano /etc/nginx/sites-available/devicehub
```

**Configuration:**

```nginx
# HTTP - Redirect to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name devicehub.edgeberry.io;

    # Redirect all HTTP traffic to HTTPS
    return 301 https://$server_name$request_uri;
}

# HTTPS - Main Device Hub
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name devicehub.edgeberry.io;

    # SSL Configuration (Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/devicehub.edgeberry.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/devicehub.edgeberry.io/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Client body size (for file uploads)
    client_max_body_size 10M;

    # Proxy to Device Hub on port 3000
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        
        # WebSocket support (required for real-time updates)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        
        # Forward real client information
        # Device Hub trusts these headers (trust proxy enabled)
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        
        # Disable caching for dynamic content
        proxy_cache_bypass $http_upgrade;
        proxy_no_cache 1;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Logging
    access_log /var/log/nginx/devicehub_access.log;
    error_log /var/log/nginx/devicehub_error.log;
}
```

**Enable site and test:**

```bash
# Enable the site
sudo ln -s /etc/nginx/sites-available/devicehub /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

## 6. Verify Device Hub Configuration

The Device Hub automatically detects production mode and listens on port 3000 with trust proxy enabled.

**Check service status:**

```bash
sudo systemctl status devicehub-core.service
```

**Verify port binding:**

```bash
sudo ss -tlnp | grep :3000
```

Expected: `LISTEN 0 511 *:3000 *:* users:(("node",pid=XXXX))`

**Check trust proxy setting:**

```bash
sudo journalctl -u devicehub-core.service --since "5 minutes ago" | grep -i "trust proxy\|production"
```

## 7. Access Device Hub

**Web Interface:** `https://devicehub.edgeberry.io`

**Default Credentials:**
- Username: `admin`
- Password: `admin`

**⚠️ IMPORTANT:** Change the default password immediately:
1. Log in to the web interface
2. Click the Settings icon (⚙️) in the top right
3. Go to Account & Security
4. Click "Change Password"

## 8. Post-Installation Security

### Change Admin Password

Access Settings → Account & Security → Change Password

Passwords are stored as bcrypt hashes in the database at `/var/lib/edgeberry/devicehub/devicehub.db`

### Set JWT Secret

For production, set a strong JWT secret:

```bash
# Generate random secret
openssl rand -base64 32

# Set in service environment
sudo mkdir -p /etc/Edgeberry/devicehub
sudo nano /etc/Edgeberry/devicehub/core.env
```

Add:
```
JWT_SECRET=your-generated-secret-here
JWT_TTL_SECONDS=86400
```

Restart service:
```bash
sudo systemctl restart devicehub-core.service
```

### Certificate Auto-Renewal

Let's Encrypt certificates auto-renew via cron/systemd timer. Verify:

```bash
sudo certbot renew --dry-run
```

## 9. Application Service Port

The application service (for external integrations like Node-RED) runs on port 8090:

```bash
sudo ufw allow 8090/tcp
```

**Optional:** Add Nginx proxy for application service if needed.

## Service Management

### Start/Stop/Restart

```bash
# Core service
sudo systemctl start devicehub-core.service
sudo systemctl stop devicehub-core.service
sudo systemctl restart devicehub-core.service

# All services
sudo systemctl restart devicehub-*.service
```

### View Logs

```bash
# Core service logs
sudo journalctl -u devicehub-core.service -f

# All Device Hub services
sudo journalctl -u 'devicehub-*' -f

# Nginx logs
sudo tail -f /var/log/nginx/devicehub_access.log
sudo tail -f /var/log/nginx/devicehub_error.log
```

### Check Service Status

```bash
# All Device Hub services
sudo systemctl status 'devicehub-*'

# Individual services
sudo systemctl status devicehub-core.service
sudo systemctl status devicehub-provisioning.service
sudo systemctl status devicehub-twin.service
sudo systemctl status devicehub-application.service
```

## Backup & Restore

### Backup

```bash
# Stop services
sudo systemctl stop 'devicehub-*'

# Backup data directory
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

## MQTT Certificate Management

### Adding Domain to Existing Certificate

If you installed without setting `DEVICEHUB_DOMAIN` and devices can't connect using the domain name, regenerate the server certificate:

```bash
sudo su -
cd /var/lib/edgeberry/devicehub/certs

# Create certificate configuration with domain
cat > server_san.cnf << 'EOF'
[ req ]
default_bits = 2048
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[ req_distinguished_name ]
CN = devicehub.edgeberry.io

[ v3_req ]
keyUsage = keyEncipherment, dataEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[ alt_names ]
DNS.1 = localhost
DNS.2 = EdgeberryDeviceHub
DNS.3 = devicehub.edgeberry.io
IP.1 = 127.0.0.1
IP.2 = YOUR_SERVER_IP
EOF

# Generate new certificate
openssl genrsa -out server_new.key 2048
openssl req -new -key server_new.key -out server_new.csr -config server_san.cnf
openssl x509 -req -in server_new.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server_new.crt -days 825 -sha256 -extensions v3_req -extfile server_san.cnf

# Verify the certificate includes your domain
openssl x509 -in server_new.crt -text -noout | grep -A1 'X509v3 Subject Alternative Name'

# Replace old certificate
mv server.crt server.crt.old
mv server.key server.key.old
mv server_new.crt server.crt
mv server_new.key server.key
chmod 0640 server.crt server.key

# Update Mosquitto
cp server.crt server.key /etc/mosquitto/certs/
chown root:mosquitto /etc/mosquitto/certs/server.crt /etc/mosquitto/certs/server.key
systemctl restart mosquitto

# Cleanup
rm -f server_new.csr server_san.cnf
exit
```

**Verify the certificate:**
```bash
openssl s_client -connect devicehub.edgeberry.io:8883 -CAfile /etc/mosquitto/certs/ca.crt
```

Expected output should include: `Verify return code: 0 (ok)`

### Certificate Requirements for Devices

Devices connecting to the MQTT broker (port 8883) validate the server certificate. The certificate must include:

1. **DNS name** if devices connect via domain (e.g., `devicehub.edgeberry.io`)
2. **IP address** if devices connect via IP (e.g., `146.190.231.65`)
3. **localhost** for local connections

**Common connection errors:**
- `Hostname/IP does not match certificate's altnames` → Certificate missing the domain/IP in SANs
- `certificate verify failed` → Client doesn't trust the CA certificate
- `Connection refused` → Firewall blocking port 8883

## Troubleshooting

### Port 3000 Not Accessible

**Symptom:** Nginx shows "502 Bad Gateway"

**Check:**
```bash
# Verify service is running
sudo systemctl status devicehub-core.service

# Check port binding
sudo ss -tlnp | grep :3000

# Check logs
sudo journalctl -u devicehub-core.service -n 50
```

**Solution:** Ensure service is running and listening on port 3000.

### SSL Certificate Issues

**Symptom:** Browser shows certificate errors

**Check:**
```bash
# Test certificate
sudo certbot certificates

# Check Nginx config
sudo nginx -t
```

**Solution:** Renew certificate or fix paths in Nginx config.

### WebSocket Connection Failures

**Symptom:** Real-time updates don't work

**Check:** Ensure Nginx proxy configuration includes WebSocket headers:
- `proxy_set_header Upgrade $http_upgrade`
- `proxy_set_header Connection 'upgrade'`

### Firewall Blocking Connections

**Check rules:**
```bash
sudo ufw status verbose
```

**Test connectivity:**
```bash
# From another machine
curl -I https://devicehub.edgeberry.io

# Test MQTT port
telnet devicehub.edgeberry.io 8883
```

## Updates

Update Device Hub while preserving data:

```bash
# Download latest installer
wget -O install.sh https://github.com/Edgeberry/Edgeberry-Device-Hub/releases/latest/download/install.sh

# Run installer
sudo bash install.sh -y
```

The installer automatically:
- Preserves `/var/lib/edgeberry/devicehub/` (database, certificates)
- Updates code under `/opt/Edgeberry/devicehub/`
- Restarts services

**No manual configuration changes required** - firewall and Nginx settings persist.

## Monitoring

### Service Health

Access `/api/health` endpoint:

```bash
curl -s https://devicehub.edgeberry.io/api/health | jq
```

### System Metrics

Built-in dashboard shows:
- Service status
- Device count
- System metrics
- Active connections

Access: Settings → Server section

## Additional Security

### Enable Fail2Ban

Protect against brute force attacks:

```bash
sudo apt install fail2ban -y
```

Create `/etc/fail2ban/filter.d/devicehub.conf`:
```
[Definition]
failregex = ^.* "POST /api/auth/login HTTP.*" 401 .*$
ignoreregex =
```

Create `/etc/fail2ban/jail.d/devicehub.conf`:
```
[devicehub]
enabled = true
port = http,https
filter = devicehub
logpath = /var/log/nginx/devicehub_access.log
maxretry = 5
bantime = 3600
```

Restart fail2ban:
```bash
sudo systemctl restart fail2ban
```

### Limit Rate Limiting

Add to Nginx server block:
```nginx
limit_req_zone $binary_remote_addr zone=devicehub_limit:10m rate=10r/s;

server {
    # ... existing config ...
    
    location / {
        limit_req zone=devicehub_limit burst=20 nodelay;
        # ... existing proxy config ...
    }
}
```

## Architecture Summary

```
Internet
   ↓
Firewall (ufw)
   ↓
Nginx (443/80) → SSL Termination
   ↓
   ├── HTTP Headers (X-Forwarded-*)
   ↓
Device Hub (127.0.0.1:3000) ← Trust Proxy Enabled
   ├── Core Service
   ├── Provisioning Service
   ├── Twin Service
   └── Application Service (8090)
   ↓
Mosquitto MQTT (8883) ← mTLS for devices
   ↓
Devices (external)
```

## Support

- **Documentation:** `/documentation/alignment.md`
- **Issues:** https://github.com/Edgeberry/Edgeberry-Device-Hub/issues
- **License:** GNU GPLv3
