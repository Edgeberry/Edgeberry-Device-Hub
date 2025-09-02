#!/usr/bin/env node

// Test script for device naming functionality
// Tests the EDGB-<first 4 UUID chars> default naming and validation

const { generateDefaultDeviceName, validateDeviceName, sanitizeDeviceName } = require('../core-service/dist/device-names.js');

console.log('=== Device Naming Tests ===\n');

// Test UUID from the whitelist
const testUuid = '9205255a-6767-4a8f-8a8b-499239906911';

console.log('1. Default Name Generation:');
console.log(`UUID: ${testUuid}`);
const defaultName = generateDefaultDeviceName(testUuid);
console.log(`Generated name: ${defaultName}`);
console.log(`Expected: EDGB-9205\n`);

console.log('2. Name Validation Tests:');

const testCases = [
  { name: 'EDGB-9205', expected: true, desc: 'Valid default name' },
  { name: 'MyDevice123', expected: true, desc: 'Valid custom name' },
  { name: 'device_test-01', expected: true, desc: 'Valid with underscore and hyphen' },
  { name: 'ABC', expected: false, desc: 'Too short (< 4 chars)' },
  { name: 'a'.repeat(35), expected: false, desc: 'Too long (> 32 chars)' },
  { name: 'Device With Spaces', expected: false, desc: 'Contains spaces' },
  { name: 'device@test', expected: false, desc: 'Contains forbidden character @' },
  { name: '-invalid', expected: false, desc: 'Starts with hyphen' },
  { name: '_invalid', expected: false, desc: 'Starts with underscore' },
  { name: '123valid', expected: true, desc: 'Starts with number' },
];

testCases.forEach((test, i) => {
  const result = validateDeviceName(test.name);
  const passed = result.valid === test.expected;
  console.log(`${i + 1}. ${test.desc}: ${passed ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`   Name: "${test.name}" | Valid: ${result.valid} | Expected: ${test.expected}`);
  if (result.error) {
    console.log(`   Error: ${result.error}`);
  }
  if (result.sanitized) {
    console.log(`   Sanitized: "${result.sanitized}"`);
  }
  console.log('');
});

console.log('3. Sanitization Tests:');

const sanitizeTests = [
  { input: 'Device With Spaces', desc: 'Remove spaces' },
  { input: 'test@device#123', desc: 'Remove special chars' },
  { input: '-_invalid_start', desc: 'Fix invalid start' },
  { input: 'ab', desc: 'Too short, pad with default' },
];

sanitizeTests.forEach((test, i) => {
  const sanitized = sanitizeDeviceName(test.input);
  console.log(`${i + 1}. ${test.desc}:`);
  console.log(`   Input: "${test.input}"`);
  console.log(`   Sanitized: "${sanitized}"`);
  console.log('');
});

console.log('4. Edge Cases:');

try {
  generateDefaultDeviceName('');
  console.log('✗ FAIL: Should throw error for empty UUID');
} catch (e) {
  console.log('✓ PASS: Correctly throws error for empty UUID');
}

try {
  generateDefaultDeviceName('abc');
  console.log('✗ FAIL: Should throw error for short UUID');
} catch (e) {
  console.log('✓ PASS: Correctly throws error for short UUID');
}

console.log('\n=== Test Complete ===');
