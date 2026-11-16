import { Router } from "express"
import {
    submitExpenseClaim,
    getEventExpenses,
    getApproverQueue,
    approveOrRejectExpense,
    settleExpensePayment,
    updateExpenseOcrData,
    getExpenseById
} from "../controllers/expense.controllers.js"
import { verifyJWT } from "../middlewares/auth.middleware.js"
import { upload } from "../middlewares/multer.middlewares.js"
import { uploadRateLimiter } from "../middlewares/rateLimiter.middlewares.js"


const router = Router()

router.route("/events/:eventId/claim")
    .post(verifyJWT,uploadRateLimiter, upload.single("bill"), submitExpenseClaim)

router.route("/events/:eventId/expenses")
    .get(verifyJWT, getEventExpenses)

router.route("/approver-queue")
    .get(verifyJWT, getApproverQueue)

router.route("/:expenseId")
    .get(verifyJWT, getExpenseById)

router.route("/:expenseId/decision")
    .patch(verifyJWT, approveOrRejectExpense)

router.route("/:expenseId/settle")
    .patch(verifyJWT, settleExpensePayment)

router.route("/:expenseId/ocr")
    .patch(updateExpenseOcrData)

export default router