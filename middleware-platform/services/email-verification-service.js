/**
 * EMAIL VERIFICATION SERVICE
 * Handles email verification codes for checkout
 */

const crypto = require('crypto');
const db = require('../database');
const EmailService = require('./email-service');

class EmailVerificationService {
    /**
     * Generate a 6-digit verification code
     */
    static generateCode() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    /**
     * Send verification code to email
     * @param {string} email - Customer email address
     * @param {string} customerId - Optional customer ID
     * @param {string} customerName - Optional customer name
     * @returns {Promise<Object>} Result with code and expiration
     */
    static async sendVerificationCode(email, customerId = null, customerName = null) {
        try {
            // Validate email format
            if (!email || !this.isValidEmail(email)) {
                throw new Error('Invalid email address');
            }

            // Generate code
            const code = this.generateCode();
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

            console.log('\n📧 EMAIL VERIFICATION: Sending Code');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log(`Email: ${email}`);
            console.log(`Code: ${code}`);
            console.log(`Expires: ${expiresAt.toISOString()}`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

            // Store code in database
            db.createEmailVerificationCode(
                email.toLowerCase().trim(),
                code,
                customerId
            );

            // Send email
            const emailResult = await EmailService.sendCheckoutVerificationCode(email, code);

            if (!emailResult.success) {
                console.error('❌ Failed to send verification email:', emailResult.error);
                // Still return success since code is stored - email might be delayed
            }

            return {
                success: true,
                code: code, // For testing/debugging - remove in production
                expires_at: expiresAt,
                email_sent: emailResult.success,
                message: 'Verification code sent to email'
            };

        } catch (error) {
            console.error('❌ Email verification error:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Verify code for email
     * @param {string} email - Customer email address
     * @param {string} code - Verification code
     * @returns {Promise<Object>} Verification result
     */
    static async verifyCode(email, code) {
        try {
            if (!email || !code) {
                return {
                    success: false,
                    error: 'Email and code are required'
                };
            }

            const normalizedEmail = email.toLowerCase().trim();

            // Verify code using database method
            const verification = db.verifyEmailCode(normalizedEmail, code);

            if (!verification) {
                console.log('❌ Verification code not found, invalid, or expired');
                return {
                    success: false,
                    error: 'Invalid or expired verification code. Please request a new one.'
                };
            }

            console.log('✅ Email verified successfully');
            return {
                success: true,
                email: normalizedEmail,
                customer_id: verification.customer_id,
                message: 'Email verified successfully'
            };

        } catch (error) {
            console.error('❌ Verification error:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Check if email is verified (has valid, unused code)
     * @param {string} email - Customer email address
     * @returns {boolean} True if email has been verified
     */
    static isEmailVerified(email) {
        try {
            const normalizedEmail = email.toLowerCase().trim();
            
            // Check if there's a verified code (verified = 1 means it was successfully verified)
            // SQLite stores booleans as 0/1, so check for both
            let verifiedCode;
            try {
                // Query for verified codes (verified = 1 or verified = true)
                verifiedCode = db.db.prepare(`
                    SELECT * FROM email_verification_codes 
                    WHERE email = ? AND (verified = 1 OR verified = true)
                    ORDER BY verified_at DESC LIMIT 1
                `).get(normalizedEmail);
                
                console.log(`   Query result for ${normalizedEmail}:`, verifiedCode ? 'Found verified code' : 'No verified code found');
                if (verifiedCode) {
                    console.log(`   Verified at: ${verifiedCode.verified_at}, Verified value: ${verifiedCode.verified}`);
                }
            } catch (dbError) {
                console.error('Database query error:', dbError.message);
                console.error('Stack:', dbError.stack);
                return false;
            }
            
            if (verifiedCode) {
                // Check if verification is still valid (within last hour)
                // SQLite stores datetime as string, parse it properly
                let verifiedAt = null;
                if (verifiedCode.verified_at) {
                    // Handle both ISO format and SQLite datetime format
                    verifiedAt = new Date(verifiedCode.verified_at);
                    // If parsing failed, try SQLite format
                    if (isNaN(verifiedAt.getTime())) {
                        // SQLite format: "2025-12-05 13:45:04"
                        verifiedAt = new Date(verifiedCode.verified_at.replace(' ', 'T') + 'Z');
                    }
                }
                
                if (verifiedAt && !isNaN(verifiedAt.getTime())) {
                    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
                    
                    if (verifiedAt > oneHourAgo) {
                        console.log(`✅ Email ${normalizedEmail} verified at ${verifiedAt.toISOString()}`);
                        return true;
                    } else {
                        console.log(`⚠️  Email verification expired for ${normalizedEmail} (verified at ${verifiedAt.toISOString()})`);
                        return false;
                    }
                } else {
                    // Verified but timestamp parsing failed - still consider it verified if verified = 1
                    if (verifiedCode.verified === 1 || verifiedCode.verified === true) {
                        console.log(`✅ Email ${normalizedEmail} verified (verified flag set, timestamp: ${verifiedCode.verified_at})`);
                        return true;
                    }
                }
            }
            
            // Also check for active unverified code (just sent, not yet verified)
            const activeCode = db.getActiveEmailVerificationCode(normalizedEmail);
            if (activeCode) {
                console.log(`📧 Active verification code exists for ${normalizedEmail} (not yet verified)`);
                return false; // Code exists but not verified yet
            }
            
            console.log(`❌ No verification found for ${normalizedEmail}`);
            return false;
        } catch (error) {
            console.error('❌ Error checking email verification:', error.message);
            console.error('Stack:', error.stack);
            return false;
        }
    }

    /**
     * Validate email format
     */
    static isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    /**
     * Get verification status for email
     */
    static getVerificationStatus(email) {
        try {
            const normalizedEmail = email.toLowerCase().trim();
            const isVerified = this.isEmailVerified(normalizedEmail);
            if (isVerified) {
                return {
                    verified: true,
                    has_code: true,
                    message: 'Email verified'
                };
            }
            const verification = db.getActiveEmailVerificationCode(normalizedEmail);

            if (!verification) {
                return {
                    verified: false,
                    has_code: false,
                    message: 'No active verification code. Please request a new one.'
                };
            }

            const expiresAt = new Date(verification.expires_at);

            return {
                verified: false,
                has_code: true,
                expires_at: expiresAt,
                message: 'Verification code sent. Awaiting confirmation.'
            };

        } catch (error) {
            console.error('❌ Error getting verification status:', error.message);
            return {
                verified: false,
                error: error.message
            };
        }
    }
}

module.exports = EmailVerificationService;

