#!/bin/bash
#
# Edgeberry Device Hub - Certificate Verification Script
# 
# Verifies that the MQTT server certificate includes the required domain
# and that devices can successfully validate the certificate
#
# Usage: bash verify-certificate.sh [domain]
#

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

DOMAIN=${1:-devicehub.edgeberry.io}
MQTT_PORT=8883

echo "Verifying MQTT certificate for domain: $DOMAIN"
echo ""

# Check if server certificate exists
CERT_PATH="/etc/mosquitto/certs/server.crt"
if [ ! -f "$CERT_PATH" ]; then
    CERT_PATH="/var/lib/edgeberry/devicehub/certs/server.crt"
fi

if [ ! -f "$CERT_PATH" ]; then
    echo -e "${RED}✗ Server certificate not found${NC}"
    echo "Expected locations:"
    echo "  - /etc/mosquitto/certs/server.crt"
    echo "  - /var/lib/edgeberry/devicehub/certs/server.crt"
    exit 1
fi

echo -e "${GREEN}✓ Certificate found: $CERT_PATH${NC}"
echo ""

# Check Subject Alternative Names
echo "Checking Subject Alternative Names..."
SANS=$(openssl x509 -in "$CERT_PATH" -text -noout | grep -A1 "Subject Alternative Name" | tail -1)

if [ -z "$SANS" ]; then
    echo -e "${RED}✗ No Subject Alternative Names found in certificate${NC}"
    echo "The certificate must include SANs for devices to connect."
    exit 1
fi

echo "SANs: $SANS"
echo ""

# Check if domain is in SANs
if echo "$SANS" | grep -q "$DOMAIN"; then
    echo -e "${GREEN}✓ Domain $DOMAIN found in certificate SANs${NC}"
else
    echo -e "${YELLOW}⚠ Domain $DOMAIN NOT found in certificate SANs${NC}"
    echo "Devices connecting via this domain will fail certificate validation."
    echo ""
    echo "To fix, regenerate the certificate with:"
    echo "  export DEVICEHUB_DOMAIN=$DOMAIN"
    echo "  sudo -E /path/to/install.sh"
    echo ""
    echo "Or manually regenerate as shown in documentation/PRODUCTION_SETUP.md"
fi

echo ""

# Test MQTT connection if openssl s_client is available
if command -v openssl &> /dev/null; then
    echo "Testing MQTT connection to $DOMAIN:$MQTT_PORT..."
    
    # Try to connect (timeout after 5 seconds)
    CONNECT_TEST=$(timeout 5 openssl s_client -connect "$DOMAIN:$MQTT_PORT" -servername "$DOMAIN" 2>&1 | grep "Verify return code:")
    
    if echo "$CONNECT_TEST" | grep -q "0 (ok)"; then
        echo -e "${GREEN}✓ Certificate validation successful${NC}"
        echo "$CONNECT_TEST"
    else
        echo -e "${YELLOW}⚠ Certificate validation issues detected${NC}"
        echo "$CONNECT_TEST"
    fi
else
    echo -e "${YELLOW}⚠ openssl not available for connection testing${NC}"
fi

echo ""
echo "Certificate verification complete."
