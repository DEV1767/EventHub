
import mongoose from "mongoose"

const CoordinatorSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    facultyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    eventId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Event",
        required: true
    },
    collegename: {
        type: String,
        lowercase: true,
        trim: true
    },
    invitationCode: {
        type: String,
        select: false
    },

    invitationExpiry: {
        type: Date
    },
    attempts: {
        type: Number,
        default: 0
    },
    invitationStatus: {
        type: String,
        enum: ["pending", "accepted", "rejected", "revoked"],
        default: "pending"
    },

    acceptedAt: Date

}, { timestamps: true })


CoordinatorSchema.index(
    { userId: 1, eventId: 1 },
    { unique: true }
)


export default mongoose.model("Coordinator", CoordinatorSchema)
