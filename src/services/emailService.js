const nodemailer = require('nodemailer');
require('dotenv').config();

// Create a transporter object
const transporter = nodemailer.createTransporter({
    service: 'gmail', // You can use other services like SendGrid, Mailgun, etc.
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Email templates
const emailTemplates = {
    welcome: (memberName, memberEmail) => ({
        from: process.env.EMAIL_USER,
        to: memberEmail,
        subject: 'Welcome to Our Gym!',
        html: `
            <h2>Welcome to our gym family, ${memberName}!</h2>
            <p>We're excited to have you as a new member. Here's what you can expect:</p>
            <ul>
                <li>Access to all gym equipment and facilities</li>
                <li>Variety of fitness classes</li>
                <li>Professional guidance from our trainers</li>
                <li>Online booking system for classes</li>
            </ul>
            <p>If you have any questions, feel free to contact us.</p>
            <p>Best regards,<br>The Gym Management Team</p>
        `
    }),

    bookingConfirmation: (memberName, memberEmail, className, startTime) => ({
        from: process.env.EMAIL_USER,
        to: memberEmail,
        subject: 'Class Booking Confirmation',
        html: `
            <h2>Booking Confirmed!</h2>
            <p>Hi ${memberName},</p>
            <p>Your booking has been confirmed for:</p>
            <div style="background-color: #f0f8ff; padding: 15px; border-radius: 5px; margin: 10px 0;">
                <strong>Class:</strong> ${className}<br>
                <strong>Date & Time:</strong> ${new Date(startTime).toLocaleString()}
            </div>
            <p>Please arrive 10 minutes early. Don't forget to bring your water bottle!</p>
            <p>See you soon!<br>The Gym Management Team</p>
        `
    }),

    paymentConfirmation: (memberName, memberEmail, amount, planName) => ({
        from: process.env.EMAIL_USER,
        to: memberEmail,
        subject: 'Payment Confirmation',
        html: `
            <h2>Payment Received</h2>
            <p>Hi ${memberName},</p>
            <p>Thank you for your payment! Here are the details:</p>
            <div style="background-color: #f0f8ff; padding: 15px; border-radius: 5px; margin: 10px 0;">
                <strong>Plan:</strong> ${planName}<br>
                <strong>Amount:</strong> $${amount}
            </div>
            <p>Your membership is now active. Enjoy your workouts!</p>
            <p>Best regards,<br>The Gym Management Team</p>
        `
    })
};

// Function to send emails
const sendEmail = async (template, data) => {
    try {
        const mailOptions = emailTemplates[template](...data);
        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent: ' + info.response);
        return { success: true, info };
    } catch (error) {
        console.error('Error sending email:', error);
        return { success: false, error };
    }
};

module.exports = { sendEmail };