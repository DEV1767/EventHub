import { Router } from "express";
import {
    createEvent,
    getAllEvents,
    getEventById,
    updateEvent,
    deleteEvent,
    toggleRulesVisibility,
    inviteCoordinator,
    getEventCoordinators,
    loadEventDataToRedis,
    getEventDayData
} from "../controllers/event.controllers.js"
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/multer.middlewares.js"
import { uploadRateLimiter } from "../middlewares/rateLimiter.middlewares.js";

const router = Router()

const eventUploadFields = upload.fields([
    { name: "banner", maxCount: 1 },
    { name: "demoDocument", maxCount: 1 }
])

router.route("/")
    .get(getAllEvents)
    .post(verifyJWT, uploadRateLimiter, eventUploadFields, createEvent)

router.route("/:id")
    .get(getEventById)
    .put(verifyJWT, uploadRateLimiter, eventUploadFields, updateEvent)
    .delete(verifyJWT, deleteEvent)

router.route("/:id/load-event-data")
    .post(verifyJWT, loadEventDataToRedis)

router.route("/:id/event-day-data")
    .get(verifyJWT, getEventDayData)

router.route("/:id/toggle-rules")
    .patch(verifyJWT, toggleRulesVisibility)

router.route("/:id/coordinators")
    .post(verifyJWT, inviteCoordinator)
    .get(verifyJWT, getEventCoordinators)

export default router;