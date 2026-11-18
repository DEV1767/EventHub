import fs from "fs"
import Event from "../models/event.models.js"
import User from "../models/user.models.js"
import Team from "../models/team.models.js"
import Coordinator from "../models/coordinator.models.js"
import { ApiError, ApiResponse } from "../utils/apiHandler.js"
import asyncHandler from "../utils/asyncHandler.js"
import { uploadOnCloudinary, deletFromCloudinary } from "../utils/cloudinary.js"
import { getCache, setCache, deleteCache } from "../utils/redis.helpers.js"
import redisClient from "../config/redis.js"
import { generateInvitationCode, hashToken } from "../utils/Invitationutils.js"
import { createEventSchema } from "../validators/joi.validators.js"
import { uploadPdfToVectorStore, syncEventToVectorStore } from "../utils/aiClient.js"

export const createEvent = asyncHandler(async (req, res) => {
    if (!["faculty", "admin"].includes(req.user.role)) {
        throw new ApiError(403, "Only faculty and admin can create events")
    }

    const { error, value } = createEventSchema.validate(req.body)
    if (error) {
        throw new ApiError(400, error.details[0].message)
    }

    const {
        title,
        description,
        category,
        otherCategoryDetails,
        department,
        venue,
        startDate,
        endDate,
        registrationStartDate,
        registrationEndDate,
        participationType,
        minTeamSize,
        maxTeamSize,
        maxParticipants,
        registrationFee,
        rules,
        termsAndConditions,
        budget
    } = value

    const bannerLocalPath = req.file?.path || req.files?.banner?.[0]?.path
    let banner = { url: "", public_id: "" }
    if (bannerLocalPath) {
        const uploadedBanner = await uploadOnCloudinary(bannerLocalPath, "eventhub/banners")
        if (uploadedBanner?.url) {
            banner = {
                url: uploadedBanner.url,
                public_id: uploadedBanner.public_id
            }
        }
    }

    let parsedRules = []
    if (Array.isArray(rules)) {
        parsedRules = rules
    } else if (typeof rules === "string") {
        try {
            parsedRules = JSON.parse(rules)
        } catch {
            parsedRules = rules.split("\n").map(r => r.trim()).filter(Boolean)
        }
    }

    let parsedTerms = ""
    if (Array.isArray(termsAndConditions)) {
        parsedTerms = termsAndConditions.join("\n")
    } else if (typeof termsAndConditions === "string") {
        parsedTerms = termsAndConditions
    }

    let parsedBudget = { totalAllocated: 0, totalSpent: 0, categories: [] }
    if (typeof budget === "number") {
        parsedBudget.totalAllocated = budget
    } else if (typeof budget === "string") {
        try {
            parsedBudget = JSON.parse(budget)
        } catch {
            parsedBudget = { totalAllocated: Number(budget) || 0, totalSpent: 0, categories: [] }
        }
    } else if (typeof budget === "object" && budget !== null) {
        parsedBudget = budget
    }

    let parsedSubmissionSettings = {
        isRequired: false,
        facultyNote: "",
        maxSizeMB: 15,
        initialRegistrationFee: 0,
        finalParticipationFee: 0,
        demoDocument: { url: "", public_id: "", originalName: "" }
    }
    if (req.body.submissionSettings) {
        try {
            parsedSubmissionSettings = typeof req.body.submissionSettings === "string" ? JSON.parse(req.body.submissionSettings) : req.body.submissionSettings
        } catch {
            parsedSubmissionSettings = { isRequired: false, facultyNote: "", maxSizeMB: 15, initialRegistrationFee: 0, finalParticipationFee: 0, demoDocument: { url: "", public_id: "", originalName: "" } }
        }
    }

    if (req.body.facultyNote) {
        parsedSubmissionSettings.facultyNote = req.body.facultyNote.trim()
    }

    const demoLocalPath = req.files?.demoDocument?.[0]?.path || req.files?.demoPpt?.[0]?.path
    if (demoLocalPath) {
        const demoFile = req.files?.demoDocument?.[0] || req.files?.demoPpt?.[0]
        const maxSizeMB = parsedSubmissionSettings.maxSizeMB || 15
        const maxBytes = maxSizeMB * 1024 * 1024

        if (demoFile.size > maxBytes) {
            if (fs.existsSync(demoLocalPath)) fs.unlinkSync(demoLocalPath)
            throw new ApiError(400, `Demo PPT size exceeds the allowed limit of ${maxSizeMB} MB`)
        }

        const uploadedDemo = await uploadOnCloudinary(demoLocalPath, "eventhub/demo_documents")
        if (uploadedDemo?.url) {
            parsedSubmissionSettings.demoDocument = {
                url: uploadedDemo.url,
                public_id: uploadedDemo.public_id,
                originalName: demoFile.originalname || ""
            }
        }
    }

    const event = await Event.create({
        title,
        description,
        category,
        otherCategoryDetails: otherCategoryDetails || "",
        department,
        venue,
        startDate,
        endDate,
        registrationStartDate: registrationStartDate || new Date(),
        registrationEndDate,
        participationType,
        teamSize: {
            min: participationType === "Team" ? Number(minTeamSize) : 1,
            max: participationType === "Team" ? Number(maxTeamSize) : 1
        },
        maxParticipants: Number(maxParticipants),
        registrationFee: Number(registrationFee) || 0,
        rules: parsedRules,
        termsAndConditions: parsedTerms,
        budget: parsedBudget,
        submissionSettings: parsedSubmissionSettings,
        banner,
        collegename: req.user.collegename,
        createdBy: req.user._id,
        contactEmail: req.user.email,
        contactPhone: req.user.phonenumber,
        status: "Upcoming",
        isPublished: true
    })

    await deleteCache(`events:${req.user.collegename}`)
    syncEventToVectorStore(event).catch(err => console.error("AI Sync Error on createEvent:", err.message))

    return res.status(201).json(
        new ApiResponse(201, event, "Event created successfully")
    )
})

