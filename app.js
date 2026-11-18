import "dotenv/config"
import express from "express"
import cors from "cors"
import cookieParser from "cookie-parser"
import helmet from "helmet"
import { connect_db } from "./src/models/db.js"
import userRouter from "./src/routes/user.routes.js"
import eventRouter from "./src/routes/event.routes.js"
import teamRouter from "./src/routes/team.routes.js"
import expenseRouter from "./src/routes/expense.routes.js"
import webhookRouter from "./src/routes/webhook.routes.js"
import analyticsRouter from "./src/routes/analytics.routes.js"
import logRouter from "./src/routes/log.routes.js"
import aiRouter from "./src/routes/ai.routes.js"
import { requestLogger } from "./src/middlewares/logger.middleware.js"
import errorHandler from "./src/middlewares/error.middleware.js"

const app = express()

app.use(helmet())
app.use(
    cors({
        origin: process.env.CORS_ORIGIN || "https://eduhub-eta-coral.vercel.app",
        credentials: true
    })
)
app.use(cookieParser())
app.use(express.json({ limit: "50mb" }))
app.use(express.urlencoded({ extended: true, limit: "50mb" }))
app.use(express.static("public"))

app.use(async (req, res, next) => {
    try {
        await connect_db()
        next()
    } catch (error) {
        console.error("Database connection error:", error)
        return res.status(500).json({
            success: false,
            message: "Database connection failed"
        })
    }
})

app.use(requestLogger)

app.get("/", (req, res) => {
    res.send("Server is running.")
})

app.get("/favicon.ico", (req, res) => {
    res.status(204).end()
})

app.use("/api/v1/users", userRouter)
app.use("/api/v1/events", eventRouter)
app.use("/api/v1/teams", teamRouter)
app.use("/api/v1/expenses", expenseRouter)
app.use("/api/v1/webhooks", webhookRouter)
app.use("/api/v1/analytics", analyticsRouter)
app.use("/api/v1/admin/logs", logRouter)
app.use("/api/v1/ai", aiRouter)
app.use(errorHandler)

export default app