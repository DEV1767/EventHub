import mongoose from "mongoose"
import Event from "../models/event.models.js"
import Team from "../models/team.models.js"
import Expense from "../models/expense.models.js"
import Coordinator from "../models/coordinator.models.js"
import { ApiError, ApiResponse } from "../utils/apiHandler.js"
import asyncHandler from "../utils/asyncHandler.js"
import { getCache, setCache } from "../utils/redis.helpers.js"

export const getFestOverviewStats = asyncHandler(async (req, res) => {
    const collegename = req.user.collegename?.toLowerCase().trim()
    const cacheKey = `analytics:overview:${collegename}`

    const cachedData = await getCache(cacheKey)
    if (cachedData) {
        return res.status(200).json(
            new ApiResponse(200, cachedData, "Fest overview analytics fetched from cache")
        )
    }

    const [eventAgg, teamAgg, expenseAgg] = await Promise.all([
        Event.aggregate([
            { $match: { collegename } },
            {
                $facet: {
                    statusBreakdown: [
                        {
                            $group: {
                                _id: "$status",
                                count: { $sum: 1 }
                            }
                        }
                    ],
                    budgetSummary: [
                        {
                            $group: {
                                _id: null,
                                totalEvents: { $sum: 1 },
                                publishedEvents: {
                                    $sum: { $cond: ["$isPublished", 1, 0] }
                                },
                                totalAllocatedBudget: { $sum: "$budget.totalAllocated" },
                                totalSpentBudget: { $sum: "$budget.totalSpent" }
                            }
                        }
                    ]
                }
            }
        ]),

        Team.aggregate([
            { $match: { collegename } },
            {
                $facet: {
                    metrics: [
                        {
                            $group: {
                                _id: null,
                                totalTeams: { $sum: 1 },
                                confirmedTeams: {
                                    $sum: { $cond: [{ $eq: ["$registrationStatus", "confirmed"] }, 1, 0] }
                                },
                                checkedInTeams: {
                                    $sum: { $cond: [{ $eq: ["$checkedIn", true] }, 1, 0] }
                                },
                                totalParticipants: {
                                    $sum: {
                                        $cond: [
                                            { $isArray: "$members" },
                                            { $size: "$members" },
                                            1
                                        ]
                                    }
                                },
                                checkedInParticipants: {
                                    $sum: {
                                        $cond: [
                                            { $eq: ["$checkedIn", true] },
                                            {
                                                $cond: [
                                                    { $isArray: "$members" },
                                                    { $size: "$members" },
                                                    1
                                                ]
                                            },
                                            0
                                        ]
                                    }
                                },
                                initialRevenue: {
                                    $sum: {
                                        $cond: [
                                            { $eq: ["$paymentStatus", "verified"] },
                                            { $ifNull: ["$amountPaid", 0] },
                                            0
                                        ]
                                    }
                                },
                                finalRevenue: {
                                    $sum: {
                                        $cond: [
                                            { $eq: ["$finalPayment.status", "verified"] },
                                            { $ifNull: ["$finalPayment.amount", 0] },
                                            0
                                        ]
                                    }
                                }
                            }
                        }
                    ],
                    submissionBreakdown: [
                        {
                            $group: {
                                _id: "$submissionStatus",
                                count: { $sum: 1 }
                            }
                        }
                    ]
                }
            }
        ]),

        Expense.aggregate([
            { $match: { collegename } },
            {
                $group: {
                    _id: null,
                    totalClaims: { $sum: 1 },
                    totalRequestedAmount: { $sum: "$requestedAmount" },
                    totalApprovedAmount: {
                        $sum: {
                            $cond: [
                                { $eq: ["$approvalStatus", "approved"] },
                                { $ifNull: ["$approvedAmount", "$requestedAmount"] },
                                0
                            ]
                        }
                    },
                    totalSettledAmount: {
                        $sum: {
                            $cond: [
                                { $eq: ["$paymentStatus", "paid"] },
                                { $ifNull: ["$approvedAmount", "$requestedAmount"] },
                                0
                            ]
                        }
                    },
                    pendingApprovalsCount: {
                        $sum: {
                            $cond: [
                                { $eq: ["$approvalStatus", "pending"] },
                                1,
                                0
                            ]
                        }
                    },
                    approvedUnsettledCount: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $eq: ["$approvalStatus", "approved"] },
                                        { $ne: ["$paymentStatus", "paid"] }
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    }
                }
            }
        ])
    ])

    const eventBudget = eventAgg[0]?.budgetSummary[0] || {
        totalEvents: 0,
        publishedEvents: 0,
        totalAllocatedBudget: 0,
        totalSpentBudget: 0
    }

    const eventStatusMap = {}
    ;(eventAgg[0]?.statusBreakdown || []).forEach(item => {
        if (item._id) eventStatusMap[item._id] = item.count
    })

    const teamMetrics = teamAgg[0]?.metrics[0] || {
        totalTeams: 0,
        confirmedTeams: 0,
        checkedInTeams: 0,
        totalParticipants: 0,
        checkedInParticipants: 0,
        initialRevenue: 0,
        finalRevenue: 0
    }

    const submissionMap = {}
    ;(teamAgg[0]?.submissionBreakdown || []).forEach(item => {
        if (item._id) submissionMap[item._id] = item.count
    })

    const expenseMetrics = expenseAgg[0] || {
        totalClaims: 0,
        totalRequestedAmount: 0,
        totalApprovedAmount: 0,
        totalSettledAmount: 0,
        pendingApprovalsCount: 0,
        approvedUnsettledCount: 0
    }

    const totalRevenue = Number(teamMetrics.initialRevenue || 0) + Number(teamMetrics.finalRevenue || 0)
    const totalAllocatedBudget = Number(eventBudget.totalAllocatedBudget || 0)
    const totalSpentBudget = Number(eventBudget.totalSpentBudget || 0)
    const remainingBudget = Math.max(0, totalAllocatedBudget - totalSpentBudget)
    const netBalance = totalRevenue - totalSpentBudget
    const budgetUtilizationRate = totalAllocatedBudget > 0 ? Number(((totalSpentBudget / totalAllocatedBudget) * 100).toFixed(2)) : 0
    const checkInRate = teamMetrics.totalTeams > 0 ? Number(((teamMetrics.checkedInTeams / teamMetrics.totalTeams) * 100).toFixed(2)) : 0

    const stats = {
        events: {
            total: eventBudget.totalEvents,
            published: eventBudget.publishedEvents,
            byStatus: {
                Draft: eventStatusMap.Draft || 0,
                Upcoming: eventStatusMap.Upcoming || 0,
                Ongoing: eventStatusMap.Ongoing || 0,
                Completed: eventStatusMap.Completed || 0,
                Cancelled: eventStatusMap.Cancelled || 0
            }
        },
        participants: {
            totalTeams: teamMetrics.totalTeams,
            confirmedTeams: teamMetrics.confirmedTeams,
            checkedInTeams: teamMetrics.checkedInTeams,
            checkInRate,
            totalParticipants: teamMetrics.totalParticipants,
            checkedInParticipants: teamMetrics.checkedInParticipants
        },
        submissions: {
            pending: submissionMap.pending || 0,
            shortlisted: submissionMap.shortlisted || 0,
            rejected: submissionMap.rejected || 0,
            notRequired: submissionMap.not_required || 0
        },
        finances: {
            totalAllocatedBudget,
            totalSpentBudget,
            remainingBudget,
            budgetUtilizationRate,
            initialRevenue: teamMetrics.initialRevenue,
            finalRevenue: teamMetrics.finalRevenue,
            totalRevenue,
            netBalance
        },
        expenses: {
            totalClaims: expenseMetrics.totalClaims,
            totalRequestedAmount: expenseMetrics.totalRequestedAmount,
            totalApprovedAmount: expenseMetrics.totalApprovedAmount,
            totalSettledAmount: expenseMetrics.totalSettledAmount,
            pendingApprovalsCount: expenseMetrics.pendingApprovalsCount,
            approvedUnsettledCount: expenseMetrics.approvedUnsettledCount
        }
    }

    await setCache(cacheKey, stats, 120)

    return res.status(200).json(
        new ApiResponse(200, stats, "Fest overview analytics fetched successfully")
    )
})

