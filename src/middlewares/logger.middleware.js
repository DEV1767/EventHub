import AuditLog from "../models/auditLog.models.js"

const SENSITIVE_KEYS = new Set([
    "password",
    "oldpassword",
    "newpassword",
    "confirmpassword",
    "token",
    "otp",
    "refreshtoken",
    "accesstoken",
    "bankdetails",
    "accountnumber"
])

const sanitizePayload = (obj, depth = 0) => {
    if (!obj || typeof obj !== "object" || depth > 3) {
        return obj
    }

    if (Array.isArray(obj)) {
        return obj.slice(0, 20).map(item => sanitizePayload(item, depth + 1))
    }

    const sanitized = {}
    for (const [key, value] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase()
        if (SENSITIVE_KEYS.has(lowerKey)) {
            sanitized[key] = "[REDACTED]"
        } else if (typeof value === "object" && value !== null) {
            sanitized[key] = sanitizePayload(value, depth + 1)
        } else if (typeof value === "string" && value.length > 500) {
            sanitized[key] = value.slice(0, 500) + "...[TRUNCATED]"
        } else {
            sanitized[key] = value
        }
    }
    return sanitized
}

export const requestLogger = (req, res, next) => {
    if (req.path === "/favicon.ico") {
        return next()
    }

    const startTime = Date.now()

    res.on("finish", () => {
        const durationMs = Date.now() - startTime
        const statusCode = res.statusCode
        const isError = statusCode >= 400

        const ip = req.ip ||
            req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
            req.socket?.remoteAddress ||
            ""

        const logEntry = {
            method: req.method,
            url: req.originalUrl || req.url,
            statusCode,
            durationMs,
            ip,
            userId: req.user?._id || null,
            userEmail: req.user?.email || "",
            userRole: req.user?.role || "anonymous",
            collegename: req.user?.collegename || "",
            userAgent: req.headers["user-agent"] || "",
            isError,
            errorMessage: res.locals.errorMessage || (isError ? `HTTP ${statusCode}` : ""),
            errorStack: res.locals.errorStack || "",
            requestQuery: sanitizePayload(req.query),
            requestBody: req.method !== "GET" ? sanitizePayload(req.body) : {}
        }

        AuditLog.create(logEntry).catch(err => {
            console.error("Logger error:", err.message)
        })
    })

    next()
}

export default requestLogger
