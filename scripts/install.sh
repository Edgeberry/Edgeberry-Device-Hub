#!/bin/bash

# Edgeberry Device Hub Installer
# Downloads and installs Edgeberry Device Hub from GitHub releases
# Uses local install.sh script

set -euo pipefail

GITHUB_REPO="Edgeberry/Edgeberry-Device-Hub"
INSTALL_DIR="/tmp/edgeberry-devicehub-install-$$"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

# Parse command line arguments
AUTO_YES=0
FORCE_CLEAN=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        -y|--yes)
            AUTO_YES=1
            shift
            ;;
        --force-clean)
            FORCE_CLEAN=1
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [-y|--yes] [--force-clean]"
            echo "  -y, --yes         Skip confirmation prompts"
            echo "  --force-clean     Remove all persistent data for clean install"
            echo "  -h, --help        Show this help message"
            exit 0
            ;;
        *)
            echo "ERROR: Unknown option: $1"
            echo "Use -h or --help for usage information"
            exit 1
            ;;
    esac
done

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

# No need to check for local deploy script - it will be in the tarball

# Install system packages
echo "Installing system packages..."
apt update >/dev/null 2>&1
packages=(curl wget tar gzip rsync sqlite3 mosquitto ca-certificates openssl jq nodejs npm build-essential python3)
DEBIAN_FRONTEND=noninteractive apt install -y --no-install-recommends "${packages[@]}" >/dev/null 2>&1

# Get release info
echo "Getting latest release info..."

# Prepare curl headers
CURL_HEADERS=(-H "Accept: application/vnd.github.v3+json")
if [ -n "$GITHUB_TOKEN" ]; then
    CURL_HEADERS+=(-H "Authorization: token $GITHUB_TOKEN")
    echo "Using GitHub token for authentication"
fi

latest_release=$(curl "${CURL_HEADERS[@]}" -s "https://api.github.com/repos/${GITHUB_REPO}/releases/latest")

# Check for API errors
if echo "$latest_release" | grep -q '"message".*"API rate limit exceeded"'; then
    echo "ERROR: GitHub API rate limit exceeded"
    echo "To increase rate limit, set GITHUB_TOKEN environment variable with a personal access token"
    echo "Example: GITHUB_TOKEN=your_token_here sudo -E bash install.sh"
    exit 1
fi

if [ -z "$latest_release" ] || [ "$latest_release" = "null" ]; then
    echo "ERROR: Failed to get release info"
    echo "Response: $latest_release"
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

# Download with authentication if available
DOWNLOAD_HEADERS=(-H "Accept: application/octet-stream" -H "X-GitHub-Api-Version: 2022-11-28")
if [ -n "$GITHUB_TOKEN" ]; then
    DOWNLOAD_HEADERS+=(-H "Authorization: token $GITHUB_TOKEN")
fi

if ! curl -L "${DOWNLOAD_HEADERS[@]}" -f -o "devicehub.tar.gz" "$devicehub_url"; then
    echo "ERROR: Download failed (curl exit code: $?)"
    echo "URL: $devicehub_url"
    if [ -f "devicehub.tar.gz" ]; then
        echo "Partial file contents:"
        head -n 20 "devicehub.tar.gz"
    fi
    exit 1
fi

if [ ! -f "devicehub.tar.gz" ]; then
    echo "ERROR: Download failed"
    exit 1
fi

# Validate downloaded file
echo "Validating downloaded file..."
file_size=$(stat -c%s "devicehub.tar.gz" 2>/dev/null || stat -f%z "devicehub.tar.gz" 2>/dev/null)
echo "Downloaded file size: $file_size bytes"

if [ "$file_size" -lt 1000 ]; then
    echo "ERROR: Downloaded file is suspiciously small ($file_size bytes)"
    echo "File contents:"
    head -n 20 "devicehub.tar.gz"
    exit 1
fi

# Check if file is actually gzip
file_type=$(file -b "devicehub.tar.gz")
echo "File type: $file_type"

if [[ ! "$file_type" =~ gzip|compressed ]]; then
    echo "ERROR: Downloaded file is not a gzip archive"
    echo "This usually means the GitHub API returned an error instead of the file."
    echo "File contents (first 50 lines):"
    head -n 50 "devicehub.tar.gz"
    echo ""
    echo "Download URL was: $devicehub_url"
    exit 1
fi

# Extract application
echo "Extracting application..."
if ! tar -xzf devicehub.tar.gz; then
    echo "ERROR: Failed to extract tarball"
    echo "The file may be corrupted or incomplete."
    exit 1
fi

# The tarball extracts directly to current directory, not into a subdirectory
# Check if deploy-artifacts.sh exists in the current directory
DEPLOY_SCRIPT="./scripts/deploy-artifacts.sh"
if [ ! -f "$DEPLOY_SCRIPT" ]; then
    echo "ERROR: deploy-artifacts.sh not found in $DEPLOY_SCRIPT"
    exit 1
fi

# Run deployer from extracted tarball (current directory is the extracted content)
# The tarball contains artifacts directly, so pass current directory as artifacts dir
echo "Running deployer..."

# Build deploy arguments
DEPLOY_ARGS=(".")
if [ "$FORCE_CLEAN" -eq 1 ]; then
    DEPLOY_ARGS+=("--force-clean")
    echo "WARNING: Force clean enabled - all persistent data will be removed"
fi

if [ "$AUTO_YES" -eq 0 ]; then
    echo ""
    echo "This will install/update Edgeberry Device Hub on this system."
    if [ "$FORCE_CLEAN" -eq 1 ]; then
        echo "WARNING: This will DELETE all existing device data, certificates, and configuration!"
    fi
    echo ""
    read -p "Continue? (y/N) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Installation cancelled"
        exit 0
    fi
fi

bash "$DEPLOY_SCRIPT" "${DEPLOY_ARGS[@]}"

# Cleanup
cd /
rm -rf "$INSTALL_DIR"

echo ""
echo "=== Installation Complete ==="
echo "Web Interface: http://$(hostname -I | awk '{print $1}')"
echo "MQTT Broker: $(hostname -I | awk '{print $1}'):8883 (TLS)"