export const getDepartmentParticipationStats = asyncHandler(async (req, res) => {
    const collegename = req.user.collegename?.toLowerCase().trim()
    const cacheKey = `analytics:departments:${collegename}`

    const cachedData = await getCache(cacheKey)
    if (cachedData) {
        return res.status(200).json(
            new ApiResponse(200, cachedData, "Department analytics fetched from cache")
        )
    }

    const [departmentParticipants, departmentEvents, categoryDistribution] = await Promise.all([
        Team.aggregate([
            { $match: { collegename } },
            { $unwind: "$members" },
            {
                $group: {
                    _id: {
                        $cond: [
                            {
                                $and: [
                                    { $ne: ["$members.department", null] },
                                    { $ne: ["$members.department", ""] }
                                ]
                            },
                            { $toUpper: "$members.department" },
                            "OTHER"
                        ]
                    },
                    totalParticipants: { $sum: 1 },
                    checkedInParticipants: {
                        $sum: { $cond: [{ $eq: ["$checkedIn", true] }, 1, 0] }
                    }
                }
            },
            { $sort: { totalParticipants: -1 } }
        ]),

        Event.aggregate([
            { $match: { collegename } },
            {
                $group: {
                    _id: {
                        $cond: [
                            {
                                $and: [
                                    { $ne: ["$department", null] },
                                    { $ne: ["$department", ""] }
                                ]
                            },
                            { $toUpper: "$department" },
                            "OTHER"
                        ]
                    },
                    eventCount: { $sum: 1 },
                    totalAllocatedBudget: { $sum: "$budget.totalAllocated" },
                    totalSpentBudget: { $sum: "$budget.totalSpent" }
                }
            },
            { $sort: { eventCount: -1 } }
        ]),

        Event.aggregate([
            { $match: { collegename } },
            {
                $group: {
                    _id: "$category",
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } }
        ])
    ])

    const formattedDepartments = departmentParticipants.map(dept => ({
        department: dept._id,
        totalParticipants: dept.totalParticipants,
        checkedInParticipants: dept.checkedInParticipants,
        attendanceRate: dept.totalParticipants > 0 ? Number(((dept.checkedInParticipants / dept.totalParticipants) * 100).toFixed(2)) : 0
    }))

    const formattedEvents = departmentEvents.map(dept => ({
        department: dept._id,
        eventCount: dept.eventCount,
        totalAllocatedBudget: dept.totalAllocatedBudget,
        totalSpentBudget: dept.totalSpentBudget
    }))

    const formattedCategories = categoryDistribution.map(cat => ({
        category: cat._id,
        count: cat.count
    }))

    const stats = {
        departmentParticipants: formattedDepartments,
        departmentEvents: formattedEvents,
        categoryDistribution: formattedCategories
    }

    await setCache(cacheKey, stats, 300)

    return res.status(200).json(
        new ApiResponse(200, stats, "Department analytics fetched successfully")
    )
})

