#!/bin/bash
#
# Edgeberry Device Hub - Firewall Configuration Script
# 
# This script configures UFW (Uncomplicated Firewall) for production deployment
# It blocks external access to port 3000 while allowing Nginx reverse proxy access
#
# Usage: sudo bash setup-firewall.sh
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Error: This script must be run as root${NC}"
    echo "Usage: sudo bash setup-firewall.sh"
    exit 1
fi

echo -e "${GREEN}Edgeberry Device Hub - Firewall Setup${NC}"
echo ""

# Check if UFW is installed
if ! command -v ufw &> /dev/null; then
    echo -e "${YELLOW}UFW not found. Installing...${NC}"
    apt update
    apt install -y ufw
fi

echo "Configuring firewall rules..."
echo ""

# Allow SSH (important to do this first!)
echo -e "${GREEN}✓${NC} Allowing SSH (port 22)"
ufw allow 22/tcp

# Allow HTTP
echo -e "${GREEN}✓${NC} Allowing HTTP (port 80)"
ufw allow 80/tcp

# Allow HTTPS
echo -e "${GREEN}✓${NC} Allowing HTTPS (port 443)"
ufw allow 443/tcp

# Allow MQTT with mTLS (for devices)
echo -e "${GREEN}✓${NC} Allowing MQTT mTLS (port 8883)"
ufw allow 8883/tcp

# Block port 3000 from external access
echo -e "${GREEN}✓${NC} Blocking external access to port 3000"
ufw deny 3000

# Allow localhost to access port 3000 (for Nginx)
echo -e "${GREEN}✓${NC} Allowing localhost access to port 3000"
ufw allow from 127.0.0.1 to any port 3000

# Optional: Application service port (uncomment if using external application clients)
# echo -e "${GREEN}✓${NC} Allowing Application Service (port 8090)"
# ufw allow 8090/tcp

echo ""
echo "Firewall rules configured. Current status:"
echo ""

# Show current rules before enabling
ufw status numbered

echo ""
read -p "Enable firewall with these rules? [y/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Enable firewall
    ufw --force enable
    
    echo ""
    echo -e "${GREEN}✓ Firewall enabled successfully!${NC}"
    echo ""
    echo "Active rules:"
    ufw status numbered
    
    echo ""
    echo -e "${YELLOW}Important:${NC}"
    echo "  • Port 3000 is now blocked from external access"
    echo "  • Only localhost (Nginx) can access port 3000"
    echo "  • Make sure Nginx is configured before testing"
    echo "  • SSH access is allowed - you won't be locked out"
else
    echo ""
    echo -e "${YELLOW}Firewall not enabled. Rules are staged but not active.${NC}"
    echo "To enable later, run: sudo ufw enable"
fi

echo ""
echo -e "${GREEN}Firewall setup complete!${NC}"