export const getAllEvents = asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, status, category, search } = req.query
    const collegename = req.user?.collegename || req.query.collegename

    const cacheKey = `events:${collegename || "all"}:${status || "all"}:${category || "all"}:${search || "all"}:${page}:${limit}`
    const cachedData = await getCache(cacheKey)
    if (cachedData) {
        return res.status(200).json(
            new ApiResponse(200, cachedData, "Events fetched from cache")
        )
    }

    const filter = {}
    if (collegename) {
        filter.collegename = collegename.toLowerCase()
    }
    if (status) {
        filter.status = status
    }
    if (category) {
        filter.category = category
    }
    if (search) {
        filter.$or = [
            { title: { $regex: search, $options: "i" } },
            { description: { $regex: search, $options: "i" } }
        ]
    }

    const skip = (Number(page) - 1) * Number(limit)
    const [events, totalEvents] = await Promise.all([
        Event.find(filter)
            .populate("createdBy", "name email department")
            .sort({ startDate: 1 })
            .skip(skip)
            .limit(Number(limit)),
        Event.countDocuments(filter)
    ])

    const responseData = {
        events,
        totalEvents,
        page: Number(page),
        totalPages: Math.ceil(totalEvents / Number(limit))
    }

    await setCache(cacheKey, responseData, 300)

    return res.status(200).json(
        new ApiResponse(200, responseData, "Events fetched successfully")
    )
})

export const getEventById = asyncHandler(async (req, res) => {
    const { id } = req.params

    const cacheKey = `event:${id}`
    const cachedEvent = await getCache(cacheKey)
    if (cachedEvent) {
        return res.status(200).json(
            new ApiResponse(200, cachedEvent, "Event details fetched from cache")
        )
    }

    const event = await Event.findById(id)
        .populate("createdBy", "name email department phonenumber")
        .populate("coordinators", "name email phonenumber department profilePicture")

    if (!event) {
        throw new ApiError(404, "Event not found")
    }

    await setCache(cacheKey, event, 300)

    return res.status(200).json(
        new ApiResponse(200, event, "Event details fetched successfully")
    )
})

