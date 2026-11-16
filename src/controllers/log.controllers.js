import mongoose from "mongoose"
import AuditLog from "../models/auditLog.models.js"
import { ApiError, ApiResponse } from "../utils/apiHandler.js"
import asyncHandler from "../utils/asyncHandler.js"
import { getCache, setCache } from "../utils/redis.helpers.js"

export const getLogDashboardStats = asyncHandler(async (req, res) => {
    const cacheKey = "admin:logs:dashboard"
    const cachedStats = await getCache(cacheKey)
    if (cachedStats) {
        return res.status(200).json(
            new ApiResponse(200, cachedStats, "Log dashboard stats fetched from cache")
        )
    }

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

    const [summaryAgg, topHitRoutes, topErrorRoutes, roleAgg, recentErrors] = await Promise.all([
        AuditLog.aggregate([
            {
                $facet: {
                    allTime: [
                        {
                            $group: {
                                _id: null,
                                totalRequests: { $sum: 1 },
                                totalErrors: { $sum: { $cond: ["$isError", 1, 0] } },
                                avgDurationMs: { $avg: "$durationMs" },
                                count2xx: {
                                    $sum: {
                                        $cond: [
                                            {
                                                $and: [
                                                    { $gte: ["$statusCode", 200] },
                                                    { $lt: ["$statusCode", 300] }
                                                ]
                                            },
                                            1,
                                            0
                                        ]
                                    }
                                },
                                count3xx: {
                                    $sum: {
                                        $cond: [
                                            {
                                                $and: [
                                                    { $gte: ["$statusCode", 300] },
                                                    { $lt: ["$statusCode", 400] }
                                                ]
                                            },
                                            1,
                                            0
                                        ]
                                    }
                                },
                                count4xx: {
                                    $sum: {
                                        $cond: [
                                            {
                                                $and: [
                                                    { $gte: ["$statusCode", 400] },
                                                    { $lt: ["$statusCode", 500] }
                                                ]
                                            },
                                            1,
                                            0
                                        ]
                                    }
                                },
                                count5xx: {
                                    $sum: {
                                        $cond: [
                                            { $gte: ["$statusCode", 500] },
                                            1,
                                            0
                                        ]
                                    }
                                }
                            }
                        }
                    ],
                    last24Hours: [
                        { $match: { createdAt: { $gte: twentyFourHoursAgo } } },
                        {
                            $group: {
                                _id: null,
                                totalRequests: { $sum: 1 },
                                totalErrors: { $sum: { $cond: ["$isError", 1, 0] } },
                                avgDurationMs: { $avg: "$durationMs" }
                            }
                        }
                    ]
                }
            }
        ]),

        AuditLog.aggregate([
            {
                $group: {
                    _id: { method: "$method", url: "$url" },
                    hits: { $sum: 1 },
                    errors: { $sum: { $cond: ["$isError", 1, 0] } },
                    avgDurationMs: { $avg: "$durationMs" }
                }
            },
            { $sort: { hits: -1 } },
            { $limit: 10 }
        ]),

        AuditLog.aggregate([
            { $match: { isError: true } },
            {
                $group: {
                    _id: { method: "$method", url: "$url" },
                    errorCount: { $sum: 1 },
                    lastStatusCode: { $last: "$statusCode" },
                    lastErrorMessage: { $last: "$errorMessage" }
                }
            },
            { $sort: { errorCount: -1 } },
            { $limit: 10 }
        ]),

        AuditLog.aggregate([
            {
                $group: {
                    _id: "$userRole",
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } }
        ]),

        AuditLog.find({ isError: true })
            .select("method url statusCode durationMs errorMessage userEmail userRole ip createdAt")
            .sort({ createdAt: -1 })
            .limit(15)
            .lean()
    ])

    const allTime = summaryAgg[0]?.allTime[0] || {
        totalRequests: 0,
        totalErrors: 0,
        avgDurationMs: 0,
        count2xx: 0,
        count3xx: 0,
        count4xx: 0,
        count5xx: 0
    }

    const last24h = summaryAgg[0]?.last24Hours[0] || {
        totalRequests: 0,
        totalErrors: 0,
        avgDurationMs: 0
    }

    const errorRateAllTime = allTime.totalRequests > 0
        ? Number(((allTime.totalErrors / allTime.totalRequests) * 100).toFixed(2))
        : 0

    const errorRate24h = last24h.totalRequests > 0
        ? Number(((last24h.totalErrors / last24h.totalRequests) * 100).toFixed(2))
        : 0

    const stats = {
        summary: {
            allTime: {
                totalRequests: allTime.totalRequests,
                totalErrors: allTime.totalErrors,
                errorRate: errorRateAllTime,
                avgDurationMs: Number((allTime.avgDurationMs || 0).toFixed(2)),
                statusBreakdown: {
                    "2xx": allTime.count2xx,
                    "3xx": allTime.count3xx,
                    "4xx": allTime.count4xx,
                    "5xx": allTime.count5xx
                }
            },
            last24Hours: {
                totalRequests: last24h.totalRequests,
                totalErrors: last24h.totalErrors,
                errorRate: errorRate24h,
                avgDurationMs: Number((last24h.avgDurationMs || 0).toFixed(2))
            }
        },
        topHitRoutes: topHitRoutes.map(item => ({
            method: item._id.method,
            url: item._id.url,
            hits: item.hits,
            errors: item.errors,
            avgDurationMs: Number((item.avgDurationMs || 0).toFixed(2))
        })),
        topErrorRoutes: topErrorRoutes.map(item => ({
            method: item._id.method,
            url: item._id.url,
            errorCount: item.errorCount,
            lastStatusCode: item.lastStatusCode,
            lastErrorMessage: item.lastErrorMessage
        })),
        roleDistribution: roleAgg.map(item => ({
            role: item._id || "anonymous",
            count: item.count
        })),
        recentErrors
    }

    await setCache(cacheKey, stats, 15)

    return res.status(200).json(
        new ApiResponse(200, stats, "Log dashboard stats fetched successfully")
    )
})

