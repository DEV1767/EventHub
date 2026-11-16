import mongoose from "mongoose"

const TeammemberSchema=new mongoose.Schema({
    userId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"User"
    },
    name:{
        type:String,
        required:true,
        trim:true
    },
    email:{
        type:String,
        required:true,
        lowercase:true,
        trim:true
    },
    phonenumber:{
        type:String,
        trim:true
    },
    collegeId:{
        type:String,
        trim:true,
        uppercase:true
    },
    department:{
        type:String,
        trim:true,
        uppercase:true
    }
},{_id:false})

const TeamSchema=new mongoose.Schema({
    eventId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"Event",
        required:true,
        index:true
    },
    teamName:{
       type:String,
       required:true,
       trim:true,
    },
    leaderId:{
     type:mongoose.Schema.Types.ObjectId,
     ref:"User",
     required:true
    },
    leaderIdCard: {
        url: {
            type: String,
            default: ""
        },
        public_id: {
            type: String,
            default: ""
        }
    },
    collegename:{
        type:String,
        required:true,
        lowercase:true,
        trim:true
    },
    members:[TeammemberSchema],
    paymentMethod: {
        type: String,
        enum: ["free", "razorpay", "manual_upi"],
        default: "free"
    },
    amountPaid: {
        type: Number,
        default: 0,
        min: 0
    },
    transactionId: {
        type: String,
        trim: true,
        set: (v) => (v && v.trim() ? v.trim() : undefined),
        validate: {
            validator: function (v) {
                if (!v) return true;
                if (this.paymentMethod === "manual_upi") {
                    return /^\d{12}$/.test(v);
                }
                return true;
            },
            message: "Manual UPI transaction reference must be a 12-digit number"
        }
    },
    paymentScreenshot: {
        url: {
            type: String,
            default: ""
        },
        public_id: {
            type: String,
            default: ""
        }
    },
    paymentStatus: {
        type: String,
        enum: ["not_required", "pending", "verified", "rejected"],
        default: "not_required"
    },
    verifiedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    },
    verifiedAt: {
        type: Date
    },
    rejectionReason: {
        type: String,
        trim: true,
        default: ""
    },
    registrationStatus: {
        type: String,
        enum: ["pending", "confirmed", "cancelled"],
        default: "confirmed"
    },
    registrationNumber: {
        type: String,
        trim: true
    },
    qrCode: {
        type: String,
        default: ""
    },
    checkedIn: {
        type: Boolean,
        default: false
    },
    checkedInAt: {
        type: Date
    },
    checkedInBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    },
    submissionDocument: {
        url: {
            type: String,
            default: ""
        },
        public_id: {
            type: String,
            default: ""
        },
        originalName: {
            type: String,
            default: ""
        },
        submittedAt: {
            type: Date
        }
    },
    submissionStatus: {
        type: String,
        enum: ["not_required", "pending", "shortlisted", "rejected"],
        default: "not_required"
    },
    submissionReview: {
        feedback: {
            type: String,
            default: ""
        },
        reviewedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User"
        },
        reviewedAt: {
            type: Date
        }
    },
    finalPayment: {
        amount: {
            type: Number,
            default: 0
        },
        transactionId: {
            type: String,
            trim: true
        },
        paymentScreenshot: {
            url: {
                type: String,
                default: ""
            },
            public_id: {
                type: String,
                default: ""
            }
        },
        status: {
            type: String,
            enum: ["not_required", "pending", "verified", "rejected"],
            default: "not_required"
        },
        verifiedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User"
        },
        verifiedAt: {
            type: Date
        }
    }
},{ timestamps: true })

TeamSchema.index({ eventId: 1, teamName: 1 }, { unique: true })
TeamSchema.index({ eventId: 1, leaderId: 1 }, { unique: true })
TeamSchema.index({ transactionId: 1 }, { unique: true, sparse: true })
TeamSchema.index({ eventId: 1, registrationStatus: 1 })
TeamSchema.index({ collegename: 1, paymentStatus: 1 })
export default mongoose.model("Team", TeamSchema)