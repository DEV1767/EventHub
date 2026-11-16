import { qstashReceiver } from "../config/qstash.js"
import { sendDirectEmail } from "../utils/email.js"
import { ApiError, ApiResponse } from "../utils/apiHandler.js"
import asyncHandler from "../utils/asyncHandler.js"

export const handleQStashNotification = asyncHandler(async (req, res) => {
    const signature = req.headers["upstash-signature"]

    if (process.env.NODE_ENV === "production" && signature) {
        const isValid = await qstashReceiver.verify({
            signature,
            body: typeof req.body === "string" ? req.body : JSON.stringify(req.body)
        })
        if (!isValid) {
            throw new ApiError(401, "Invalid QStash webhook signature")
        }
    }

    const payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body
    const { type, data } = payload

    if (type === "REGISTRATION_CONFIRMED") {
        await sendDirectEmail({
            to: data.userEmail,
            subject: `Registration Confirmed: ${data.eventTitle}`,
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                    <h2 style="color: #4CAF50;">Registration Confirmed!</h2>
                    <p>Dear <strong>${data.userName}</strong>,</p>
                    <p>You have successfully registered for <strong>${data.eventTitle}</strong>.</p>
                    <p><strong>Registration Number:</strong> ${data.registrationNumber}</p>
                    <p><strong>Team Name:</strong> ${data.teamName}</p>
                    <p><strong>Payment Status:</strong> ${data.paymentStatus}</p>
                    <br/>
                    <p>Best regards,<br/>EventHub Fest Operations Team</p>
                </div>
            `
        })
    } else if (type === "EXPENSE_APPROVED") {
        await sendDirectEmail({
            to: data.coordinatorEmail,
            subject: `Expense Claim Approved: ${data.claimTitle}`,
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                    <h2 style="color: #2196F3;">Expense Claim Approved</h2>
                    <p>Dear <strong>${data.coordinatorName}</strong>,</p>
                    <p>Your reimbursement claim for <strong>${data.claimTitle}</strong> has been approved.</p>
                    <p><strong>Approved Amount:</strong> ₹${data.approvedAmount}</p>
                    <br/>
                    <p>Best regards,<br/>EventHub Accounts Desk</p>
                </div>
            `
        })
    } else if (type === "OTP_SENT") {
        await sendDirectEmail({
            to: data.email,
            subject: "EventHub Registration Verification OTP",
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                    <h2 style="color: #4CAF50;">Verify Your Email</h2>
                    <p>Your one-time verification code for EventHub registration is:</p>
                    <h1 style="color: #4CAF50; letter-spacing: 6px; font-size: 32px;">${data.otp}</h1>
                    <p>This code will expire in <strong>5 minutes</strong>. If you did not request this, please ignore this email.</p>
                    <br/>
                    <p>Best regards,<br/>EventHub Security Team</p>
                </div>
            `
        })
    }

    return res.status(200).json(
        new ApiResponse(200, {}, "Webhook processed successfully")
    )
})