export const getEventFinanceLedger = asyncHandler(async (req, res) => {
    const collegename = req.user.collegename?.toLowerCase().trim()
    const { status, department, search, page = 1, limit = 20 } = req.query

    const pageNumber = Math.max(1, parseInt(page, 10) || 1)
    const limitNumber = Math.max(1, Math.min(100, parseInt(limit, 10) || 20))
    const skip = (pageNumber - 1) * limitNumber

    const cacheKey = `analytics:ledger:${collegename}:${pageNumber}:${limitNumber}:${status || "all"}:${department || "all"}:${search || "all"}`
    const cachedData = await getCache(cacheKey)
    if (cachedData) {
        return res.status(200).json(
            new ApiResponse(200, cachedData, "Finance ledger fetched from cache")
        )
    }

    const eventQuery = { collegename }
    if (status) {
        eventQuery.status = status
    }
    if (department) {
        eventQuery.department = department.toUpperCase()
    }
    if (search) {
        eventQuery.title = { $regex: search.trim(), $options: "i" }
    }

    const [events, totalEventsCount] = await Promise.all([
        Event.find(eventQuery)
            .select("title category department organizingDepartment status startDate endDate maxParticipants registeredCount budget submissionSettings")
            .sort({ startDate: -1 })
            .skip(skip)
            .limit(limitNumber)
            .lean(),
        Event.countDocuments(eventQuery)
    ])

    const eventIds = events.map(e => e._id)

    const [teamsAgg, expensesAgg] = await Promise.all([
        Team.aggregate([
            {
                $match: {
                    eventId: { $in: eventIds },
                    collegename
                }
            },
            {
                $group: {
                    _id: "$eventId",
                    totalRegisteredTeams: { $sum: 1 },
                    initialFeeRevenue: {
                        $sum: {
                            $cond: [
                                { $eq: ["$paymentStatus", "verified"] },
                                { $ifNull: ["$amountPaid", 0] },
                                0
                            ]
                        }
                    },
                    finalFeeRevenue: {
                        $sum: {
                            $cond: [
                                { $eq: ["$finalPayment.status", "verified"] },
                                { $ifNull: ["$finalPayment.amount", 0] },
                                0
                            ]
                        }
                    }
                }
            }
        ]),

        Expense.aggregate([
            {
                $match: {
                    eventId: { $in: eventIds },
                    collegename
                }
            },
            {
                $group: {
                    _id: "$eventId",
                    totalClaims: { $sum: 1 },
                    approvedClaims: {
                        $sum: { $cond: [{ $eq: ["$approvalStatus", "approved"] }, 1, 0] }
                    },
                    pendingClaims: {
                        $sum: { $cond: [{ $eq: ["$approvalStatus", "pending"] }, 1, 0] }
                    },
                    totalApprovedAmount: {
                        $sum: {
                            $cond: [
                                { $eq: ["$approvalStatus", "approved"] },
                                { $ifNull: ["$approvedAmount", "$requestedAmount"] },
                                0
                            ]
                        }
                    },
                    totalSettledAmount: {
                        $sum: {
                            $cond: [
                                { $eq: ["$paymentStatus", "paid"] },
                                { $ifNull: ["$approvedAmount", "$requestedAmount"] },
                                0
                            ]
                        }
                    }
                }
            }
        ])
    ])

    const teamsMap = {}
    teamsAgg.forEach(item => {
        teamsMap[item._id.toString()] = item
    })

    const expensesMap = {}
    expensesAgg.forEach(item => {
        expensesMap[item._id.toString()] = item
    })

    let pageAllocated = 0
    let pageSpent = 0
    let pageRevenue = 0

    const ledger = events.map(event => {
        const eventIdStr = event._id.toString()
        const teamData = teamsMap[eventIdStr] || {
            totalRegisteredTeams: 0,
            initialFeeRevenue: 0,
            finalFeeRevenue: 0
        }
        const expenseData = expensesMap[eventIdStr] || {
            totalClaims: 0,
            approvedClaims: 0,
            pendingClaims: 0,
            totalApprovedAmount: 0,
            totalSettledAmount: 0
        }

        const allocatedBudget = Number(event.budget?.totalAllocated || 0)
        const spentBudget = Number(event.budget?.totalSpent || 0)
        const initialRevenue = Number(teamData.initialFeeRevenue || 0)
        const finalRevenue = Number(teamData.finalFeeRevenue || 0)
        const totalRevenue = initialRevenue + finalRevenue
        const netProfitLoss = totalRevenue - spentBudget
        const budgetUtilizationRate = allocatedBudget > 0 ? Number(((spentBudget / allocatedBudget) * 100).toFixed(2)) : 0

        pageAllocated += allocatedBudget
        pageSpent += spentBudget
        pageRevenue += totalRevenue

        return {
            _id: event._id,
            title: event.title,
            category: event.category,
            department: event.department || event.organizingDepartment,
            status: event.status,
            startDate: event.startDate,
            endDate: event.endDate,
            maxParticipants: event.maxParticipants,
            registeredCount: event.registeredCount,
            totalTeams: teamData.totalRegisteredTeams,
            allocatedBudget,
            spentBudget,
            remainingBudget: Math.max(0, allocatedBudget - spentBudget),
            budgetUtilizationRate,
            initialFeeRevenue: initialRevenue,
            finalFeeRevenue: finalRevenue,
            totalRevenue,
            netProfitLoss,
            expenses: {
                totalClaims: expenseData.totalClaims,
                approvedClaims: expenseData.approvedClaims,
                pendingClaims: expenseData.pendingClaims,
                approvedAmount: expenseData.totalApprovedAmount,
                settledAmount: expenseData.totalSettledAmount
            }
        }
    })

    const result = {
        ledger,
        summary: {
            pageAllocated,
            pageSpent,
            pageRevenue,
            pageNetProfitLoss: pageRevenue - pageSpent
        },
        pagination: {
            page: pageNumber,
            limit: limitNumber,
            totalItems: totalEventsCount,
            totalPages: Math.ceil(totalEventsCount / limitNumber)
        }
    }

    await setCache(cacheKey, result, 120)

    return res.status(200).json(
        new ApiResponse(200, result, "Finance ledger fetched successfully")
    )
})

