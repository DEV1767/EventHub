import { ApiError, ApiResponse } from "../utils/apiHandler.js"
import asyncHandler from "../utils/asyncHandler.js"
import Event from "../models/event.models.js"
import Coordinator from "../models/coordinator.models.js"
import { askRag, askOperationsAgent } from "../utils/aiClient.js"

export const handleRagChat = asyncHandler(async (req, res) => {
    const { eventId, query } = req.body
    if (!eventId || !query) {
        throw new ApiError(400, "Both 'eventId' and 'query' are required")
    }

    const event = await Event.findById(eventId).select("title isAiChatEnabled status")
    if (!event) {
        throw new ApiError(404, "Event not found")
    }

    if (event.isAiChatEnabled === false) {
        throw new ApiError(403, "AI Assistant is currently disabled by coordinators for this event")
    }

    const result = await askRag(eventId, query.trim())
    return res.status(200).json(
        new ApiResponse(200, result, "Response generated successfully")
    )
})

export const handleAgentQuery = asyncHandler(async (req, res) => {
    const { eventId, query, threadId } = req.body
    if (!eventId || !query) {
        throw new ApiError(400, "Both 'eventId' and 'query' are required")
    }

    const event = await Event.findById(eventId)
    if (!event) {
        throw new ApiError(404, "Event not found")
    }

    const isCreator = event.createdBy.toString() === req.user._id.toString()
    const isFaculty = req.user.role === "faculty"
    const isCoordinator = await Coordinator.exists({ eventId: event._id, userId: req.user._id, status: "Active" })

    if (!isCreator && !isFaculty && !isCoordinator) {
        throw new ApiError(403, "Only verified coordinators or faculty can access the Event Operations Agent")
    }

    const sessionThread = threadId || `user_${req.user._id}_event_${eventId}`
    const result = await askOperationsAgent(eventId, query.trim(), sessionThread)

    return res.status(200).json(
        new ApiResponse(200, result, "Operations Agent response generated")
    )
})
