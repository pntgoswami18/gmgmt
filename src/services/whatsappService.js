const { pool } = require('../config/sqlite');

class WhatsAppService {
    constructor() {
        this.baseUrl = 'https://wa.me/';
    }

    /**
     * Send WhatsApp welcome message to member after biometric enrollment
     * @param {number} memberId - Member ID
     * @param {string} memberName - Member name
     * @param {string} memberPhone - Member phone number
     * @param {string} customMessage - Custom welcome message (optional)
     * @returns {Promise<{success: boolean, message?: string, error?: string}>}
     */
    async sendWelcomeMessage(memberId, memberName, memberPhone, customMessage = null) {
        try {
            console.log(`📱 Sending WhatsApp welcome message to member ${memberId} (${memberName})`);

            // Get WhatsApp settings from database
            const settingsResult = await pool.query('SELECT value FROM settings WHERE key = ?', ['whatsapp_welcome_enabled']);
            const isEnabled = settingsResult.rows.length > 0 && settingsResult.rows[0].value === 'true';

            if (!isEnabled) {
                console.log('📱 WhatsApp welcome messages are disabled');
                return { success: false, error: 'WhatsApp welcome messages are disabled' };
            }

            // Get custom message if not provided
            if (!customMessage) {
                const messageResult = await pool.query('SELECT value FROM settings WHERE key = ?', ['whatsapp_welcome_message']);
                customMessage = messageResult.rows.length > 0 ? messageResult.rows[0].value : 'Welcome to our gym! Your biometric enrollment is complete. You can now access the gym using your fingerprint. Enjoy your workouts!';
            }

            // Validate phone number
            if (!memberPhone || !this.isValidPhone(memberPhone)) {
                console.log(`📱 Invalid phone number for member ${memberId}: ${memberPhone}`);
                return { success: false, error: 'Invalid phone number' };
            }

            // Format phone number (remove all non-digits and add country code if needed)
            const formattedPhone = this.formatPhoneNumber(memberPhone);
            
            // Personalize the message
            const personalizedMessage = customMessage.replace(/\{memberName\}/g, memberName);
            
            // Create WhatsApp URL
            const whatsappUrl = `${this.baseUrl}${formattedPhone}?text=${encodeURIComponent(personalizedMessage)}`;

            // Log the WhatsApp message attempt
            await this.logWhatsAppMessage(memberId, memberName, formattedPhone, personalizedMessage, 'welcome');

            console.log(`📱 WhatsApp welcome message prepared for ${memberName}: ${whatsappUrl}`);

            return {
                success: true,
                message: 'WhatsApp welcome message prepared successfully',
                whatsappUrl: whatsappUrl,
                formattedMessage: personalizedMessage
            };

        } catch (error) {
            console.error('📱 Error sending WhatsApp welcome message:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Validate phone number format
     * @param {string} phone - Phone number to validate
     * @returns {boolean}
     */
    isValidPhone(phone) {
        if (!phone || typeof phone !== 'string') {
            return false;
        }
        
        const digits = phone.replace(/\D/g, '');
        return digits.length >= 10 && digits.length <= 15;
    }

    /**
     * Format phone number for WhatsApp
     * @param {string} phone - Raw phone number
     * @returns {string} - Formatted phone number
     */
    formatPhoneNumber(phone) {
        if (!phone) {
            return '';
        }
        
        // Remove all non-digit characters
        let digits = phone.replace(/\D/g, '');
        
        // If it starts with 0, remove it
        if (digits.startsWith('0')) {
            digits = digits.substring(1);
        }
        
        // If it doesn't start with country code, assume Indian number and add +91
        if (digits.length === 10) {
            digits = '91' + digits;
        }
        
        return digits;
    }

    /**
     * Log WhatsApp message attempt
     * @param {number} memberId - Member ID
     * @param {string} memberName - Member name
     * @param {string} phone - Phone number
     * @param {string} message - Message content
     * @param {string} type - Message type (welcome, reminder, etc.)
     */
    async logWhatsAppMessage(memberId, memberName, phone, message, type) {
        try {
            const logData = {
                member_id: memberId,
                member_name: memberName,
                phone: phone,
                message: message,
                message_type: type,
                timestamp: new Date().toISOString(),
                status: 'prepared'
            };

            // Insert into WhatsApp logs table (create if doesn't exist)
            await pool.query(`
                CREATE TABLE IF NOT EXISTS whatsapp_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    member_id INTEGER,
                    member_name TEXT,
                    phone TEXT,
                    message TEXT,
                    message_type TEXT,
                    timestamp TEXT,
                    status TEXT,
                    error_message TEXT
                )
            `);

            await pool.query(`
                INSERT INTO whatsapp_logs (member_id, member_name, phone, message, message_type, timestamp, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [memberId, memberName, phone, message, type, logData.timestamp, 'prepared']);

            console.log(`📱 WhatsApp message logged for member ${memberId}`);

        } catch (error) {
            console.error('📱 Error logging WhatsApp message:', error);
        }
    }

    /**
     * Get WhatsApp message history for a member
     * @param {number} memberId - Member ID
     * @returns {Promise<Array>} - Array of WhatsApp messages
     */
    async getWhatsAppHistory(memberId) {
        try {
            const result = await pool.query(`
                SELECT * FROM whatsapp_logs 
                WHERE member_id = ? 
                ORDER BY timestamp DESC 
                LIMIT 10
            `, [memberId]);

            return result.rows;
        } catch (error) {
            console.error('📱 Error getting WhatsApp history:', error);
            return [];
        }
    }

    /**
     * Get WhatsApp settings
     * @returns {Promise<Object>} - WhatsApp settings
     */
    async getWhatsAppSettings() {
        try {
            const enabledResult = await pool.query('SELECT value FROM settings WHERE key = ?', ['whatsapp_welcome_enabled']);
            const messageResult = await pool.query('SELECT value FROM settings WHERE key = ?', ['whatsapp_welcome_message']);

            return {
                enabled: enabledResult.rows.length > 0 && enabledResult.rows[0].value === 'true',
                message: messageResult.rows.length > 0 ? messageResult.rows[0].value : 'Welcome to our gym! Your biometric enrollment is complete. You can now access the gym using your fingerprint. Enjoy your workouts!'
            };
        } catch (error) {
            console.error('📱 Error getting WhatsApp settings:', error);
            return {
                enabled: false,
                message: 'Welcome to our gym! Your biometric enrollment is complete. You can now access the gym using your fingerprint. Enjoy your workouts!'
            };
        }
    }
}

module.exports = new WhatsAppService();
