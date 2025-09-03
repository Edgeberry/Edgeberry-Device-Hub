#!/bin/bash

##
# Edgeberry Device Hub Installer
# Downloads and installs Edgeberry Device Hub from GitHub releases
# on Debian/Ubuntu-like systems using apt. The script is designed
# to be idempotent where possible, so re-running it is safe.
#
# Copyright (C) Edgeberry. See LICENSE.txt for details.
# Authors: Sanne 'SpuQ' Santens
#          [AI assisted since 03/09/2025]
#
# Requirements:
#   - Root privileges (run with sudo)
#   - apt package manager
#   - Internet connectivity
#
# Usage:
#   curl -fsSL https://github.com/Edgeberry/Edgeberry-Device-Hub/releases/latest/download/setup-devicehub.sh | sudo bash
#   # OR with options:
#   curl -fsSL <script-url> | sudo bash -s -- [-y|--yes] [--version VERSION] [--force-clean] [--dev]
#
# Options:
#   -y, --yes       Auto-confirm all prompts (non-interactive mode)
#   --version VER   Install specific version (default: latest stable)
#   --force-clean   Remove all existing data and certificates
#   --dev           Install latest development build (including pre-releases)
##

APPNAME="Edgeberry Device Hub"
APPCOMP="DeviceHub"
REPONAME="Edgeberry-Device-Hub"
REPOOWNER="Edgeberry"

# Configuration
GITHUB_REPO="${REPOOWNER}/${REPONAME}"
DEFAULT_VERSION="latest"
INSTALL_DIR="/tmp/edgeberry-devicehub-install-$$"

# Parse arguments
ALL_YES=false
DEV_BUILD=false
FORCE_CLEAN=false
VERSION=""

for arg in "$@"; do
  case "$arg" in
    -y|--yes)
      ALL_YES=true
      ;;
    --dev)
      DEV_BUILD=true
      ;;
    --force-clean)
      FORCE_CLEAN=true
      ;;
    --version)
      shift
      VERSION="$1"
      ;;
    --help|-h)
      show_help
      exit 0
      ;;
  esac
done

# Set default version if not specified
if [[ -z "$VERSION" ]]; then
    VERSION="$DEFAULT_VERSION"
fi

# Progress tracking variables
declare -a STEPS=(
    "Check system requirements"
    "Install Node.js"
    "Install NPM"
    "Install build tools"
    "Install system packages"
    "Get latest release info"
    "Download application"
    "Extract application"
    "Install Node dependencies"
    "Configure certificates"
    "Install systemd services"
    "Configure MQTT broker"
    "Enable services"
    "Start services"
    "Verify installation"
)