export const getSystemLogs = asyncHandler(async (req, res) => {
    const {
        page = 1,
        limit = 25,
        method,
        statusCode,
        statusType,
        search,
        userRole,
        startDate,
        endDate
    } = req.query

    const pageNumber = Math.max(1, parseInt(page, 10) || 1)
    const limitNumber = Math.max(1, Math.min(100, parseInt(limit, 10) || 25))
    const skip = (pageNumber - 1) * limitNumber

    const filter = {}

    if (method) {
        filter.method = method.toUpperCase()
    }

    if (statusCode) {
        filter.statusCode = parseInt(statusCode, 10)
    } else if (statusType) {
        if (statusType === "2xx") {
            filter.statusCode = { $gte: 200, $lt: 300 }
        } else if (statusType === "3xx") {
            filter.statusCode = { $gte: 300, $lt: 400 }
        } else if (statusType === "4xx") {
            filter.statusCode = { $gte: 400, $lt: 500 }
        } else if (statusType === "5xx") {
            filter.statusCode = { $gte: 500 }
        } else if (statusType === "errors") {
            filter.isError = true
        }
    }

    if (userRole) {
        filter.userRole = userRole.toLowerCase()
    }

    if (startDate || endDate) {
        filter.createdAt = {}
        if (startDate) {
            filter.createdAt.$gte = new Date(startDate)
        }
        if (endDate) {
            filter.createdAt.$lte = new Date(endDate)
        }
    }

    if (search) {
        const searchRegex = { $regex: search.trim(), $options: "i" }
        filter.$or = [
            { url: searchRegex },
            { errorMessage: searchRegex },
            { userEmail: searchRegex },
            { ip: searchRegex }
        ]
    }

    const [logs, totalLogs] = await Promise.all([
        AuditLog.find(filter)
            .select("method url statusCode durationMs ip userEmail userRole isError errorMessage createdAt")
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNumber)
            .lean(),
        AuditLog.countDocuments(filter)
    ])

    const result = {
        logs,
        pagination: {
            page: pageNumber,
            limit: limitNumber,
            totalItems: totalLogs,
            totalPages: Math.ceil(totalLogs / limitNumber)
        }
    }

    return res.status(200).json(
        new ApiResponse(200, result, "System logs fetched successfully")
    )
})

export const getLogDetails = asyncHandler(async (req, res) => {
    const { logId } = req.params

    if (!mongoose.Types.ObjectId.isValid(logId)) {
        throw new ApiError(400, "Invalid log ID")
    }

    const log = await AuditLog.findById(logId)
        .populate("userId", "name email role collegename")
        .lean()

    if (!log) {
        throw new ApiError(404, "Log entry not found")
    }

    return res.status(200).json(
        new ApiResponse(200, log, "Log details fetched successfully")
    )
})

export const clearOldLogs = asyncHandler(async (req, res) => {
    const { days = 30 } = req.query
    const daysNumber = Math.max(1, parseInt(days, 10) || 30)

    const cutoffDate = new Date(Date.now() - daysNumber * 24 * 60 * 60 * 1000)

    const result = await AuditLog.deleteMany({
        createdAt: { $lt: cutoffDate }
    })

    return res.status(200).json(
        new ApiResponse(200, { deletedCount: result.deletedCount }, `Logs older than ${daysNumber} days cleared successfully`)
    )
})
