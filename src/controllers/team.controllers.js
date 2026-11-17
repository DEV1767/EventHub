import mongoose from "mongoose"
import Team from "../models/team.models.js"
import Event from "../models/event.models.js"
import Coordinator from "../models/coordinator.models.js"
import { ApiError, ApiResponse } from "../utils/apiHandler.js"
import asyncHandler from "../utils/asyncHandler.js"
import { uploadOnCloudinary } from "../utils/cloudinary.js"
import { dispatchNotificationWithFallback } from "../utils/email.js"
import redisClient from "../config/redis.js"
import { generateRegistrationQR, verifyQrPayload } from "../utils/qr.js"

export const registerTeam = asyncHandler(async (req, res) => {
    const { eventId } = req.params
    const { teamName, members, paymentMethod, transactionId } = req.body

    const event = await Event.findById(eventId)
    if (!event) {
        throw new ApiError(404, "Event not found")
    }

    if (event.status === "Cancelled" || event.status === "Completed") {
        throw new ApiError(400, "Registration is closed for this event")
    }

    const now = new Date()
    if (event.registrationEndDate && now > new Date(event.registrationEndDate)) {
        throw new ApiError(400, "Registration deadline for this event has passed")
    }

    if (event.registrationStartDate && now < new Date(event.registrationStartDate)) {
        throw new ApiError(400, "Registration has not started yet")
    }

    if (event.registeredCount >= event.maxParticipants) {
        throw new ApiError(400, "Event registration capacity has been reached")
    }

    let parsedMembers = []
    if (members) {
        if (typeof members === "string") {
            try {
                parsedMembers = JSON.parse(members)
            } catch {
                throw new ApiError(400, "Invalid members payload")
            }
        } else if (Array.isArray(members)) {
            parsedMembers = members
        }
    }

    const leaderMember = {
        userId: req.user._id,
        name: req.user.name,
        email: req.user.email,
        phonenumber: req.user.phonenumber,
        department: req.user.department || ""
    }

    const allMembers = [leaderMember, ...parsedMembers.filter(m => m.email !== req.user.email)]
    const totalTeamSize = allMembers.length

    if (event.participationType === "Team") {
        if (totalTeamSize < event.teamSize.min) {
            throw new ApiError(400, `Team must have at least ${event.teamSize.min} members`)
        }
        if (totalTeamSize > event.teamSize.max) {
            throw new ApiError(400, `Team cannot exceed ${event.teamSize.max} members`)
        }
    } else if (event.participationType === "Individual") {
        if (totalTeamSize > 1) {
            throw new ApiError(400, "This is an individual participation event")
        }
    }

    const existingTeam = await Team.findOne({
        eventId,
        $or: [
            { leaderId: req.user._id },
            { teamName: teamName?.trim() || req.user.name }
        ]
    })

    if (existingTeam) {
        throw new ApiError(409, "You have already registered for this event or team name is taken")
    }

    const leaderIdCardPath = req.files?.leaderIdCard?.[0]?.path || req.files?.idCard?.[0]?.path
    if (!leaderIdCardPath) {
        throw new ApiError(400, "Team leader's college ID card image is required")
    }

    const leaderIdCardUpload = await uploadOnCloudinary(leaderIdCardPath, "eventhub/id_cards")
    if (!leaderIdCardUpload?.url) {
        throw new ApiError(500, "Failed to upload team leader's ID card image")
    }

    const leaderIdCard = {
        url: leaderIdCardUpload.url,
        public_id: leaderIdCardUpload.public_id
    }

    let submissionDocument = { url: "", public_id: "", originalName: "", submittedAt: undefined }
    let submissionStatus = "not_required"
    let effectiveFee = event.registrationFee || 0
    let paymentStatus = "not_required"
    let registrationStatus = "confirmed"
    let amountPaid = 0
    let paymentScreenshot = { url: "", public_id: "" }

    if (event.submissionSettings?.isRequired) {
        const submissionDocPath = req.files?.submissionDocument?.[0]?.path || req.file?.path
        if (!submissionDocPath) {
            throw new ApiError(400, "Project presentation document (PPT or PDF) is required for this event")
        }

        const maxBytes = (event.submissionSettings.maxSizeMB || 15) * 1024 * 1024
        const docSize = req.files?.submissionDocument?.[0]?.size || req.file?.size
        if (docSize && docSize > maxBytes) {
            throw new ApiError(400, `Presentation file size exceeds the allowed limit of ${event.submissionSettings.maxSizeMB} MB`)
        }

        const docUpload = await uploadOnCloudinary(submissionDocPath, "eventhub/submissions")
        if (!docUpload?.url) {
            throw new ApiError(500, "Failed to upload presentation document")
        }

        submissionDocument = {
            url: docUpload.url,
            public_id: docUpload.public_id,
            originalName: req.files?.submissionDocument?.[0]?.originalname || req.file?.originalname || "presentation",
            submittedAt: new Date()
        }
        submissionStatus = "pending"
        registrationStatus = "pending"
        effectiveFee = event.submissionSettings.initialRegistrationFee || 0
    }

    if (effectiveFee > 0) {
        amountPaid = effectiveFee
        if (paymentMethod === "manual_upi") {
            if (!transactionId || !/^\d{12}$/.test(transactionId.trim())) {
                throw new ApiError(400, "Manual UPI payment requires a valid 12-digit numeric transaction reference (UTR)")
            }

            const existingTx = await Team.findOne({ transactionId: transactionId.trim() })
            if (existingTx) {
                throw new ApiError(409, "This transaction reference (UTR) has already been submitted")
            }

            const screenshotPath = req.files?.paymentScreenshot?.[0]?.path || req.file?.path
            if (!screenshotPath) {
                throw new ApiError(400, "Payment proof screenshot is required for manual UPI verification")
            }

            const uploadRes = await uploadOnCloudinary(screenshotPath, "eventhub/payments")
            if (!uploadRes?.url) {
                throw new ApiError(500, "Failed to upload payment receipt screenshot")
            }

            paymentScreenshot = {
                url: uploadRes.url,
                public_id: uploadRes.public_id
            }
            paymentStatus = "pending"
            registrationStatus = "pending"
        } else if (paymentMethod === "free") {
            throw new ApiError(400, "This event requires a registration fee")
        }
    }

    const regNumber = `REG-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`

    const team = await Team.create({
        eventId,
        teamName: teamName?.trim() || `${req.user.name}'s Team`,
        leaderId: req.user._id,
        leaderIdCard,
        collegename: req.user.collegename,
        members: allMembers,
        paymentMethod: effectiveFee > 0 ? (paymentMethod || "manual_upi") : "free",
        amountPaid,
        transactionId: effectiveFee > 0 && transactionId ? transactionId.trim() : undefined,
        paymentScreenshot,
        paymentStatus,
        registrationStatus,
        registrationNumber: regNumber,
        submissionDocument,
        submissionStatus
    })

    await Event.findByIdAndUpdate(eventId, {
        $inc: { registeredCount: 1 }
    })

    if (registrationStatus === "confirmed") {
        team.qrCode = await generateRegistrationQR(team._id, regNumber, eventId)
        await team.save()
    }

    dispatchNotificationWithFallback({
        to: req.user.email,
        subject: `Registration Confirmed: ${event.title}`,
        html: `<h2>Hello ${req.user.name},</h2><p>Your registration for <strong>${event.title}</strong> is confirmed!</p><p>Registration Number: <strong>${regNumber}</strong></p><p>Team Name: <strong>${team.teamName}</strong></p>`,
        qstashPayload: {
            type: "REGISTRATION_CONFIRMED",
            data: {
                userEmail: req.user.email,
                userName: req.user.name,
                eventTitle: event.title,
                registrationNumber: regNumber,
                teamName: team.teamName,
                paymentStatus
            }
        }
    })

    return res.status(201).json(
        new ApiResponse(201, team, "Team registered successfully")
    )
})

