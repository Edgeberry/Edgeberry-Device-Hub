/**
 * Password hashing and validation utilities
 * Uses bcrypt for secure password storage
 */
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 10;

/**
 * Hash a plain text password
 */
export async function hashPassword(plainPassword: string): Promise<string> {
  return await bcrypt.hash(plainPassword, SALT_ROUNDS);
}

/**
 * Verify a plain text password against a hashed password
 */
export async function verifyPassword(plainPassword: string, hashedPassword: string): Promise<boolean> {
  return await bcrypt.compare(plainPassword, hashedPassword);
}

/**
 * Validate password strength
 * Returns error message if invalid, null if valid
 */
export function validatePasswordStrength(password: string): string | null {
  if (!password || password.length < 8) {
    return 'Password must be at least 8 characters long';
  }
  if (password.length > 128) {
    return 'Password must be less than 128 characters';
  }
  // Optional: Add more strength requirements here
  // For now, just enforce minimum length
  return null;
}