export const getEventAnalytics = asyncHandler(async (req, res) => {
    const { eventId } = req.params

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
        throw new ApiError(400, "Invalid event ID")
    }

    const event = await Event.findById(eventId)
    if (!event) {
        throw new ApiError(404, "Event not found")
    }

    if (event.collegename !== req.user.collegename?.toLowerCase().trim()) {
        throw new ApiError(403, "Access denied: Event belongs to another institution")
    }

    const isCreator = event.createdBy.toString() === req.user._id.toString()
    const isCoordinator = await Coordinator.exists({
        eventId,
        userId: req.user._id,
        invitationStatus: "accepted"
    })
    const isStaffOrAdmin = ["faculty", "principal", "admin"].includes(req.user.role)

    if (!isCreator && !isCoordinator && !isStaffOrAdmin) {
        throw new ApiError(403, "Access denied: You do not have permission to view this event's analytics")
    }

    const cacheKey = `analytics:event:${eventId}`
    const cachedData = await getCache(cacheKey)
    if (cachedData) {
        return res.status(200).json(
            new ApiResponse(200, cachedData, "Event analytics fetched from cache")
        )
    }

    const [teamMetricsAgg, expenseMetricsAgg, recentCheckIns] = await Promise.all([
        Team.aggregate([
            { $match: { eventId: new mongoose.Types.ObjectId(eventId) } },
            {
                $facet: {
                    totals: [
                        {
                            $group: {
                                _id: null,
                                totalTeams: { $sum: 1 },
                                confirmedTeams: {
                                    $sum: { $cond: [{ $eq: ["$registrationStatus", "confirmed"] }, 1, 0] }
                                },
                                checkedInTeams: {
                                    $sum: { $cond: [{ $eq: ["$checkedIn", true] }, 1, 0] }
                                },
                                totalParticipants: {
                                    $sum: {
                                        $cond: [
                                            { $isArray: "$members" },
                                            { $size: "$members" },
                                            1
                                        ]
                                    }
                                },
                                checkedInParticipants: {
                                    $sum: {
                                        $cond: [
                                            { $eq: ["$checkedIn", true] },
                                            {
                                                $cond: [
                                                    { $isArray: "$members" },
                                                    { $size: "$members" },
                                                    1
                                                ]
                                            },
                                            0
                                        ]
                                    }
                                },
                                initialFeeRevenue: {
                                    $sum: {
                                        $cond: [
                                            { $eq: ["$paymentStatus", "verified"] },
                                            { $ifNull: ["$amountPaid", 0] },
                                            0
                                        ]
                                    }
                                },
                                finalFeeRevenue: {
                                    $sum: {
                                        $cond: [
                                            { $eq: ["$finalPayment.status", "verified"] },
                                            { $ifNull: ["$finalPayment.amount", 0] },
                                            0
                                        ]
                                    }
                                }
                            }
                        }
                    ],
                    submissions: [
                        {
                            $group: {
                                _id: "$submissionStatus",
                                count: { $sum: 1 }
                            }
                        }
                    ]
                }
            }
        ]),

        Expense.aggregate([
            { $match: { eventId: new mongoose.Types.ObjectId(eventId) } },
            {
                $group: {
                    _id: null,
                    totalClaims: { $sum: 1 },
                    totalRequestedAmount: { $sum: "$requestedAmount" },
                    totalApprovedAmount: {
                        $sum: {
                            $cond: [
                                { $eq: ["$approvalStatus", "approved"] },
                                { $ifNull: ["$approvedAmount", "$requestedAmount"] },
                                0
                            ]
                        }
                    },
                    totalSettledAmount: {
                        $sum: {
                            $cond: [
                                { $eq: ["$paymentStatus", "paid"] },
                                { $ifNull: ["$approvedAmount", "$requestedAmount"] },
                                0
                            ]
                        }
                    },
                    pendingApprovalsCount: {
                        $sum: {
                            $cond: [
                                { $eq: ["$approvalStatus", "pending"] },
                                1,
                                0
                            ]
                        }
                    }
                }
            }
        ]),

        Team.find({
            eventId,
            checkedIn: true
        })
            .select("teamName checkedInAt registrationNumber members")
            .populate("leaderId", "name email phonenumber")
            .sort({ checkedInAt: -1 })
            .limit(10)
            .lean()
    ])

    const totals = teamMetricsAgg[0]?.totals[0] || {
        totalTeams: 0,
        confirmedTeams: 0,
        checkedInTeams: 0,
        totalParticipants: 0,
        checkedInParticipants: 0,
        initialFeeRevenue: 0,
        finalFeeRevenue: 0
    }

    const submissionMap = {}
    ;(teamMetricsAgg[0]?.submissions || []).forEach(item => {
        if (item._id) submissionMap[item._id] = item.count
    })

    const expenses = expenseMetricsAgg[0] || {
        totalClaims: 0,
        totalRequestedAmount: 0,
        totalApprovedAmount: 0,
        totalSettledAmount: 0,
        pendingApprovalsCount: 0
    }

    const allocatedBudget = Number(event.budget?.totalAllocated || 0)
    const spentBudget = Number(event.budget?.totalSpent || 0)
    const initialFeeRevenue = Number(totals.initialFeeRevenue || 0)
    const finalFeeRevenue = Number(totals.finalFeeRevenue || 0)
    const totalRevenue = initialFeeRevenue + finalFeeRevenue
    const capacityOccupancyRate = event.maxParticipants > 0 ? Number(((event.registeredCount / event.maxParticipants) * 100).toFixed(2)) : 0
    const checkInRate = totals.totalTeams > 0 ? Number(((totals.checkedInTeams / totals.totalTeams) * 100).toFixed(2)) : 0
    const budgetUtilizationRate = allocatedBudget > 0 ? Number(((spentBudget / allocatedBudget) * 100).toFixed(2)) : 0

    const categoriesBudget = (event.budget?.categories || []).map(cat => ({
        name: cat.name,
        allocatedAmount: cat.allocatedAmount || 0,
        spentAmount: cat.spentAmount || 0,
        remainingAmount: Math.max(0, (cat.allocatedAmount || 0) - (cat.spentAmount || 0))
    }))

    const analytics = {
        event: {
            _id: event._id,
            title: event.title,
            category: event.category,
            department: event.department || event.organizingDepartment,
            venue: event.venue,
            startDate: event.startDate,
            endDate: event.endDate,
            status: event.status,
            registrationStatus: event.registrationStatus,
            participationType: event.participationType,
            rulesVisible: event.rulesVisible
        },
        capacity: {
            maxParticipants: event.maxParticipants,
            registeredCount: event.registeredCount,
            capacityOccupancyRate,
            remainingSpots: Math.max(0, event.maxParticipants - event.registeredCount)
        },
        attendance: {
            totalTeams: totals.totalTeams,
            confirmedTeams: totals.confirmedTeams,
            checkedInTeams: totals.checkedInTeams,
            checkInRate,
            totalParticipants: totals.totalParticipants,
            checkedInParticipants: totals.checkedInParticipants
        },
        submissions: {
            isRequired: event.submissionSettings?.isRequired || false,
            pending: submissionMap.pending || 0,
            shortlisted: submissionMap.shortlisted || 0,
            rejected: submissionMap.rejected || 0,
            notRequired: submissionMap.not_required || 0
        },
        finances: {
            allocatedBudget,
            spentBudget,
            remainingBudget: Math.max(0, allocatedBudget - spentBudget),
            budgetUtilizationRate,
            initialFeeRevenue,
            finalFeeRevenue,
            totalRevenue,
            netBalance: totalRevenue - spentBudget,
            categories: categoriesBudget
        },
        expenses: {
            totalClaims: expenses.totalClaims,
            totalRequestedAmount: expenses.totalRequestedAmount,
            totalApprovedAmount: expenses.totalApprovedAmount,
            totalSettledAmount: expenses.totalSettledAmount,
            pendingApprovalsCount: expenses.pendingApprovalsCount
        },
        recentCheckIns: recentCheckIns.map(t => ({
            teamId: t._id,
            teamName: t.teamName,
            registrationNumber: t.registrationNumber,
            leaderName: t.leaderId?.name || "",
            memberCount: t.members?.length || 0,
            checkedInAt: t.checkedInAt
        }))
    }

    await setCache(cacheKey, analytics, 60)

    return res.status(200).json(
        new ApiResponse(200, analytics, "Event analytics fetched successfully")
    )
})