export const getMyRegistrations = asyncHandler(async (req, res) => {
    const registrations = await Team.find({
        $or: [
            { leaderId: req.user._id },
            { "members.userId": req.user._id },
            { "members.email": req.user.email }
        ]
    })
        .populate("eventId", "title venue startDate endDate banner registrationFee status")
        .sort({ createdAt: -1 })

    return res.status(200).json(
        new ApiResponse(200, registrations, "Registrations fetched successfully")
    )
})

export const getEventTeams = asyncHandler(async (req, res) => {
    const { eventId } = req.params
    const { paymentStatus, registrationStatus, checkedIn, search } = req.query

    const event = await Event.findById(eventId)
    if (!event) {
        throw new ApiError(404, "Event not found")
    }

    const isCreator = event.createdBy.toString() === req.user._id.toString()
    const isCoordinator = await Coordinator.exists({
        eventId,
        userId: req.user._id,
        invitationStatus: "accepted"
    })
    const isAdmin = req.user.role === "admin"

    if (!isCreator && !isCoordinator && !isAdmin) {
        throw new ApiError(403, "Access denied: You are not authorized to view this event's registrations")
    }

    const filter = { eventId }
    if (paymentStatus) filter.paymentStatus = paymentStatus
    if (registrationStatus) filter.registrationStatus = registrationStatus
    if (checkedIn !== undefined) filter.checkedIn = checkedIn === "true"

    if (search) {
        filter.$or = [
            { teamName: { $regex: search, $options: "i" } },
            { registrationNumber: { $regex: search, $options: "i" } },
            { transactionId: { $regex: search, $options: "i" } },
            { "members.name": { $regex: search, $options: "i" } },
            { "members.email": { $regex: search, $options: "i" } }
        ]
    }

    const teams = await Team.find(filter)
        .populate("leaderId", "name email phonenumber collegename department")
        .populate("verifiedBy", "name email")
        .populate("checkedInBy", "name email")
        .sort({ createdAt: -1 })

    return res.status(200).json(
        new ApiResponse(200, teams, "Event teams fetched successfully")
    )
})

