import Expense from "../models/expense.models.js"
import Event from "../models/event.models.js"
import Coordinator from "../models/coordinator.models.js"
import { ApiError, ApiResponse } from "../utils/apiHandler.js"
import asyncHandler from "../utils/asyncHandler.js"
import { uploadOnCloudinary } from "../utils/cloudinary.js"
import { qstashClient } from "../config/qstash.js"

export const submitExpenseClaim = asyncHandler(async (req, res) => {
    const { eventId } = req.params
    const {
        title,
        category,
        otherCategoryDetails,
        requestedAmount,
        assignedApproverRole,
        coordinatorUpiId
    } = req.body

    const event = await Event.findById(eventId)
    if (!event) {
        throw new ApiError(404, "Event not found")
    }

    const isCreator = event.createdBy.toString() === req.user._id.toString()
    const isCoordinator = await Coordinator.exists({
        eventId,
        userId: req.user._id,
        invitationStatus: "accepted"
    })

    if (!isCreator && !isCoordinator && req.user.role !== "admin") {
        throw new ApiError(403, "Only appointed event coordinators or faculty can file expense claims")
    }

    if (!title || !requestedAmount || Number(requestedAmount) <= 0) {
        throw new ApiError(400, "Title and a valid positive requested amount are required")
    }

    const billPath = req.file?.path || req.files?.bill?.[0]?.path
    if (!billPath) {
        throw new ApiError(400, "Bill receipt (image or PDF) is required")
    }

    const isPdf = req.file?.mimetype === "application/pdf" || billPath.toLowerCase().endsWith(".pdf")
    const uploadRes = await uploadOnCloudinary(billPath, "eventhub/bills")
    if (!uploadRes?.url) {
        throw new ApiError(500, "Failed to upload bill receipt")
    }

    const categoryDoc = event.budget?.categories?.find(c => c.name === category)

    const expense = await Expense.create({
        eventId,
        coordinatorId: req.user._id,
        facultyId: event.createdBy,
        collegename: event.collegename,
        title: title.trim(),
        category: category || "Other",
        otherCategoryDetails: otherCategoryDetails || "",
        categoryId: categoryDoc?._id,
        assignedApproverRole: assignedApproverRole || "faculty",
        requestedAmount: Number(requestedAmount),
        coordinatorUpiId: coordinatorUpiId?.trim() || "",
        bill: {
            url: uploadRes.url,
            public_id: uploadRes.public_id,
            fileType: isPdf ? "pdf" : "image"
        },
        aiProcessingStatus: "pending",
        approvalStatus: "pending",
        paymentStatus: "not_paid"
    })

    try {
        if (process.env.QSTASH_TOKEN && process.env.APP_URL) {
            await qstashClient.publishJSON({
                url: `${process.env.APP_URL}/api/v1/webhooks/ocr-process`,
                body: {
                    expenseId: expense._id,
                    billUrl: expense.bill.url,
                    fileType: expense.bill.fileType,
                    requestedAmount: expense.requestedAmount
                }
            })
        }
    } catch (queueErr) {
        console.error("OCR queue dispatch skipped:", queueErr?.message)
    }

    return res.status(201).json(
        new ApiResponse(201, expense, "Expense claim submitted and queued for OCR processing")
    )
})

export const updateExpenseOcrData = asyncHandler(async (req, res) => {
    const { expenseId } = req.params
    const { invoiceDetails, aiConfidence, status = "completed" } = req.body

    const expense = await Expense.findById(expenseId)
    if (!expense) {
        throw new ApiError(404, "Expense claim not found")
    }

    expense.aiProcessingStatus = status
    if (aiConfidence !== undefined) {
        expense.aiConfidence = Number(aiConfidence)
    }

    if (invoiceDetails) {
        expense.invoiceDetails = {
            vendorName: invoiceDetails.vendorName || "",
            invoiceNumber: invoiceDetails.invoiceNumber || "",
            invoiceDate: invoiceDetails.invoiceDate ? new Date(invoiceDetails.invoiceDate) : undefined,
            items: invoiceDetails.items || [],
            subtotal: Number(invoiceDetails.subtotal) || 0,
            gst: Number(invoiceDetails.gst) || 0,
            totalAmount: Number(invoiceDetails.totalAmount) || 0,
            currency: invoiceDetails.currency || "INR"
        }
    }

    await expense.save()

    return res.status(200).json(
        new ApiResponse(200, expense, "OCR data processed and stored successfully")
    )
})

