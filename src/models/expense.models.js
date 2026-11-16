
import mongoose from "mongoose"

const ExpenseSchema = new mongoose.Schema({

    eventId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Event",
        required: true,
        index: true
    },
    coordinatorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    facultyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    collegename: {
        type: String,
        required: true,
        lowercase: true,
        trim: true
    },
    title: {
        type: String,
        required: true,
        trim: true
    },
    assignedApproverRole: {
        type: String,
        enum: ["faculty", "principal"],
        default: "faculty",
        required: true
    },
    category: {
        type: String,
        enum: ["Food", "Refreshments", "Printing", "Decoration", "Marketing", "Logistics", "Equipment", "Hardware", "Transportation", "Prizes", "Miscellaneous", "Other"],
        default: "Other",
        required: true
    },
    otherCategoryDetails: {
        type: String,
        trim: true,
        default: ""
    },
    categoryId: {
        type: mongoose.Schema.Types.ObjectId
    },
    bill: {

        url: {
            type: String,
            required: true
        },

        public_id: {
            type: String,
            required: true
        },

        fileType: {
            type: String,
            enum: ["image", "pdf"],
            required: true
        }

    },
    invoiceDetails: {

        vendorName: {
            type: String,
            trim: true
        },

        invoiceNumber: {
            type: String,
            trim: true
        },

        invoiceDate: Date,

        items: [{

            name: String,

            quantity: Number,

            price: Number,

            amount: Number

        }],

        subtotal: Number,

        gst: Number,

        totalAmount: Number,

        currency: {
            type: String,
            default: "INR"
        }

    },
    requestedAmount: {
        type: Number,
        required: true,
        min: 0
    },

    approvedAmount: {
        type: Number,
        min: 0
    },

    aiProcessingStatus: {
        type: String,
        enum: ["pending", "processing", "completed", "failed"],
        default: "pending"
    },
    aiConfidence: {
        type: Number,
        min: 0,
        max: 1
    },
    approvalStatus: {
        type: String,
        enum: ["pending", "approved", "rejected"],
        default: "pending"
    },

    rejectionReason: {
        type: String,
        trim: true
    },

    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    },

    approvedAt: Date,
    paymentStatus: {
        type: String,
        enum: ["not_paid", "processing", "paid"],
        default: "not_paid"
    },

    paidAt: Date,

    coordinatorUpiId: {
        type: String,
        trim: true
    },

    settlementTransactionId: {
        type: String,
        trim: true
    }

}, { timestamps: true })

ExpenseSchema.index({ eventId: 1, approvalStatus: 1 })
ExpenseSchema.index({ collegename: 1, assignedApproverRole: 1, approvalStatus: 1 })
ExpenseSchema.index({ settlementTransactionId: 1 }, { unique: true, sparse: true })

export default mongoose.model("Expense", ExpenseSchema)
