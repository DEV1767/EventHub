import { Router } from "express"
import { handleRagChat, handleAgentQuery } from "../controllers/ai.controllers.js"
import { verifyJWT } from "../middlewares/auth.middleware.js"

const router = Router()

router.route("/rag/chat").post(handleRagChat)
router.route("/agent/query").post(verifyJWT, handleAgentQuery)

export default router