export const getEventExpenses = asyncHandler(async (req, res) => {
    const { eventId } = req.params
    const { approvalStatus, category, assignedApproverRole } = req.query

    const event = await Event.findById(eventId)
    if (!event) {
        throw new ApiError(404, "Event not found")
    }

    const isCreator = event.createdBy.toString() === req.user._id.toString()
    const isCoordinator = await Coordinator.exists({
        eventId,
        userId: req.user._id,
        invitationStatus: "accepted"
    })
    const isPrincipal = req.user.role === "principal" && req.user.collegename === event.collegename
    const isAdmin = req.user.role === "admin"

    if (!isCreator && !isCoordinator && !isPrincipal && !isAdmin) {
        throw new ApiError(403, "Access denied: Insufficient permissions to view event expenses")
    }

    const filter = { eventId }
    if (approvalStatus) filter.approvalStatus = approvalStatus
    if (category) filter.category = category
    if (assignedApproverRole) filter.assignedApproverRole = assignedApproverRole

    const rawExpenses = await Expense.find(filter)
        .populate("coordinatorId", "name email department phonenumber")
        .populate("approvedBy", "name email role")
        .sort({ createdAt: -1 })

    const expenses = rawExpenses.map(exp => {
        const doc = exp.toObject()
        const ocrTotal = doc.invoiceDetails?.totalAmount || 0
        const hasOcr = doc.aiProcessingStatus === "completed" && ocrTotal > 0
        const discrepancy = hasOcr ? Math.abs(doc.requestedAmount - ocrTotal) : 0
        return {
            ...doc,
            aiAnalysis: {
                hasOcr,
                ocrTotal,
                discrepancy,
                hasDiscrepancy: discrepancy > 5,
                confidence: doc.aiConfidence || 0
            }
        }
    })

    const totalAllocated = event.budget?.totalAllocated || 0
    const totalSpent = event.budget?.totalSpent || 0
    const overallUtilization = totalAllocated > 0 ? (totalSpent / totalAllocated) * 100 : 0

    const categoryBreakdown = (event.budget?.categories || []).map(cat => {
        const util = cat.allocatedAmount > 0 ? (cat.spentAmount / cat.allocatedAmount) * 100 : 0
        return {
            name: cat.name,
            allocatedAmount: cat.allocatedAmount,
            spentAmount: cat.spentAmount,
            utilizationPercentage: Number(util.toFixed(2)),
            isWarning: util >= 90 && util < 100,
            isLocked: util >= 100
        }
    })

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                budgetSummary: {
                    totalAllocated,
                    totalSpent,
                    overallUtilizationPercentage: Number(overallUtilization.toFixed(2)),
                    isOverallWarning: overallUtilization >= 90 && overallUtilization < 100,
                    isOverallLocked: overallUtilization >= 100,
                    categories: categoryBreakdown
                },
                expenses
            },
            "Event expenses and budget summary fetched successfully"
        )
    )
})

export const getApproverQueue = asyncHandler(async (req, res) => {
    const { status = "pending" } = req.query
    const userRole = req.user.role

    if (!["faculty", "principal", "admin"].includes(userRole)) {
        throw new ApiError(403, "Access denied: Only faculty and principal can review expense queues")
    }

    const filter = {
        collegename: req.user.collegename,
        approvalStatus: status
    }

    if (userRole === "faculty") {
        filter.facultyId = req.user._id
        filter.assignedApproverRole = "faculty"
    } else if (userRole === "principal") {
        filter.assignedApproverRole = "principal"
    }

    const claims = await Expense.find(filter)
        .populate("eventId", "title venue startDate budget")
        .populate("coordinatorId", "name email department phonenumber")
        .sort({ createdAt: -1 })

    const formattedClaims = claims.map(c => {
        const item = c.toObject()
        const ocrTotal = item.invoiceDetails?.totalAmount || 0
        const hasOcr = item.aiProcessingStatus === "completed" && ocrTotal > 0
        const discrepancy = hasOcr ? Math.abs(item.requestedAmount - ocrTotal) : 0
        return {
            ...item,
            aiFraudGuard: {
                hasOcr,
                ocrExtractedTotal: ocrTotal,
                discrepancy,
                isHighRiskDiscrepancy: discrepancy > 5,
                aiConfidence: item.aiConfidence || 0
            }
        }
    })

    return res.status(200).json(
        new ApiResponse(200, formattedClaims, "Approver queue fetched successfully")
    )
})

