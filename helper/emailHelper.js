const nodemailer = require('nodemailer');
const { messagesEnglish } = require("../helper/appConstant");

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.AUTH_USER,
        pass: process.env.AUTH_PASS
    }
})
module.exports.sendEmail = (email, subject, data) => {

    const mailOption = {
        from: `${messagesEnglish.appName} <${process.env.AUTH_USER}>`,
        to: email,
        subject: subject,
        html: data
    }

    transporter.sendMail(mailOption).then().catch(err => console.log("Email service error :::::", err));
}