export const verifyPayment = asyncHandler(async (req, res) => {
    const { teamId } = req.params
    const { status, rejectionReason } = req.body

    if (!["verified", "rejected"].includes(status)) {
        throw new ApiError(400, "Status must be either 'verified' or 'rejected'")
    }

    const team = await Team.findById(teamId).populate("eventId")
    if (!team) {
        throw new ApiError(404, "Team registration not found")
    }

    const event = team.eventId
    const isCreator = event.createdBy.toString() === req.user._id.toString()
    const isCoordinator = await Coordinator.exists({
        eventId: event._id,
        userId: req.user._id,
        invitationStatus: "accepted"
    })
    const isAdmin = req.user.role === "admin"

    if (!isCreator && !isCoordinator && !isAdmin) {
        throw new ApiError(403, "Only the event faculty in-charge or authorized coordinator can verify payments")
    }

    team.paymentStatus = status
    team.verifiedBy = req.user._id
    team.verifiedAt = new Date()

    if (status === "verified") {
        team.registrationStatus = "confirmed"
        team.rejectionReason = ""
        if (!team.qrCode) {
            team.qrCode = await generateRegistrationQR(team._id, team.registrationNumber, team.eventId)
        }
    } else {
        team.registrationStatus = "cancelled"
        team.rejectionReason = rejectionReason || "Payment verification failed"
    }

    await team.save()

    return res.status(200).json(
        new ApiResponse(200, team, `Payment successfully ${status}`)
    )
})

export const checkInTeam = asyncHandler(async (req, res) => {
    const { teamId } = req.params

    const team = await Team.findById(teamId).populate("eventId")
    if (!team) {
        throw new ApiError(404, "Team registration not found")
    }

    if (team.registrationStatus !== "confirmed") {
        throw new ApiError(400, "Cannot check in a team whose registration is not confirmed")
    }

    const event = team.eventId
    const isCreator = event.createdBy.toString() === req.user._id.toString()
    const isCoordinator = await Coordinator.exists({
        eventId: event._id,
        userId: req.user._id,
        invitationStatus: "accepted"
    })
    const isAdmin = req.user.role === "admin"

    if (!isCreator && !isCoordinator && !isAdmin) {
        throw new ApiError(403, "Only the event faculty in-charge or authorized coordinator can perform check-in")
    }

    team.checkedIn = true
    team.checkedInAt = new Date()
    team.checkedInBy = req.user._id

    await team.save()

    const regNo = team.registrationNumber || team._id.toString()
    try {
        await Promise.all([
            redisClient.sRem(`event:${event._id}:pending_checkin`, regNo),
            redisClient.sAdd(`event:${event._id}:checked_in`, regNo)
        ])
        const rawTeam = await redisClient.hGet(`event:${event._id}:teams`, regNo)
        if (rawTeam) {
            const parsed = JSON.parse(rawTeam)
            parsed.checkedIn = true
            parsed.checkedInAt = team.checkedInAt
            await redisClient.hSet(`event:${event._id}:teams`, regNo, JSON.stringify(parsed))
        }
    } catch {
    }

    return res.status(200).json(
        new ApiResponse(200, team, "Team checked in successfully")
    )
})

