import { Router } from "express"
import {
    getLogDashboardStats,
    getSystemLogs,
    getLogDetails,
    clearOldLogs
} from "../controllers/log.controllers.js"
import { verifyJWT, authorizeRoles } from "../middlewares/auth.middleware.js"

const router = Router()

router.use(verifyJWT, authorizeRoles("admin"))

router.route("/dashboard")
    .get(getLogDashboardStats)

router.route("/")
    .get(getSystemLogs)

router.route("/clear")
    .delete(clearOldLogs)

router.route("/:logId")
    .get(getLogDetails)

export default router