export const updateEvent = asyncHandler(async (req, res) => {
    const { id } = req.params
    const event = await Event.findById(id)

    if (!event) {
        throw new ApiError(404, "Event not found")
    }

    if (event.createdBy.toString() !== req.user._id.toString() && req.user.role !== "admin") {
        throw new ApiError(403, "You do not have permission to update this event")
    }

    const bannerLocalPath = req.file?.path || req.files?.banner?.[0]?.path
    if (bannerLocalPath) {
        const uploadedBanner = await uploadOnCloudinary(bannerLocalPath, "eventhub/banners")
        if (uploadedBanner?.url) {
            if (event.banner?.public_id) {
                await deletFromCloudinary(event.banner.public_id)
            }
            event.banner = {
                url: uploadedBanner.url,
                public_id: uploadedBanner.public_id
            }
        }
    }

    const demoLocalPath = req.files?.demoDocument?.[0]?.path || req.files?.demoPpt?.[0]?.path
    if (demoLocalPath) {
        const demoFile = req.files?.demoDocument?.[0] || req.files?.demoPpt?.[0]
        const maxSizeMB = event.submissionSettings?.maxSizeMB || 15
        const maxBytes = maxSizeMB * 1024 * 1024

        if (demoFile.size > maxBytes) {
            if (fs.existsSync(demoLocalPath)) fs.unlinkSync(demoLocalPath)
            throw new ApiError(400, `Demo PPT size exceeds the allowed limit of ${maxSizeMB} MB`)
        }

        const uploadedDemo = await uploadOnCloudinary(demoLocalPath, "eventhub/demo_documents")
        if (uploadedDemo?.url) {
            if (event.submissionSettings?.demoDocument?.public_id) {
                await deletFromCloudinary(event.submissionSettings.demoDocument.public_id)
            }
            if (!event.submissionSettings) {
                event.submissionSettings = {}
            }
            event.submissionSettings.demoDocument = {
                url: uploadedDemo.url,
                public_id: uploadedDemo.public_id,
                originalName: demoFile.originalname || ""
            }
        }
    }

    const updatableFields = [
        "title",
        "description",
        "category",
        "otherCategoryDetails",
        "department",
        "venue",
        "startDate",
        "endDate",
        "registrationEndDate",
        "participationType",
        "registrationFee",
        "maxParticipants",
        "rules",
        "termsAndConditions",
        "status",
        "isPublished"
    ]

    for (const field of updatableFields) {
        if (req.body[field] !== undefined) {
            if (field === "rules" && typeof req.body.rules === "string") {
                try {
                    event.rules = JSON.parse(req.body.rules)
                } catch {
                    event.rules = req.body.rules.split("\n").map(r => r.trim()).filter(Boolean)
                }
            } else {
                event[field] = req.body[field]
            }
        }
    }

    if (req.body.submissionSettings !== undefined) {
        let parsed = req.body.submissionSettings
        if (typeof parsed === "string") {
            try {
                parsed = JSON.parse(parsed)
            } catch {
                parsed = {}
            }
        }
        const existingDemo = event.submissionSettings?.demoDocument
        event.submissionSettings = {
            isRequired: parsed.isRequired !== undefined ? parsed.isRequired : event.submissionSettings?.isRequired,
            facultyNote: parsed.facultyNote !== undefined ? parsed.facultyNote : event.submissionSettings?.facultyNote,
            maxSizeMB: parsed.maxSizeMB !== undefined ? Number(parsed.maxSizeMB) : event.submissionSettings?.maxSizeMB,
            initialRegistrationFee: parsed.initialRegistrationFee !== undefined ? Number(parsed.initialRegistrationFee) : event.submissionSettings?.initialRegistrationFee,
            finalParticipationFee: parsed.finalParticipationFee !== undefined ? Number(parsed.finalParticipationFee) : event.submissionSettings?.finalParticipationFee,
            demoDocument: event.submissionSettings?.demoDocument || existingDemo
        }
    }

    if (req.body.facultyNote !== undefined) {
        if (!event.submissionSettings) {
            event.submissionSettings = {}
        }
        event.submissionSettings.facultyNote = req.body.facultyNote.trim()
    }

    await event.save()
    await deleteCache(`event:${event._id}`)
    await deleteCache(`events:${event.collegename}`)
    syncEventToVectorStore(event).catch(err => console.error("AI Sync Error on updateEvent:", err.message))

    return res.status(200).json(
        new ApiResponse(200, event, "Event updated successfully")
    )
})

export const toggleRulesVisibility = asyncHandler(async (req, res) => {
    const { id } = req.params
    const event = await Event.findById(id)

    if (!event) {
        throw new ApiError(404, "Event not found")
    }

    if (event.createdBy.toString() !== req.user._id.toString() && req.user.role !== "admin") {
        throw new ApiError(403, "You do not have permission to modify this event")
    }

    event.rulesVisible = !event.rulesVisible
    await event.save()

    await deleteCache(`event:${event._id}`)

    return res.status(200).json(
        new ApiResponse(200, { rulesVisible: event.rulesVisible }, "Rules visibility toggled successfully")
    )
})

