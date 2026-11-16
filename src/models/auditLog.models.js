import mongoose from "mongoose"

const AuditLogSchema = new mongoose.Schema({
    method: {
        type: String,
        required: true,
        uppercase: true,
        trim: true,
        index: true
    },
    url: {
        type: String,
        required: true,
        trim: true,
        index: true
    },
    statusCode: {
        type: Number,
        required: true,
        index: true
    },
    durationMs: {
        type: Number,
        required: true
    },
    ip: {
        type: String,
        trim: true,
        default: ""
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        index: true
    },
    userEmail: {
        type: String,
        trim: true,
        lowercase: true,
        default: ""
    },
    userRole: {
        type: String,
        trim: true,
        default: "anonymous",
        index: true
    },
    collegename: {
        type: String,
        trim: true,
        lowercase: true,
        default: ""
    },
    userAgent: {
        type: String,
        trim: true,
        default: ""
    },
    isError: {
        type: Boolean,
        default: false,
        index: true
    },
    errorMessage: {
        type: String,
        trim: true,
        default: ""
    },
    errorStack: {
        type: String,
        default: ""
    },
    requestQuery: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    requestBody: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    }
}, { timestamps: true })

AuditLogSchema.index({ createdAt: -1 })
AuditLogSchema.index({ isError: 1, createdAt: -1 })
AuditLogSchema.index({ statusCode: 1, createdAt: -1 })
AuditLogSchema.index({ method: 1, url: 1 })
AuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 })

export default mongoose.model("AuditLog", AuditLogSchema)
