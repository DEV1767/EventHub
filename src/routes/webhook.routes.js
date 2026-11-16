import { Router } from "express"
import { handleQStashNotification } from "../controllers/webhook.controllers.js"

const router = Router()

router.route("/notifications").post(handleQStashNotification)

export default router