export const inviteCoordinator = asyncHandler(async (req, res) => {
    const { id } = req.params
    const studentEmail = req.body.studentEmail || req.body.email

    if (!studentEmail) {
        throw new ApiError(400, "Student email is required")
    }

    const event = await Event.findById(id)
    if (!event) {
        throw new ApiError(404, "Event not found")
    }

    if (event.createdBy.toString() !== req.user._id.toString() && req.user.role !== "admin") {
        throw new ApiError(403, "Only the event faculty in-charge can invite coordinators")
    }

    const student = await User.findOne({ email: studentEmail.toLowerCase().trim() })
    if (!student) {
        throw new ApiError(404, "Student with this email does not exist")
    }

    if (student.collegename !== event.collegename) {
        throw new ApiError(400, "Student must belong to the same college as the event")
    }

    const existingInvite = await Coordinator.findOne({
        userId: student._id,
        eventId: event._id,
        invitationStatus: { $in: ["pending", "accepted"] }
    })

    if (existingInvite) {
        throw new ApiError(409, `Student already has a ${existingInvite.invitationStatus} invitation for this event`)
    }

    const rawInvitationCode = generateInvitationCode()
    const hashedCode = hashToken(rawInvitationCode)
    const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    const invite = await Coordinator.create({
        userId: student._id,
        facultyId: req.user._id,
        eventId: event._id,
        collegename: event.collegename,
        invitationCode: hashedCode,
        invitationExpiry: expiry,
        invitationStatus: "pending"
    })

    if (!event.coordinators.includes(student._id)) {
        event.coordinators.push(student._id)
        await event.save()
    }

    await deleteCache(`event:${event._id}`)

    return res.status(201).json(
        new ApiResponse(
            201,
            {
                invitationId: invite._id,
                student: {
                    _id: student._id,
                    name: student.name,
                    email: student.email
                },
                invitationCode: rawInvitationCode,
                expiry
            },
            "Coordinator invitation generated successfully"
        )
    )
})

export const getEventCoordinators = asyncHandler(async (req, res) => {
    const { id } = req.params

    const coordinators = await Coordinator.find({ eventId: id })
        .populate("userId", "name email phonenumber department profilePicture")
        .sort({ createdAt: -1 })

    return res.status(200).json(
        new ApiResponse(200, coordinators, "Event coordinators fetched successfully")
    )
})

export const deleteEvent = asyncHandler(async (req, res) => {
    const { id } = req.params
    const event = await Event.findById(id)

    if (!event) {
        throw new ApiError(404, "Event not found")
    }

    if (event.createdBy.toString() !== req.user._id.toString() && req.user.role !== "admin") {
        throw new ApiError(403, "You do not have permission to delete this event")
    }

    if (event.banner?.public_id) {
        await deletFromCloudinary(event.banner.public_id)
    }

    await Event.findByIdAndDelete(id)
    await Coordinator.deleteMany({ eventId: id })

    await deleteCache(`event:${id}`)
    await deleteCache(`events:${event.collegename}`)

    return res.status(200).json(
        new ApiResponse(200, {}, "Event deleted successfully")
    )
})

