
import mongoose from "mongoose"
import bcrypt from "bcrypt"
import jwt from "jsonwebtoken"
import crypto from "crypto"

const Userschema = new mongoose.Schema({

    name: {
        type: String,
        required: true,
        trim: true
    },

    email: {
        type: String,
        unique: true,
        required: true,
        lowercase: true,
        trim: true
    },

    collegename: {
        type: String,
        required: true,
        trim: true
    },

    phonenumber: {
        type: String,
        unique: true,
        required: true,
        trim: true
    },

    password: {
        type: String,
        required: true,
        select: false
    },

    role: {
        type: String,
        enum: ["student", "faculty", "principal", "admin"],
        default: "student",
        required: true
    },

    department: {
        type: String,
        trim: true
    },
    profilePicture: {
        url: {
            type: String,
            default: ""
        },
        public_id: {
            type: String,
            default: ""
        }
    },
    idCard: {
        url: {
            type: String,
            default: ""
        },
        public_id: {
            type: String,
            default: ""
        }
    },
    bankDetails: {

        accountHolderName: {
            type: String,
            trim: true,
            select: false
        },

        accountNumber: {
            type: String,
            select: false
        },

        ifscCode: {
            type: String,
            uppercase: true,
            trim: true,
            select: false
        },

        bankName: {
            type: String,
            trim: true,
            select: false
        },

        branchName: {
            type: String,
            trim: true,
            select: false
        },

        accountType: {
            type: String,
            enum: ["savings", "current"],
            select: false
        },

        upiId: {
            type: String,
            lowercase: true,
            trim: true,
            select: false
        },

        isVerified: {
            type: Boolean,
            default: false
        }

    },
    isVerified: {
        type: Boolean,
        default: false
    },
    lastNameUpdateAt: {
        type: Date
    },
    lastProfilePictureUpdateAt: {
        type: Date
    },
    accountStatus: {
        type: String,
        enum: ["active", "inactive", "suspended"],
        default: "active"
    },
    refreshToken: {
        type: String,
        select: false
    },

    resetPasswordToken: {
        type: String,
        select: false
    },

    resetPasswordExpiry: {
        type: Date,
        select: false
    }

}, { timestamps: true })



Userschema.pre("save", async function () {

    if (!this.isModified("password")) return

    this.password = await bcrypt.hash(this.password, 10)

})



Userschema.methods.isPasswordCorrect = async function (password) {

    return await bcrypt.compare(password, this.password)

}



Userschema.methods.generateAccessToken = function () {

    return jwt.sign(
        {
            _id: this._id,
            email: this.email,
            role: this.role
        },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: process.env.ACCESS_TOKEN_EXPIRY }
    )

}



Userschema.methods.generateRefreshToken = function () {

    return jwt.sign(
        {
            _id: this._id,
            email: this.email
        },
        process.env.REFRESH_TOKEN_SECRET,
        { expiresIn: process.env.REFRESH_TOKEN_EXPIRY }
    )

}



Userschema.methods.generateTemporaryToken = function () {

    const unHashedToken = crypto.randomBytes(20).toString("hex")

    const hashedToken = crypto
        .createHash("sha256")
        .update(unHashedToken)
        .digest("hex")

    this.resetPasswordToken = hashedToken

    this.resetPasswordExpiry = new Date(Date.now() + (20 * 60 * 1000))

    return unHashedToken

}


export default mongoose.model("User", Userschema)