import { Router } from "express"
import {
    registerTeam,
    getMyRegistrations,
    getEventTeams,
    verifyPayment,
    checkInTeam,
    reviewTeamSubmission,
    submitFinalPayment,
    verifyFinalPayment,
    getTeamQrPass,
    verifyQrCheckIn
} from "../controllers/team.controllers.js"
import { verifyJWT } from "../middlewares/auth.middleware.js"
import { upload } from "../middlewares/multer.middlewares.js"
import { uploadRateLimiter } from "../middlewares/rateLimiter.middlewares.js"

const router = Router()

router.route("/events/:eventId/register")
    .post(
        verifyJWT,
        uploadRateLimiter,
        upload.fields([
            { name: "leaderIdCard", maxCount: 1 },
            { name: "paymentScreenshot", maxCount: 1 },
            { name: "submissionDocument", maxCount: 1 }
        ]),
        registerTeam
    )

router.route("/my-registrations")
    .get(verifyJWT, getMyRegistrations)

router.route("/events/:eventId/teams")
    .get(verifyJWT, getEventTeams)

router.route("/:teamId/verify-payment")
    .patch(verifyJWT, verifyPayment)

router.route("/:teamId/check-in")
    .patch(verifyJWT, checkInTeam)

router.route("/:teamId/review-submission")
    .patch(verifyJWT, reviewTeamSubmission)

router.route("/:teamId/final-payment")
    .post(verifyJWT, uploadRateLimiter, upload.single("paymentScreenshot"), submitFinalPayment)

router.route("/:teamId/verify-final-payment")
    .patch(verifyJWT, verifyFinalPayment)

router.route("/:teamId/qr-pass")
    .get(verifyJWT, getTeamQrPass)

router.route("/verify-qr-checkin")
    .post(verifyJWT, verifyQrCheckIn)

export default router