export const loadEventDataToRedis = asyncHandler(async (req, res) => {
    const { id } = req.params

    const event = await Event.findById(id)
    if (!event) {
        throw new ApiError(404, "Event not found")
    }

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
        throw new ApiError(403, "Only the event faculty in-charge or coordinator can pre-warm event data")
    }

    const confirmedTeams = await Team.find({
        eventId: event._id,
        registrationStatus: "confirmed"
    })
        .populate("leaderId", "name email phonenumber department")
        .lean()

    const TTL = 86400
    const teamsHashKey = `event:${event._id}:teams`
    const checkedInSetKey = `event:${event._id}:checked_in`
    const pendingSetKey = `event:${event._id}:pending_checkin`
    const lookupKey = `event:${event._id}:lookup`
    const metaKey = `event:${event._id}:meta`

    await Promise.all([
        redisClient.del(teamsHashKey),
        redisClient.del(checkedInSetKey),
        redisClient.del(pendingSetKey),
        redisClient.del(lookupKey),
        redisClient.del(metaKey)
    ])

    let checkedInCount = 0
    let pendingCount = 0

    if (confirmedTeams.length > 0) {
        const hashPayload = {}
        const lookupPayload = {}
        const checkedInIds = []
        const pendingIds = []

        for (const team of confirmedTeams) {
            const regNo = team.registrationNumber || team._id.toString()
            const teamSnapshot = {
                teamId: team._id.toString(),
                teamName: team.teamName,
                registrationNumber: regNo,
                leaderName: team.leaderId?.name || "",
                leaderEmail: team.leaderId?.email || "",
                leaderPhone: team.leaderId?.phonenumber || "",
                leaderDepartment: team.leaderId?.department || "",
                memberCount: team.members?.length || 1,
                members: (team.members || []).map(m => ({
                    name: m.name,
                    email: m.email,
                    phonenumber: m.phonenumber,
                    department: m.department
                })),
                paymentMethod: team.paymentMethod,
                amountPaid: team.amountPaid,
                paymentStatus: team.paymentStatus,
                submissionStatus: team.submissionStatus,
                finalPayment: {
                    amount: team.finalPayment?.amount || 0,
                    status: team.finalPayment?.status || "not_required"
                },
                checkedIn: !!team.checkedIn,
                checkedInAt: team.checkedInAt || null
            }

            hashPayload[regNo] = JSON.stringify(teamSnapshot)

            if (team.teamName) {
                lookupPayload[team.teamName.toLowerCase().trim()] = regNo
            }
            if (team.leaderId?.phonenumber) {
                lookupPayload[team.leaderId.phonenumber.trim()] = regNo
            }

            if (team.checkedIn) {
                checkedInIds.push(regNo)
                checkedInCount++
            } else {
                pendingIds.push(regNo)
                pendingCount++
            }
        }

        const redisOps = [
            redisClient.hSet(teamsHashKey, hashPayload),
            redisClient.hSet(lookupKey, lookupPayload)
        ]

        if (checkedInIds.length > 0) {
            redisOps.push(redisClient.sAdd(checkedInSetKey, checkedInIds))
        }
        if (pendingIds.length > 0) {
            redisOps.push(redisClient.sAdd(pendingSetKey, pendingIds))
        }

        await Promise.all(redisOps)
    }

    const metaData = {
        eventId: event._id.toString(),
        eventTitle: event.title,
        loadedAt: new Date().toISOString(),
        totalConfirmed: String(confirmedTeams.length),
        checkedInCount: String(checkedInCount),
        pendingCount: String(pendingCount),
        status: "ready"
    }

    await Promise.all([
        redisClient.hSet(metaKey, metaData),
        redisClient.expire(teamsHashKey, TTL),
        redisClient.expire(checkedInSetKey, TTL),
        redisClient.expire(pendingSetKey, TTL),
        redisClient.expire(lookupKey, TTL),
        redisClient.expire(metaKey, TTL)
    ])

    return res.status(200).json(
        new ApiResponse(200, {
            eventId: event._id,
            eventTitle: event.title,
            totalConfirmed: confirmedTeams.length,
            checkedInCount,
            pendingCount,
            cacheTTLSeconds: TTL,
            loadedAt: metaData.loadedAt
        }, "Event data successfully locked and pre-warmed into Redis")
    )
})

export const getEventDayData = asyncHandler(async (req, res) => {
    const { id } = req.params

    const metaKey = `event:${id}:meta`
    const meta = await redisClient.hGetAll(metaKey)

    if (!meta || !meta.eventId) {
        throw new ApiError(404, "Event data is not loaded in Redis yet. Please click 'Ready for Event' first.")
    }

    const checkedInCount = await redisClient.sCard(`event:${id}:checked_in`)
    const pendingCount = await redisClient.sCard(`event:${id}:pending_checkin`)

    return res.status(200).json(
        new ApiResponse(200, {
            ...meta,
            checkedInCount,
            pendingCount
        }, "Event day data fetched from Redis")
    )
})

export const uploadEventDocument = asyncHandler(async (req, res) => {
    const { id } = req.params
    const event = await Event.findById(id)
    if (!event) {
        throw new ApiError(404, "Event not found")
    }

    const isCreator = event.createdBy.toString() === req.user._id.toString()
    const isFaculty = req.user.role === "faculty"
    const isCoordinator = await Coordinator.exists({ eventId: event._id, userId: req.user._id, status: "Active" })

    if (!isCreator && !isFaculty && !isCoordinator) {
        throw new ApiError(403, "Only event coordinators or faculty can upload AI documents")
    }

    const file = req.file
    if (!file) {
        throw new ApiError(400, "Please upload a PDF document (field name: 'document')")
    }

    try {
        const result = await uploadPdfToVectorStore(file.path, id, event.title, event.collegename)
        return res.status(200).json(
            new ApiResponse(200, result, "Document uploaded and vectorized successfully into Qdrant Cloud")
        )
    } finally {
        if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path)
        }
    }
})

export const syncEventToAi = asyncHandler(async (req, res) => {
    const { id } = req.params
    const event = await Event.findById(id)
    if (!event) {
        throw new ApiError(404, "Event not found")
    }

    const isCreator = event.createdBy.toString() === req.user._id.toString()
    const isFaculty = req.user.role === "faculty"
    const isCoordinator = await Coordinator.exists({ eventId: event._id, userId: req.user._id, status: "Active" })

    if (!isCreator && !isFaculty && !isCoordinator) {
        throw new ApiError(403, "Only event coordinators or faculty can sync AI data")
    }

    const result = await syncEventToVectorStore(event)
    return res.status(200).json(
        new ApiResponse(200, result, "Event metadata and rules successfully synced into Qdrant Cloud")
    )
})