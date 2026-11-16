import { Router } from "express"
import {
    getFestOverviewStats,
    getDepartmentParticipationStats,
    getEventFinanceLedger,
    getEventAnalytics
} from "../controllers/analytics.controllers.js"
import { verifyJWT, authorizeRoles } from "../middlewares/auth.middleware.js"

const router = Router()

router.route("/overview")
    .get(verifyJWT, authorizeRoles("faculty", "principal", "admin"), getFestOverviewStats)

router.route("/departments")
    .get(verifyJWT, authorizeRoles("faculty", "principal", "admin"), getDepartmentParticipationStats)

router.route("/finance-ledger")
    .get(verifyJWT, authorizeRoles("faculty", "principal", "admin"), getEventFinanceLedger)

router.route("/events/:eventId")
    .get(verifyJWT, getEventAnalytics)

export default router
