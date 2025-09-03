#!/bin/bash

# Edgeberry Device Hub Installer
# Downloads and installs Edgeberry Device Hub from GitHub releases
# Uses local install.sh script

set -euo pipefail

GITHUB_REPO="Edgeberry/Edgeberry-Device-Hub"
INSTALL_DIR="/tmp/edgeberry-devicehub-install-$$"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Edgeberry Device Hub Installation ==="

# Check root
if [ "$EUID" -ne 0 ]; then
    echo "ERROR: Must run as root"
    exit 1
fi

# Check system
echo "Checking system requirements..."
if [[ ! -f /etc/debian_version ]]; then
    echo "ERROR: Debian/Ubuntu required"
    exit 1
fi

# Check local deploy script exists
if [ ! -f "$SCRIPT_DIR/deploy-artifacts.sh" ]; then
    echo "ERROR: Local deploy-artifacts.sh not found at $SCRIPT_DIR/deploy-artifacts.sh"
    exit 1
fi

# Install system packages
echo "Installing system packages..."
apt update >/dev/null 2>&1
packages=(curl wget tar gzip rsync sqlite3 mosquitto ca-certificates openssl jq nodejs npm build-essential python3)
DEBIAN_FRONTEND=noninteractive apt install -y --no-install-recommends "${packages[@]}" >/dev/null 2>&1

# Get release info
echo "Getting latest release info..."
latest_release=$(curl -H "Accept: application/vnd.github.v3+json" -s "https://api.github.com/repos/${GITHUB_REPO}/releases/latest")
if [ -z "$latest_release" ] || [ "$latest_release" = "null" ]; then
    echo "ERROR: Failed to get release info"
    exit 1
fi

release_tag=$(echo "$latest_release" | jq -r '.tag_name')
echo "Installing version: $release_tag"

# Download application tarball only
echo "Downloading application..."
devicehub_url=$(echo "$latest_release" | jq -r '.assets[] | select(.name | test("devicehub-.*\\.tar\\.gz")) | .url')

if [ -z "$devicehub_url" ]; then
    echo "ERROR: Failed to get download URL"
    exit 1
fi

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

curl -L -H "Accept: application/octet-stream" -H "X-GitHub-Api-Version: 2022-11-28" -o "devicehub.tar.gz" "$devicehub_url"

if [ ! -f "devicehub.tar.gz" ]; then
    echo "ERROR: Download failed"
    exit 1
fi

# Extract application
echo "Extracting application..."
tar -xzf devicehub.tar.gz

# Run local deployer
echo "Running deployer..."
bash "$SCRIPT_DIR/deploy-artifacts.sh" devicehub-*

# Cleanup
cd /
rm -rf "$INSTALL_DIR"

echo ""
echo "=== Installation Complete ==="
echo "Web Interface: http://$(hostname -I | awk '{print $1}')"
echo "MQTT Broker: $(hostname -I | awk '{print $1}'):8883 (TLS)"
