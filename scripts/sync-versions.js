#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Load version from root package.json
const rootPackagePath = path.join(__dirname, '..', 'package.json');
const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, 'utf8'));
const targetVersion = rootPackage.version;

// Package paths to update (excluding root package.json)
const packagePaths = [
  'core-service/package.json',
  'provisioning-service/package.json',
  'twin-service/package.json',
  'translator-service/package.json',
  'ui/package.json',
  'examples/nodered/package.json',
  'examples/virtual-device/package.json',
  'examples/device-client/package.json'
];

function updatePackageVersions(packagePath) {
  const fullPath = path.join(__dirname, '..', packagePath);
  
  if (!fs.existsSync(fullPath)) {
    console.log(`⚠️  Package not found: ${packagePath}`);
    return;
  }

  const pkg = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  
  // Update package version only
  pkg.version = targetVersion;
  
  // Write back to file with proper formatting
  fs.writeFileSync(fullPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`✅ Updated ${packagePath} to version ${targetVersion}`);
}

console.log('🔄 Synchronizing package versions...\n');

// Update all packages
packagePaths.forEach(updatePackageVersions);

console.log(`\n✨ All packages synchronized to version ${targetVersion}`);
console.log('📝 Don\'t forget to run npm install in each service directory to update lock files');