export const approveOrRejectExpense = asyncHandler(async (req, res) => {
    const { expenseId } = req.params
    const { action, approvedAmount, rejectionReason } = req.body

    if (!["approve", "reject"].includes(action)) {
        throw new ApiError(400, "Action must be either 'approve' or 'reject'")
    }

    const expense = await Expense.findById(expenseId).populate("eventId")
    if (!expense) {
        throw new ApiError(404, "Expense claim not found")
    }

    if (expense.approvalStatus !== "pending") {
        throw new ApiError(400, `Claim has already been ${expense.approvalStatus}`)
    }

    const event = expense.eventId
    const userRole = req.user.role
    const isAssignedFaculty = userRole === "faculty" && expense.facultyId.toString() === req.user._id.toString()
    const isAssignedPrincipal = userRole === "principal" && expense.collegename === req.user.collegename
    const isAdmin = userRole === "admin"

    if (expense.assignedApproverRole === "faculty" && !isAssignedFaculty && !isAdmin) {
        throw new ApiError(403, "Only the tagged faculty in-charge can approve this expense")
    }

    if (expense.assignedApproverRole === "principal" && !isAssignedPrincipal && !isAdmin) {
        throw new ApiError(403, "Only the college principal can approve this expense")
    }

    if (action === "reject") {
        expense.approvalStatus = "rejected"
        expense.rejectionReason = rejectionReason || "Claim rejected by approver"
        expense.approvedBy = req.user._id
        expense.approvedAt = new Date()
        await expense.save()

        return res.status(200).json(
            new ApiResponse(200, expense, "Expense claim rejected")
        )
    }

    const finalAmount = Number(approvedAmount) > 0 ? Number(approvedAmount) : expense.requestedAmount

    let categoryDoc = event.budget?.categories?.find(c => c.name === expense.category)
    if (categoryDoc) {
        categoryDoc.spentAmount = (categoryDoc.spentAmount || 0) + finalAmount
    }
    event.budget.totalSpent = (event.budget.totalSpent || 0) + finalAmount
    await event.save()

    expense.approvalStatus = "approved"
    expense.approvedAmount = finalAmount
    expense.approvedBy = req.user._id
    expense.approvedAt = new Date()
    expense.rejectionReason = ""
    await expense.save()

    const catAllocated = categoryDoc?.allocatedAmount || 0
    const catSpent = categoryDoc?.spentAmount || 0
    const isCategoryWarning = catAllocated > 0 && (catSpent / catAllocated) >= 0.9

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                expense,
                categoryUtilization: {
                    category: expense.category,
                    allocated: catAllocated,
                    spent: catSpent,
                    isWarning: isCategoryWarning
                }
            },
            "Expense claim approved successfully"
        )
    )
})

export const settleExpensePayment = asyncHandler(async (req, res) => {
    const { expenseId } = req.params
    const { settlementTransactionId } = req.body

    if (!settlementTransactionId?.trim()) {
        throw new ApiError(400, "Settlement transaction reference / UTR is required")
    }

    if (!["faculty", "principal", "admin"].includes(req.user.role)) {
        throw new ApiError(403, "Only faculty, principal, or admin can settle expense payments")
    }

    const expense = await Expense.findById(expenseId)
    if (!expense) {
        throw new ApiError(404, "Expense claim not found")
    }

    if (expense.approvalStatus !== "approved") {
        throw new ApiError(400, "Only approved expense claims can be marked as settled")
    }

    if (expense.paymentStatus === "paid") {
        throw new ApiError(400, "This expense claim has already been settled")
    }

    const existingTx = await Expense.findOne({ settlementTransactionId: settlementTransactionId.trim() })
    if (existingTx) {
        throw new ApiError(409, "Settlement reference ID already exists in the ledger")
    }

    expense.settlementTransactionId = settlementTransactionId.trim()
    expense.paymentStatus = "paid"
    expense.paidAt = new Date()
    await expense.save()

    return res.status(200).json(
        new ApiResponse(200, expense, "Expense payment settled successfully")
    )
})

export const getExpenseById = asyncHandler(async (req, res) => {
    const { expenseId } = req.params
    const expense = await Expense.findById(expenseId)
        .populate("coordinatorId", "name email department phonenumber")
        .populate("eventId", "title venue startDate budget")
        .populate("approvedBy", "name email role")

    if (!expense) {
        throw new ApiError(404, "Expense claim not found")
    }

    const ocrTotal = expense.invoiceDetails?.totalAmount || 0
    const hasOcr = expense.aiProcessingStatus === "completed" && ocrTotal > 0
    const discrepancy = hasOcr ? Math.abs(expense.requestedAmount - ocrTotal) : 0

    const responseData = {
        ...expense.toObject(),
        aiAnalysis: {
            hasOcr,
            ocrTotal,
            discrepancy,
            hasDiscrepancy: discrepancy > 5,
            confidence: expense.aiConfidence || 0
        }
    }

    return res.status(200).json(
        new ApiResponse(200, responseData, "Expense details fetched successfully")
    )
})