export const reviewTeamSubmission = asyncHandler(async (req, res) => {
    const { teamId } = req.params
    const { status, feedback } = req.body

    if (!["shortlisted", "rejected"].includes(status)) {
        throw new ApiError(400, "Review status must be either 'shortlisted' or 'rejected'")
    }

    const team = await Team.findById(teamId).populate("eventId leaderId")
    if (!team) {
        throw new ApiError(404, "Team registration not found")
    }

    const event = team.eventId
    const isCreator = event.createdBy.toString() === req.user._id.toString()
    const isCoordinator = await Coordinator.exists({
        eventId: event._id,
        userId: req.user._id,
        invitationStatus: "accepted"
    })
    const isAdmin = req.user.role === "admin"

    if (!isCreator && !isCoordinator && !isAdmin) {
        throw new ApiError(403, "Only the event faculty in-charge or authorized coordinator can evaluate submissions")
    }

    team.submissionStatus = status
    team.submissionReview = {
        feedback: feedback?.trim() || "",
        reviewedBy: req.user._id,
        reviewedAt: new Date()
    }

    const finalFee = event.submissionSettings?.finalParticipationFee || 0

    if (status === "shortlisted") {
        if (finalFee > 0) {
            team.finalPayment.status = "pending"
            team.finalPayment.amount = finalFee
        } else {
            team.registrationStatus = "confirmed"
        }

        dispatchNotificationWithFallback({
            to: team.leaderId.email,
            subject: `Shortlisted for Final Round: ${event.title}`,
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                    <h2 style="color: #4CAF50;">Congratulations! Your Team is Shortlisted</h2>
                    <p>Dear <strong>${team.leaderId.name}</strong>,</p>
                    <p>Your team <strong>${team.teamName}</strong> has been selected in the presentation screening round for <strong>${event.title}</strong>.</p>
                    ${feedback ? `<p><strong>Reviewer Feedback:</strong> ${feedback}</p>` : ""}
                    ${finalFee > 0 ? `<p><strong>Next Step:</strong> Please complete the final participation fee of <strong>₹${finalFee}</strong> to confirm your desk participation.</p>` : "<p>Your spot is confirmed for the event!</p>"}
                    <br/>
                    <p>Best regards,<br/>${event.title} Organizing Committee</p>
                </div>
            `,
            qstashPayload: {
                type: "SUBMISSION_SHORTLISTED",
                data: {
                    userEmail: team.leaderId.email,
                    userName: team.leaderId.name,
                    eventTitle: event.title,
                    teamName: team.teamName,
                    finalFee
                }
            }
        })
    } else {
        team.registrationStatus = "cancelled"
    }

    await team.save()

    return res.status(200).json(
        new ApiResponse(200, team, `Team submission marked as ${status}`)
    )
})

export const submitFinalPayment = asyncHandler(async (req, res) => {
    const { teamId } = req.params
    const { transactionId } = req.body

    const team = await Team.findById(teamId).populate("eventId")
    if (!team) {
        throw new ApiError(404, "Team registration not found")
    }

    if (team.leaderId.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "Only the team leader can submit final participation payment")
    }

    if (team.submissionStatus !== "shortlisted") {
        throw new ApiError(400, "Only shortlisted teams are eligible to submit final participation fee")
    }

    if (!transactionId || !/^\d{12}$/.test(transactionId.trim())) {
        throw new ApiError(400, "A valid 12-digit numeric transaction reference (UTR) is required")
    }

    const screenshotPath = req.file?.path
    if (!screenshotPath) {
        throw new ApiError(400, "Payment proof screenshot is required")
    }

    const uploadRes = await uploadOnCloudinary(screenshotPath, "eventhub/payments")
    if (!uploadRes?.url) {
        throw new ApiError(500, "Failed to upload payment proof screenshot")
    }

    team.finalPayment.transactionId = transactionId.trim()
    team.finalPayment.paymentScreenshot = {
        url: uploadRes.url,
        public_id: uploadRes.public_id
    }
    team.finalPayment.status = "pending"

    await team.save()

    return res.status(200).json(
        new ApiResponse(200, team, "Final participation payment submitted successfully and is pending verification")
    )
})

export const verifyFinalPayment = asyncHandler(async (req, res) => {
    const { teamId } = req.params
    const { status } = req.body

    if (!["verified", "rejected"].includes(status)) {
        throw new ApiError(400, "Status must be either 'verified' or 'rejected'")
    }

    const team = await Team.findById(teamId).populate("eventId")
    if (!team) {
        throw new ApiError(404, "Team registration not found")
    }

    const event = team.eventId
    const isCreator = event.createdBy.toString() === req.user._id.toString()
    const isCoordinator = await Coordinator.exists({
        eventId: event._id,
        userId: req.user._id,
        invitationStatus: "accepted"
    })
    const isAdmin = req.user.role === "admin"

    if (!isCreator && !isCoordinator && !isAdmin) {
        throw new ApiError(403, "Only the event faculty in-charge or coordinator can verify final payments")
    }

    team.finalPayment.status = status
    team.finalPayment.verifiedBy = req.user._id
    team.finalPayment.verifiedAt = new Date()

    if (status === "verified") {
        team.registrationStatus = "confirmed"
        if (!team.qrCode) {
            team.qrCode = await generateRegistrationQR(team._id, team.registrationNumber, team.eventId._id || team.eventId)
        }
    }

    await team.save()

    return res.status(200).json(
        new ApiResponse(200, team, `Final payment has been ${status}`)
    )
})

export const getTeamQrPass = asyncHandler(async (req, res) => {
    const { teamId } = req.params

    const team = await Team.findById(teamId)
        .populate("eventId", "title venue startDate endDate banner collegename")
        .populate("leaderId", "name email phonenumber department")

    if (!team) {
        throw new ApiError(404, "Team registration not found")
    }

    const isLeader = team.leaderId?._id?.toString() === req.user._id.toString()
    const isMember = (team.members || []).some(
        m => (m.userId && m.userId.toString() === req.user._id.toString()) || m.email === req.user.email
    )
    const isStaffOrAdmin = ["faculty", "principal", "admin"].includes(req.user.role)

    if (!isLeader && !isMember && !isStaffOrAdmin) {
        throw new ApiError(403, "Access denied: You are not a member of this team")
    }

    if (team.registrationStatus !== "confirmed") {
        throw new ApiError(400, `QR Pass is only available for confirmed registrations. Your registration status is: ${team.registrationStatus}`)
    }

    if (!team.qrCode) {
        team.qrCode = await generateRegistrationQR(team._id, team.registrationNumber, team.eventId._id)
        await team.save()
    }

    return res.status(200).json(
        new ApiResponse(200, {
            teamId: team._id,
            teamName: team.teamName,
            registrationNumber: team.registrationNumber,
            qrCode: team.qrCode,
            event: {
                _id: team.eventId._id,
                title: team.eventId.title,
                venue: team.eventId.venue,
                startDate: team.eventId.startDate,
                endDate: team.eventId.endDate
            },
            leader: {
                name: team.leaderId?.name,
                email: team.leaderId?.email,
                phonenumber: team.leaderId?.phonenumber,
                department: team.leaderId?.department
            },
            members: team.members,
            paymentStatus: team.paymentStatus,
            checkedIn: team.checkedIn,
            checkedInAt: team.checkedInAt
        }, "Team QR pass fetched successfully")
    )
})

export const verifyQrCheckIn = asyncHandler(async (req, res) => {
    const { qrData, eventId } = req.body

    if (!qrData) {
        throw new ApiError(400, "QR data is required")
    }

    let resolvedTeamId = null
    let resolvedRegNo = null
    let resolvedEventId = eventId

    const verified = verifyQrPayload(qrData)
    if (verified.isValid) {
        resolvedTeamId = verified.data.tid
        resolvedRegNo = verified.data.reg
        resolvedEventId = verified.data.eid
    } else {
        if (typeof qrData === "object" && qrData !== null) {
            resolvedTeamId = qrData.teamId || qrData.tid
            resolvedRegNo = qrData.regNo || qrData.reg
            resolvedEventId = qrData.eventId || qrData.eid || eventId
        } else if (typeof qrData === "string") {
            try {
                const parsed = JSON.parse(qrData)
                resolvedTeamId = parsed.teamId || parsed.tid
                resolvedRegNo = parsed.regNo || parsed.reg
                resolvedEventId = parsed.eventId || parsed.eid || eventId
            } catch {
                const trimmed = qrData.trim()
                if (mongoose.Types.ObjectId.isValid(trimmed)) {
                    resolvedTeamId = trimmed
                } else {
                    resolvedRegNo = trimmed
                }
            }
        }
    }

    const query = {}
    if (resolvedTeamId) {
        query._id = resolvedTeamId
    } else if (resolvedRegNo) {
        query.registrationNumber = resolvedRegNo
    } else {
        throw new ApiError(400, "Invalid QR code payload: Could not identify team")
    }

    if (resolvedEventId) {
        query.eventId = resolvedEventId
    }

    const team = await Team.findOne(query)
        .populate("eventId")
        .populate("leaderId", "name email phonenumber department")

    if (!team) {
        throw new ApiError(404, "Team registration not found for this QR code")
    }

    const event = team.eventId
    if (event.collegename !== req.user.collegename?.toLowerCase().trim()) {
        throw new ApiError(403, "Access denied: Event belongs to another institution")
    }

    const isCreator = event.createdBy.toString() === req.user._id.toString()
    const isCoordinator = await Coordinator.exists({
        eventId: event._id,
        userId: req.user._id,
        invitationStatus: "accepted"
    })
    const isStaffOrAdmin = ["faculty", "principal", "admin"].includes(req.user.role)

    if (!isCreator && !isCoordinator && !isStaffOrAdmin) {
        throw new ApiError(403, "You do not have permission to verify check-in for this event")
    }

    if (team.registrationStatus !== "confirmed") {
        throw new ApiError(400, `Cannot check in team with registration status: ${team.registrationStatus}`)
    }

    const regNo = team.registrationNumber || team._id.toString()

    if (team.checkedIn) {
        return res.status(200).json(
            new ApiResponse(200, {
                alreadyCheckedIn: true,
                teamId: team._id,
                teamName: team.teamName,
                registrationNumber: regNo,
                leaderName: team.leaderId?.name,
                leaderPhone: team.leaderId?.phonenumber,
                checkedInAt: team.checkedInAt,
                members: team.members
            }, "Team is already checked in")
        )
    }

    team.checkedIn = true
    team.checkedInAt = new Date()
    team.checkedInBy = req.user._id
    await team.save()

    try {
        await Promise.all([
            redisClient.sRem(`event:${event._id}:pending_checkin`, regNo),
            redisClient.sAdd(`event:${event._id}:checked_in`, regNo)
        ])
        const rawTeam = await redisClient.hGet(`event:${event._id}:teams`, regNo)
        if (rawTeam) {
            const parsed = JSON.parse(rawTeam)
            parsed.checkedIn = true
            parsed.checkedInAt = team.checkedInAt
            await redisClient.hSet(`event:${event._id}:teams`, regNo, JSON.stringify(parsed))
        }
    } catch {
    }

    return res.status(200).json(
        new ApiResponse(200, {
            alreadyCheckedIn: false,
            checkedIn: true,
            teamId: team._id,
            teamName: team.teamName,
            registrationNumber: regNo,
            leaderName: team.leaderId?.name,
            leaderPhone: team.leaderId?.phonenumber,
            checkedInAt: team.checkedInAt,
            members: team.members
        }, "Team successfully verified and checked in!")
    )
})

export const claimMealPass = asyncHandler(async (req, res) => {
    const { qrData, eventId, slotId } = req.body

    if (!qrData || !slotId) {
        throw new ApiError(400, "qrData and slotId are required")
    }

    let resolvedTeamId = null
    let resolvedRegNo = null
    let resolvedEventId = eventId

    const verified = verifyQrPayload(qrData)
    if (verified.isValid) {
        resolvedTeamId = verified.data.tid
        resolvedRegNo = verified.data.reg
        resolvedEventId = verified.data.eid
    } else {
        if (typeof qrData === "object" && qrData !== null) {
            resolvedTeamId = qrData.teamId || qrData.tid
            resolvedRegNo = qrData.regNo || qrData.reg
            resolvedEventId = qrData.eventId || qrData.eid || eventId
        } else if (typeof qrData === "string") {
            try {
                const parsed = JSON.parse(qrData)
                resolvedTeamId = parsed.teamId || parsed.tid
                resolvedRegNo = parsed.regNo || parsed.reg
                resolvedEventId = parsed.eventId || parsed.eid || eventId
            } catch {
                const trimmed = qrData.trim()
                if (mongoose.Types.ObjectId.isValid(trimmed)) {
                    resolvedTeamId = trimmed
                } else {
                    resolvedRegNo = trimmed
                }
            }
        }
    }

    const query = {}
    if (resolvedTeamId && mongoose.Types.ObjectId.isValid(resolvedTeamId)) {
        query._id = resolvedTeamId
    } else if (resolvedRegNo) {
        query.registrationNumber = resolvedRegNo
    } else {
        throw new ApiError(400, "Invalid QR code payload: Could not identify team")
    }

    if (resolvedEventId) {
        query.eventId = resolvedEventId
    }

    const team = await Team.findOne(query).populate("eventId").populate("leaderId", "name email phonenumber")
    if (!team) {
        throw new ApiError(404, "Team registration not found for this QR pass")
    }

    const event = team.eventId
    const isCreator = event.createdBy.toString() === req.user._id.toString()
    const isCoordinator = event.coordinators?.some(c => c.toString() === req.user._id.toString()) ||
                          await Coordinator.exists({ eventId: event._id, userId: req.user._id, invitationStatus: "accepted" })
    const isStaffOrAdmin = ["faculty", "principal", "admin", "organiser"].includes(req.user.role?.toLowerCase())

    if (!isCreator && !isCoordinator && !isStaffOrAdmin) {
        throw new ApiError(403, "Only the event faculty in-charge or authorized coordinator can verify meal distribution")
    }

    if (event.isMealDistributionEnabled === false) {
        throw new ApiError(400, "Meal distribution is currently disabled for this entire event")
    }

    if (team.registrationStatus !== "confirmed") {
        throw new ApiError(400, `Cannot distribute meals to team with status: ${team.registrationStatus}`)
    }

    const regNo = team.registrationNumber || team._id.toString()

    // 1. Find configured slot and verify it is currently enabled
    const activeSlot = event.foodSlots?.find(s => s.slotId === slotId)
    const slotName = activeSlot ? activeSlot.name : slotId

    if (activeSlot && activeSlot.isActive === false) {
        throw new ApiError(400, `Meal distribution for '${slotName}' is currently disabled/paused by coordinators or faculty`)
    }

    // 2. ATOMIC REDIS CHECK (Write-Behind Fast-Path: < 3ms)
    const redisKey = `event:${event._id}:meal:${slotId}:claimed`
    let wasAdded = 1
    try {
        wasAdded = await redisClient.sAdd(redisKey, regNo)
    } catch (err) {
        console.error("Redis sAdd error in meal claim:", err)
    }

    if (wasAdded === 0) {
        return res.status(400).json(
            new ApiResponse(400, {
                alreadyClaimed: true,
                slotId,
                slotName,
                teamName: team.teamName,
                regNo
            }, `Meal token for '${slotName}' has already been claimed for this pass!`)
        )
    }

    // 3. RESPOND IMMEDIATELY TO VOLUNTEER (Instant Green Screen)
    const memberCount = (team.members?.length || 0) + 1
    res.status(200).json(
        new ApiResponse(200, {
            alreadyClaimed: false,
            claimed: true,
            teamId: team._id,
            teamName: team.teamName,
            registrationNumber: regNo,
            slotId,
            slotName,
            memberCount,
            leaderName: team.leaderId?.name,
            claimedAt: new Date()
        }, `Meal token verified! Distribute meal plates for '${slotName}'.`)
    )

    // 4. WRITE-BEHIND: Update MongoDB in the background without blocking the response
    Team.updateOne(
        { _id: team._id },
        {
            $push: {
                mealClaims: {
                    slotId,
                    slotName,
                    claimedAt: new Date(),
                    claimedBy: req.user._id
                }
            }
        }
    ).catch(err => console.error("Background Mongo meal claim sync error:", err))
})

export const getMealStats = asyncHandler(async (req, res) => {
    const { eventId, slotId } = req.params

    const event = await Event.findById(eventId)
    if (!event) {
        throw new ApiError(404, "Event not found")
    }

    const isCreator = event.createdBy.toString() === req.user._id.toString()
    const isCoordinator = event.coordinators?.some(c => c.toString() === req.user._id.toString()) ||
                          await Coordinator.exists({ eventId: event._id, userId: req.user._id, invitationStatus: "accepted" })
    const isStaffOrAdmin = ["faculty", "principal", "admin", "organiser"].includes(req.user.role?.toLowerCase())

    if (!isCreator && !isCoordinator && !isStaffOrAdmin) {
        throw new ApiError(403, "You do not have permission to view meal statistics")
    }

    const redisKey = `event:${eventId}:meal:${slotId}:claimed`
    let claimedCount = 0
    try {
        claimedCount = await redisClient.sCard(redisKey)
    } catch {
        claimedCount = await Team.countDocuments({
            eventId,
            "mealClaims.slotId": slotId
        })
    }

    const slotInfo = event.foodSlots?.find(s => s.slotId === slotId)

    return res.status(200).json(
        new ApiResponse(200, {
            eventId,
            slotId,
            slotName: slotInfo ? slotInfo.name : slotId,
            claimedCount,
            startTime: slotInfo?.startTime,
            endTime: slotInfo?.endTime,
            isActive: slotInfo?.isActive ?? true
        }, "Meal distribution statistics fetched successfully")
    )
})

export const toggleMealSlot = asyncHandler(async (req, res) => {
    const { eventId, slotId } = req.params

    const event = await Event.findById(eventId)
    if (!event) {
        throw new ApiError(404, "Event not found")
    }

    // Both Faculty in-charge and appointed Coordinators have equal access to enable/disable
    const isCreator = event.createdBy.toString() === req.user._id.toString()
    const isCoordinator = event.coordinators?.some(c => c.toString() === req.user._id.toString()) ||
                          await Coordinator.exists({ eventId: event._id, userId: req.user._id, invitationStatus: "accepted" })
    const isStaffOrAdmin = ["faculty", "principal", "admin", "organiser"].includes(req.user.role?.toLowerCase())

    if (!isCreator && !isCoordinator && !isStaffOrAdmin) {
        throw new ApiError(403, "Only the event faculty in-charge or authorized coordinator can enable/disable meal distribution")
    }

    if (!event.foodSlots || event.foodSlots.length === 0) {
        throw new ApiError(400, "No food slots configured for this event")
    }

    const slot = event.foodSlots.find(s => s.slotId === slotId)
    if (!slot) {
        throw new ApiError(404, `Meal slot '${slotId}' not found on this event`)
    }

    slot.isActive = !slot.isActive
    await event.save()

    // Sync active state to Redis for instant lookup
    try {
        await redisClient.set(`event:${eventId}:meal:${slotId}:active`, slot.isActive ? "1" : "0")
    } catch (err) {
        console.error("Redis sync error:", err)
    }

    return res.status(200).json(
        new ApiResponse(200, {
            eventId,
            slotId,
            name: slot.name,
            isActive: slot.isActive
        }, `Meal slot '${slot.name}' is now ${slot.isActive ? "enabled" : "disabled"} successfully`)
    )
})

export const toggleEventMealDistribution = asyncHandler(async (req, res) => {
    const { eventId } = req.params

    const event = await Event.findById(eventId)
    if (!event) {
        throw new ApiError(404, "Event not found")
    }

    // Both Faculty in-charge and appointed Coordinators have equal access
    const isCreator = event.createdBy.toString() === req.user._id.toString()
    const isCoordinator = event.coordinators?.some(c => c.toString() === req.user._id.toString()) ||
                          await Coordinator.exists({ eventId: event._id, userId: req.user._id, invitationStatus: "accepted" })
    const isStaffOrAdmin = ["faculty", "principal", "admin", "organiser"].includes(req.user.role?.toLowerCase())

    if (!isCreator && !isCoordinator && !isStaffOrAdmin) {
        throw new ApiError(403, "Only the event faculty in-charge or authorized coordinator can toggle meal distribution")
    }

    event.isMealDistributionEnabled = !event.isMealDistributionEnabled
    await event.save()

    try {
        await redisClient.set(`event:${eventId}:meal:enabled`, event.isMealDistributionEnabled ? "1" : "0")
    } catch (err) {
        console.error("Redis sync error:", err)
    }

    return res.status(200).json(
        new ApiResponse(200, {
            eventId,
            isMealDistributionEnabled: event.isMealDistributionEnabled
        }, `Event meal distribution has been ${event.isMealDistributionEnabled ? "enabled" : "disabled"} successfully`)
    )
})