declare -a STEP_STATUS=()
CURRENT_STEP=0
TOTAL_STEPS=${#STEPS[@]}

# Status symbols (ASCII compatible)
SYMBOL_PENDING="[ ]"
SYMBOL_BUSY="[~]"
SYMBOL_COMPLETED="[+]"
SYMBOL_SKIPPED="[-]"
SYMBOL_FAILED="[X]"

# Initialize all steps as pending
for ((i=0; i<TOTAL_STEPS; i++)); do
    STEP_STATUS[i]="$SYMBOL_PENDING"
done

# Function to clear screen and show progress
show_progress() {
    clear
    echo -e "\033[1m    ______    _            _                      ";
    echo -e "   |  ____|  | |          | |                            ";
    echo -e "   | |__   __| | __ _  ___| |__   ___ _ __ _ __ _   _  \e[0mTM\033[1m";
    echo -e "   |  __| / _' |/ _' |/ _ \ '_ \ / _ \ '__| '__| | | |   ";
    echo -e "   | |___| (_| | (_| |  __/ |_) |  __/ |  | |  | |_| |   ";
    echo -e "   |______\__,_|\__, |\___|_.__ \ \___|_|  |_|   \__, |   ";
    echo -e "                 __/ |                           __/ |   ";
    echo -e "                |___/                           |___/    \e[0m";
    echo ""
    echo -e "\033[1m${APPNAME} Installation\033[0m"
    echo ""
    
    # Show all steps with their status
    for ((i=0; i<TOTAL_STEPS; i++)); do
        echo -e "${STEP_STATUS[i]} ${STEPS[i]}"
    done
    
    echo ""
    
    # Progress bar
    local completed=0
    for status in "${STEP_STATUS[@]}"; do
        if [[ "$status" == "$SYMBOL_COMPLETED" || "$status" == "$SYMBOL_SKIPPED" ]]; then
            ((completed++))
        fi
    done
    
    local progress=$((completed * 100 / TOTAL_STEPS))
    local bar_length=50
    local filled_length=$((completed * bar_length / TOTAL_STEPS))
    
    printf "Progress: ["
    for ((i=0; i<bar_length; i++)); do
        if [ $i -lt $filled_length ]; then
            printf "="
        else
            printf " "
        fi
    done
    printf "] %d%% (%d/%d)\n" "$progress" "$completed" "$TOTAL_STEPS"
    echo ""
}

# Function to set step status
set_step_status() {
    local step_index=$1
    local status=$2
    STEP_STATUS[step_index]="$status"
    show_progress
}

# Function to mark step as busy
mark_step_busy() {
    local step_index=$1
    set_step_status "$step_index" "$SYMBOL_BUSY"
}

# Function to mark step as completed
mark_step_completed() {
    local step_index=$1
    set_step_status "$step_index" "$SYMBOL_COMPLETED"
}

# Function to mark step as skipped
mark_step_skipped() {
    local step_index=$1
    set_step_status "$step_index" "$SYMBOL_SKIPPED"
}

# Function to mark step as failed
mark_step_failed() {
    local step_index=$1
    set_step_status "$step_index" "$SYMBOL_FAILED"
}

# Precondition: require root privileges
if [ "$EUID" -ne 0 ]; then
    echo -e "\e[0;31mUser is not root. Exit.\e[0m"
    echo -e "\e[0mRun this script again as root\e[0m"
    exit 1;
fi

show_help() {
    cat << EOF
Edgeberry Device Hub Setup Script

USAGE:
    curl -fsSL <script-url> | sudo bash [OPTIONS]

OPTIONS:
    -y, --yes       Auto-confirm all prompts (non-interactive mode)
    --version VER   Install specific version (default: latest stable)
    --force-clean   Remove all existing data and certificates
    --dev           Install latest development build (including pre-releases)
    --help, -h      Show this help message

EXAMPLES:
    # Install latest stable version
    curl -fsSL <script-url> | sudo bash
    
    # Install specific version non-interactively
    curl -fsSL <script-url> | sudo bash -s -- -y --version v0.1.0
    
    # Clean install with latest development build
    curl -fsSL <script-url> | sudo bash -s -- --dev --force-clean

EOF
}

# Start a clean screen and show initial progress
show_progress
echo -e "Some steps can take a while with few feedback, so go grab a coffee with an";
echo -e "extra spoon of patience.\033[0m"
echo ""
echo -e "\e[0;33mNOTE: Please ensure a stable internet connection! \e[0m";
echo ""
sleep 2

# Step 0: Check system requirements
mark_step_busy 0
if [[ ! -f /etc/debian_version ]]; then
    mark_step_failed 0
    echo -e "\e[0;31mThis script is designed for Debian/Ubuntu systems. Exit.\e[0m"
    exit 1
fi
mark_step_completed 0

# Step 1: Check for Node.js. If it's not installed, install it.
mark_step_busy 1
if which node >/dev/null 2>&1; then 
    mark_step_skipped 1
else 
    apt install -y nodejs > /dev/null 2>&1;
    if [ $? -eq 0 ]; then
        mark_step_completed 1
    else
        mark_step_failed 1
        echo -e "\e[0;33mFailed to install Node.js! Exit.\e[0m";
        exit 1;
    fi
fi
if [[ "${STEP_STATUS[1]}" == "$SYMBOL_BUSY" ]]; then
    mark_step_completed 1
fi

# Step 2: Check for NPM. If it's not installed, install it.
mark_step_busy 2
if which npm >/dev/null 2>&1; then 
    mark_step_skipped 2
else 
    apt install -y npm > /dev/null 2>&1;
    if [ $? -eq 0 ]; then
        mark_step_completed 2
    else
        mark_step_failed 2
        echo -e "\e[0;33mFailed to install NPM! Exit.\e[0m";
        exit 1;
    fi
fi
if [[ "${STEP_STATUS[2]}" == "$SYMBOL_BUSY" ]]; then
    mark_step_completed 2
fi

# Step 3: Check for build tools. If not installed, install them.
mark_step_busy 3
if which make >/dev/null 2>&1 && which g++ >/dev/null 2>&1; then 
    mark_step_skipped 3
else 
    apt install -y build-essential python3 > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        mark_step_completed 3
    else
        mark_step_failed 3
        echo -e "\e[0;33mFailed to install build tools! Exit.\e[0m";
        exit 1;
    fi
fi
if [[ "${STEP_STATUS[3]}" == "$SYMBOL_BUSY" ]]; then
    mark_step_completed 3
fi

# Step 4: Install system packages
mark_step_busy 4
apt update > /dev/null 2>&1
packages=(curl wget tar gzip rsync sqlite3 mosquitto ca-certificates openssl jq)
DEBIAN_FRONTEND=noninteractive apt install -y --no-install-recommends "${packages[@]}" > /dev/null 2>&1
if [ $? -eq 0 ]; then
    mark_step_completed 4
else
    mark_step_failed 4
    echo -e "\e[0;33mFailed to install system packages! Exit.\e[0m";
    exit 1;
fi

##
#   Application Download and Installation
##

# Step 5: Check for the latest release of the Device Hub using the GitHub API
mark_step_busy 5
if [ "$DEV_BUILD" = true ]; then
    # For dev builds, get the latest release (including pre-releases)
    latest_release=$(curl -H "Accept: application/vnd.github.v3+json" -s "https://api.github.com/repos/${GITHUB_REPO}/releases" | jq '.[0]')
    echo -e "\e[0;36mInstalling latest development build...\e[0m"
else
    # For stable builds, get the latest stable release only
    latest_release=$(curl -H "Accept: application/vnd.github.v3+json" -s "https://api.github.com/repos/${GITHUB_REPO}/releases/latest")
    echo -e "\e[0;36mInstalling latest stable release...\e[0m"
fi
# Check if this was successful
if [ -n "$latest_release" ] && [ "$latest_release" != "null" ]; then
    # Extract and display version info
    release_tag=$(echo "$latest_release" | jq -r '.tag_name')
    release_name=$(echo "$latest_release" | jq -r '.name')
    is_prerelease=$(echo "$latest_release" | jq -r '.prerelease')
    
    if [ "$is_prerelease" = "true" ]; then
        echo -e "\e[0;33mNote: Installing pre-release version: $release_name ($release_tag)\e[0m"
    else
        echo -e "\e[0;32mInstalling stable version: $release_name ($release_tag)\e[0m"
    fi
    
    mark_step_completed 5
else
    mark_step_failed 5
    if [ "$DEV_BUILD" = true ]; then
        echo -e "\e[0;33mFailed to get latest ${APPNAME} development release info! Exit.\e[0m";
    else
        echo -e "\e[0;33mFailed to get latest ${APPNAME} release info! Exit.\e[0m";
    fi
    exit 1;
fi

# Step 6: Download the application
mark_step_busy 6
# Get the asset download URLs from the release info
devicehub_url=$(echo "$latest_release" | jq -r '.assets[] | select(.name | test("devicehub-.*\\.tar\\.gz")) | .url')
install_url=$(echo "$latest_release" | jq -r '.assets[] | select(.name == "install.sh") | .url')

# Create temporary directory
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Download both assets
if [ -n "$devicehub_url" ] && [ -n "$install_url" ]; then
    curl -L -H "Accept: application/octet-stream" -H "X-GitHub-Api-Version: 2022-11-28" -o "devicehub.tar.gz" "$devicehub_url" > /dev/null 2>&1
    curl -L -H "Accept: application/octet-stream" -H "X-GitHub-Api-Version: 2022-11-28" -o "install.sh" "$install_url" > /dev/null 2>&1
    
    if [ $? -eq 0 ] && [ -f "devicehub.tar.gz" ] && [ -f "install.sh" ]; then
        mark_step_completed 6
    else
        mark_step_failed 6
        echo -e "\e[0;33mFailed to download application! Exit.\e[0m";
        exit 1;
    fi
else
    mark_step_failed 6
    echo -e "\e[0;33mFailed to get download URLs! Exit.\e[0m";
    exit 1;
fi

# Step 7: Extract application
mark_step_busy 7
chmod +x install.sh
mark_step_completed 7
# Step 8: Install Node dependencies (handled by install.sh)
mark_step_busy 8
mark_step_skipped 8  # This will be handled by the install.sh script

# Step 9: Configure certificates (handled by install.sh)
mark_step_busy 9
mark_step_skipped 9  # This will be handled by the install.sh script

# Step 10: Install systemd services (handled by install.sh)
mark_step_busy 10
mark_step_skipped 10  # This will be handled by the install.sh script

# Step 11: Configure MQTT broker (handled by install.sh)
mark_step_busy 11
mark_step_skipped 11  # This will be handled by the install.sh script

# Step 12: Enable services (handled by install.sh)
mark_step_busy 12
mark_step_skipped 12  # This will be handled by the install.sh script

# Step 13: Start services and run installation
mark_step_busy 13
# Prepare install arguments
install_args=(".")
if [ "$FORCE_CLEAN" = true ]; then
    install_args+=("--force-clean")
    echo -e "\e[0;33mNote: Force clean enabled - all existing data will be removed\e[0m"
fi

# Run the installer
if bash install.sh "${install_args[@]}" > /dev/null 2>&1; then
    mark_step_completed 13
else
    mark_step_failed 13
    echo -e "\e[0;33mInstallation failed! Exit.\e[0m";
    exit 1;
fi

# Step 14: Verify installation
mark_step_busy 14
if systemctl is-active --quiet devicehub-core.service; then
    mark_step_completed 14
else
    mark_step_failed 14
    echo -e "\e[0;33mService verification failed!\e[0m";
fi

##
#   Finish installation
##

# Final progress display
show_progress

# Cleanup temporary files
cd /
rm -rf "$INSTALL_DIR" || true

# We're done. Some notes before we're leaving.
echo ""
echo -e "\e[0;32m\033[1mThe ${APPNAME} was successfully installed! \033[0m\e[0m"; 
echo ""

# Show service status
echo -e "Service Status:"
if command -v systemctl >/dev/null 2>&1; then
    systemctl --no-pager --lines=0 status devicehub-core.service devicehub-provisioning.service devicehub-twin.service devicehub-translator.service 2>/dev/null || true
fi
echo ""

# Show connection information
PRIMARY_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "<your-ip>")
echo -e "To access your Device Hub:"
echo -e "Web Interface: \e[0;32mhttp://${PRIMARY_IP}\e[0m"
echo -e "MQTT Broker: \e[0;32m${PRIMARY_IP}:8883\e[0m (TLS)"
echo -e "Local MQTT: \e[0;32m127.0.0.1:1883\e[0m (no TLS)"
echo ""

echo -e "Configuration files are located in:"
echo -e "  - /etc/Edgeberry/devicehub/"
echo -e "  - /var/lib/edgeberry/devicehub/"
echo ""

echo -e "For troubleshooting:"
echo -e "  - Check logs: journalctl -u devicehub-core.service -f"
echo -e "  - Documentation: https://github.com/${GITHUB_REPO}"
echo ""

# Exit success
exit 0;
