import { Router } from "express"
import {
    sendRegistrationOTP,
    registerUser,
    loginUser,
    logoutUser,
    refreshAccessToken,
    getCurrentUser,
    updateUserProfile,
    updateProfilePicture,
    changeCurrentPassword,
    forgotPassword,
    resetPassword,
    onboardCoordinator
} from "../controllers/user.controllers.js"
import { verifyJWT } from "../middlewares/auth.middleware.js"
import { upload } from "../middlewares/multer.middlewares.js"
import { authRateLimiter, uploadRateLimiter } from "../middlewares/rateLimiter.middlewares.js"

const router = Router()

router.route("/send-otp").post(authRateLimiter, sendRegistrationOTP)
router.route("/register").post(authRateLimiter, registerUser)
router.route("/login").post(authRateLimiter, loginUser)
router.route("/refresh-token").post(refreshAccessToken)
router.route("/forgot-password").post(authRateLimiter, forgotPassword)
router.route("/reset-password/:token").post(authRateLimiter, resetPassword)

router.route("/logout").post(verifyJWT, logoutUser)
router.route("/me").get(verifyJWT, getCurrentUser)
router.route("/profile").patch(verifyJWT, updateUserProfile)
router.route("/avatar").patch(verifyJWT,uploadRateLimiter, upload.single("profilePicture"), updateProfilePicture)
router.route("/change-password").post(verifyJWT, changeCurrentPassword)
router.route("/onboard-coordinator").post(verifyJWT, onboardCoordinator)

export default router