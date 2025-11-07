#!/bin/bash
#
# Edgeberry Device Hub - Production Installation Script
# 
# This script installs Device Hub with production configuration including:
# - Custom domain name in MQTT server certificate
# - Proper environment variables
# - Firewall configuration prompt
# - Nginx configuration helper
#
# Usage: sudo bash install-with-domain.sh
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Error: This script must be run as root${NC}"
    echo "Usage: sudo bash install-with-domain.sh"
    exit 1
fi

clear
echo -e "${GREEN}╔════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Edgeberry Device Hub - Production Installation  ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════╝${NC}"
echo ""

# Prompt for domain name
echo -e "${BLUE}Production Configuration${NC}"
echo "Enter your domain name (e.g., devicehub.example.com)"
echo "This will be included in the MQTT server certificate."
echo ""
read -p "Domain name: " DOMAIN

if [ -z "$DOMAIN" ]; then
    echo -e "${RED}Error: Domain name cannot be empty${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}Domain set to: ${DOMAIN}${NC}"
echo ""

# Set environment variable for installation
export DEVICEHUB_DOMAIN="$DOMAIN"

# Download installer
echo "Downloading Device Hub installer..."
wget -O /tmp/devicehub-install.sh https://github.com/Edgeberry/Edgeberry-Device-Hub/releases/latest/download/install.sh
chmod +x /tmp/devicehub-install.sh

echo ""
echo -e "${YELLOW}Starting Device Hub installation...${NC}"
echo ""

# Run installer with environment variable
/tmp/devicehub-install.sh -y

echo ""
echo -e "${GREEN}✓ Device Hub installed successfully!${NC}"
echo ""

# Ask about firewall configuration
echo -e "${BLUE}Firewall Configuration${NC}"
echo "Would you like to configure the firewall now?"
echo "This will:"
echo "  • Allow SSH (22), HTTP (80), HTTPS (443), MQTT (8883)"
echo "  • Block external access to port 3000"
echo "  • Allow localhost access to port 3000"
echo ""
read -p "Configure firewall? [y/N] " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    # Check if UFW is installed
    if ! command -v ufw &> /dev/null; then
        echo "Installing UFW..."
        apt update && apt install -y ufw
    fi
    
    echo "Configuring firewall..."
    ufw allow 22/tcp
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw allow 8883/tcp
    ufw deny 3000
    ufw allow from 127.0.0.1 to any port 3000
    ufw --force enable
    
    echo -e "${GREEN}✓ Firewall configured${NC}"
    echo ""
    ufw status numbered
fi

echo ""
echo -e "${BLUE}Next Steps${NC}"
echo ""
echo "1. Install and configure Nginx:"
echo "   ${YELLOW}sudo apt install nginx${NC}"
echo "   Copy example config from: examples/production-server/nginx/devicehub.conf"
echo "   Update domain name and certificate paths"
echo ""
echo "2. Obtain SSL certificate:"
echo "   ${YELLOW}sudo apt install certbot python3-certbot-nginx${NC}"
echo "   ${YELLOW}sudo certbot --nginx -d $DOMAIN${NC}"
echo ""
echo "3. Access Device Hub:"
echo "   ${YELLOW}https://$DOMAIN${NC}"
echo ""
echo "4. Default admin credentials:"
echo "   Username: admin"
echo "   Password: admin"
echo "   ${RED}CHANGE THE PASSWORD IMMEDIATELY!${NC}"
echo ""
echo -e "${GREEN}Installation complete!${NC}"
echo ""
echo "For detailed setup instructions, see:"
echo "documentation/PRODUCTION_SETUP.md"
