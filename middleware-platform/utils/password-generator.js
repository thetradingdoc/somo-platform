/**
 * PASSWORD GENERATOR UTILITY
 * Generates secure random passwords for new customers
 */

const crypto = require('crypto');

/**
 * Generate a secure random password
 * Format: 12 characters with uppercase, lowercase, numbers, and special chars
 * @returns {string} Generated password
 */
function generatePassword() {
  // Character sets
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numbers = '0123456789';
  const special = '!@#$%^&*';
  
  // Ensure at least one character from each set
  let password = '';
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += special[Math.floor(Math.random() * special.length)];
  
  // Fill the rest with random characters from all sets
  const allChars = lowercase + uppercase + numbers + special;
  for (let i = password.length; i < 12; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }
  
  // Shuffle the password to avoid predictable patterns
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

/**
 * Generate a simpler password (easier to type, still secure)
 * Format: 10 characters, no special chars (just letters and numbers)
 * @returns {string} Generated password
 */
function generateSimplePassword() {
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numbers = '0123456789';
  
  // Ensure at least one character from each set
  let password = '';
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  
  // Fill the rest with random characters
  const allChars = lowercase + uppercase + numbers;
  for (let i = password.length; i < 10; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }
  
  // Shuffle the password
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

module.exports = {
  generatePassword,
  generateSimplePassword
};

