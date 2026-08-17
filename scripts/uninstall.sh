#!/bin/bash

# Edgeberry Device Hub Uninstaller
# Completely removes all Edgeberry Device Hub components, services, configs, and data

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/services.sh
source "$SCRIPT_DIR/lib/services.sh"

echo "=== Edgeberry Device Hub Uninstaller ==="

# Check root
if [ "$EUID" -ne 0 ]; then
    echo "ERROR: Must run as root"
    exit 1
fi

# Confirm uninstall
read -p "This will completely remove Edgeberry Device Hub and ALL its data. Continue? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Uninstall cancelled"
    exit 0
fi

echo "Stopping and disabling services..."
# Stop and disable all Device Hub services. Legacy units are included so
# uninstalling after an upgrade from the old 4-process layout leaves nothing
# behind.
for unit in "${DEVICEHUB_SERVICE_UNITS[@]}" "${DEVICEHUB_LEGACY_UNITS[@]}"; do
    systemctl stop "$unit" 2>/dev/null || true
done
for unit in "${DEVICEHUB_SERVICE_UNITS[@]}" "${DEVICEHUB_LEGACY_UNITS[@]}"; do
    systemctl disable "$unit" 2>/dev/null || true
done

echo "Removing systemd unit files..."
for unit in "${DEVICEHUB_SERVICE_UNITS[@]}" "${DEVICEHUB_LEGACY_UNITS[@]}"; do
    rm -f "/etc/systemd/system/$unit"
done

# Reload systemd
systemctl daemon-reload 2>/dev/null || true

echo "Removing legacy D-Bus services and policies..."
# Nothing speaks D-Bus anymore; these only exist on installs upgraded from
# the old multi-process layout.
rm -f /usr/share/dbus-1/system-services/io.edgeberry.devicehub.Core.service
rm -f /usr/share/dbus-1/system-services/io.edgeberry.devicehub.Twin.service
rm -f /usr/share/dbus-1/system-services/io.edgeberry.devicehub.ApplicationService.service
rm -f /etc/dbus-1/system.d/io.edgeberry.devicehub.Core.conf
rm -f /etc/dbus-1/system.d/io.edgeberry.devicehub.Twin.conf
rm -f /etc/dbus-1/system.d/io.edgeberry.devicehub.ApplicationService.conf

echo "Removing admin CLI..."
rm -f /usr/local/bin/devicehub

echo "Removing application files..."
# Remove application installation directory
rm -rf /opt/Edgeberry/devicehub

echo "Removing configuration files..."
# Remove configuration directories
rm -rf /etc/Edgeberry/devicehub

echo "Removing data and certificates..."
# Remove persistent data directory (includes database and certificates)
rm -rf /var/lib/edgeberry/devicehub

echo "Cleaning up Mosquitto configuration..."
# Remove Device Hub Mosquitto configuration
rm -f /etc/mosquitto/conf.d/edgeberry.conf
rm -f /etc/mosquitto/conf.d/devicehub.conf
rm -rf /etc/mosquitto/certs/edgeberry-ca.d
rm -f /etc/mosquitto/certs/ca.crt
rm -f /etc/mosquitto/certs/server.crt
rm -f /etc/mosquitto/certs/server.key
rm -f /etc/mosquitto/certs/crl.pem
rm -f /etc/mosquitto/acl.d/edgeberry.acl

# Restart Mosquitto to reload config (if it's running)
if systemctl is-active --quiet mosquitto 2>/dev/null; then
    echo "Restarting Mosquitto..."
    systemctl restart mosquitto 2>/dev/null || true
fi

echo "Removing temporary files..."
# Clean up any temporary installation directories
rm -rf /tmp/edgeberry-devicehub-install-*

echo "Removing parent directories if empty..."
# Remove parent directories if they're empty
rmdir /opt/Edgeberry 2>/dev/null || true
rmdir /etc/Edgeberry 2>/dev/null || true
rmdir /var/lib/edgeberry 2>/dev/null || true

echo ""
echo "=== Uninstall Complete ==="
echo "Edgeberry Device Hub has been completely removed from this system."
echo ""
echo "Note: System packages (nodejs, npm, mosquitto, etc.) were not removed"
echo "as they may be used by other applications."
