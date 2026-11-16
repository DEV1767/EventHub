import jwt from "jsonwebtoken"
import crypto from "crypto"
import User from "../models/user.models.js"
import Coordinator from "../models/coordinator.models.js"
import {hashToken} from "../utils/Invitationutils.js"
import { ApiError, ApiResponse } from "../utils/apiHandler.js"
import asyncHandler from "../utils/asyncHandler.js"
import { deletFromCloudinary, uploadOnCloudinary } from "../utils/cloudinary.js"
import { getCache, setCache, deleteCache } from "../utils/redis.helpers.js"
import { dispatchNotificationWithFallback } from "../utils/email.js"
import {
     SendOtpSchema,
     RegisterUserSchema,
     LoginUserSchema,
     UpdateUserProfileSchema,
     changePasswordSchema,
     forgotPasswordSchema,
     resetPasswordSchema,
     coordinatorOnboardSchema 
 } from "../validators/joi.validators.js"



const cookiesOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict"
}

const encryptAccountNumber=(accountNumber)=>{
    const key=crypto.createHash("sha256").update(process.env.ACCESS_TOKEN_SECRET).digest()
    const iv=crypto.randomBytes(12)
    const cipher=crypto.createCipheriv("aes-256-gcm",key,iv)
    let encrypted=cipher.update(accountNumber,"utf-8","hex")
    encrypted+=cipher.final("hex")
    const authTag=cipher.getAuthTag().toString("hex")
    return `${iv.toString("hex")}:${authTag}:${encrypted}`
}


export const sendRegistrationOTP = asyncHandler(async (req, res) => {
    const { error, value } = SendOtpSchema.validate(req.body)
    if (error) {
        throw new ApiError(400, error.details[0].message)
    }

    const { email } = value

    const existingUser = await User.findOne({ email })
    if (existingUser) {
        throw new ApiError(409, "User with this email already exists")
    }

    const otp = crypto.randomInt(100000, 999999).toString()

    await setCache(`otp:${email}`, otp, 300)

    dispatchNotificationWithFallback({
        to: email,
        subject: "EventHub Registration Verification OTP",
        html: `
            <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                <h2 style="color: #4CAF50;">Verify Your Email</h2>
                <p>Your one-time verification code for EventHub registration is:</p>
                <h1 style="color: #4CAF50; letter-spacing: 6px; font-size: 32px;">${otp}</h1>
                <p>This code will expire in <strong>5 minutes</strong>. If you did not request this, please ignore this email.</p>
                <br/>
                <p>Best regards,<br/>EventHub Security Team</p>
            </div>
        `,
        qstashPayload: {
            type: "OTP_SENT",
            data: { email, otp }
        }
    })

    return res.status(200).json(
        new ApiResponse(200, {}, "Verification OTP sent to your email successfully")
    )
})

export const registerUser = asyncHandler(async (req, res) => {
    const { error, value } = RegisterUserSchema.validate(req.body)
    if (error) {
        throw new ApiError(400, error.details[0].message)
    }

    const { name, email, phonenumber, collegename, password, role, department, otp } = value

    const cachedOtp = await getCache(`otp:${email}`)
    if (!cachedOtp) {
        throw new ApiError(400, "OTP has expired or was not requested. Please request a new OTP.")
    }

    if (String(cachedOtp) !== String(otp).trim()) {
        throw new ApiError(400, "Invalid OTP. Please check and try again.")
    }

    const existingUser = await User.findOne({
        $or: [{ email }, { phonenumber }]
    })

    if (existingUser) {
        throw new ApiError(409, "User with this email or phone number already exists.")
    }

    const user = await User.create({
        name,
        email,
        phonenumber,
        collegename,
        password,
        role: role || "student",
        department: department || "",
        isVerified: true
    })

    await deleteCache(`otp:${email}`)

    const createdUser = await User.findById(user._id).select("-password -refreshToken")

    return res.status(201).json(
        new ApiResponse(201, createdUser, "User registered successfully")
    )
})

export const loginUser = asyncHandler(async (req, res) => {
    const { error, value } = LoginUserSchema.validate(req.body)
    if (error) {
        throw new ApiError(400, error.details[0].message)
    }

    const { email, password } = value
    const user = await User.findOne({ email }).select("+password")
    if (!user) {
        throw new ApiError(401, "Invalid email or password")
    }

    const isPasswordValid = await user.isPasswordCorrect(password)
    if (!isPasswordValid) {
        throw new ApiError(401, "Invalid email or password")
    }

    if (user.accountStatus !== "active") {
        throw new ApiError(403, "Account is inactive or suspended")
    }

    const accessToken = user.generateAccessToken()
    const refreshToken = user.generateRefreshToken()

    user.refreshToken = refreshToken
    await user.save({ validateBeforeSave: false })

    const loggedInUser = await User.findById(user._id).select("-password -refreshToken")

    return res
        .status(200)
        .cookie("accessToken", accessToken, cookiesOptions)
        .cookie("refreshToken", refreshToken, cookiesOptions)
        .json(
            new ApiResponse(
                200,
                {
                    user: loggedInUser,
                    accessToken,
                    refreshToken
                },
                "User logged in successfully"
            )
        )
})

export const logoutUser = asyncHandler(async (req, res) => {
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $unset: { refreshToken: 1 }
        },
        { new: true }
    )

    return res
        .status(200)
        .clearCookie("accessToken", cookiesOptions)
        .clearCookie("refreshToken", cookiesOptions)
        .json(new ApiResponse(200, {}, "User logged out successfully"))
})

export const refreshAccessToken = asyncHandler(async (req, res) => {
    const incomingRefreshToken = req.cookies?.refreshToken || req.body?.refreshToken
    if (!incomingRefreshToken) {
        throw new ApiError(401, "Refresh token is missing")
    }

    try {
        const decodedToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET)
        const user = await User.findById(decodedToken?._id).select("+refreshToken")
        if (!user) {
            throw new ApiError(401, "Invalid refresh token")
        }

        if (incomingRefreshToken !== user.refreshToken) {
            throw new ApiError(401, "Refresh token is expired or used")
        }

        const newAccessToken = user.generateAccessToken()
        const newRefreshToken = user.generateRefreshToken()

        user.refreshToken = newRefreshToken
        await user.save({ validateBeforeSave: false })

        return res
            .status(200)
            .cookie("accessToken", newAccessToken, cookiesOptions)
            .cookie("refreshToken", newRefreshToken, cookiesOptions)
            .json(
                new ApiResponse(
                    200,
                    {
                        accessToken: newAccessToken,
                        refreshToken: newRefreshToken
                    },
                    "Access token refreshed successfully"
                )
            )
    } catch (error) {
        throw new ApiError(401, error?.message || "Invalid refresh token")
    }
})

export const getCurrentUser = asyncHandler(async (req, res) => {
    return res.status(200).json(
        new ApiResponse(200, req.user, "Current user fetched successfully")
    )
})

export const updateUserProfile=asyncHandler(async(req,res)=>{
    const { error, value } = UpdateUserProfileSchema.validate(req.body)
    if (error) {
        throw new ApiError(400, error.details[0].message)
    }
    const { name, department, phonenumber } = value

    const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000
    let updateFields = {}

    if (name && name.trim() !== req.user.name) {
        if (req.user.lastNameUpdateAt) {
            const timeDiff = Date.now() - new Date(req.user.lastNameUpdateAt).getTime()
            if (timeDiff < FOURTEEN_DAYS_MS) {
                const daysLeft = Math.ceil((FOURTEEN_DAYS_MS - timeDiff) / (24 * 60 * 60 * 1000))
                throw new ApiError(400, `You can only update your name once every 14 days. You can update it again in ${daysLeft} day(s).`)
            }
        }
        updateFields.name = name.trim()
        updateFields.lastNameUpdateAt = new Date()
    }

    if (department !== undefined) {
        updateFields.department = department
    }

    if (phonenumber) {
        const existingUser = await User.findOne({
            phonenumber,
            _id: { $ne: req.user._id }
        })

        if (existingUser) {
            throw new ApiError(409, "Phone number is already in use by another user")
        }
        updateFields.phonenumber = phonenumber
    }

    const updatedUser=await User.findByIdAndUpdate(
        req.user._id,
        {
            $set: updateFields
        },
        {new:true,runValidators:true}
    ).select("-password -refreshToken")

    return res.status(200).json(
        new ApiResponse(200,updatedUser,"Profile updated successfully")
    )
})

export const updateProfilePicture=asyncHandler(async(req,res)=>{
    const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000
    if (req.user.lastProfilePictureUpdateAt) {
        const timeDiff = Date.now() - new Date(req.user.lastProfilePictureUpdateAt).getTime()
        if (timeDiff < FOURTEEN_DAYS_MS) {
            const daysLeft = Math.ceil((FOURTEEN_DAYS_MS - timeDiff) / (24 * 60 * 60 * 1000))
            throw new ApiError(400, `You can only update your profile picture once every 14 days. You can update it again in ${daysLeft} day(s).`)
        }
    }

    const profilePictureLocalPath=req.file?.path
    if(!profilePictureLocalPath){
        throw new ApiError(400,"Profile picture file is missing")
    }

    const uploadedImage = await uploadOnCloudinary(profilePictureLocalPath, "eventhub/avatars")

    if(!uploadedImage?.url){
        throw new ApiError(500,"Failed to upload profile picture")
    }

    const user=await  User.findById(req.user._id)
    if(!user){
        throw new ApiError(404,"User not found")
    }
    
    if(user.profilePicture?.public_id){
        await deletFromCloudinary(user.profilePicture.public_id)
    }

    user.profilePicture={
        url:uploadedImage.url,
        public_id:uploadedImage.public_id
    }
    user.lastProfilePictureUpdateAt = new Date()

    await user.save({validateBeforeSave:false})

    const updateUser=await User.findById(user._id).select("-password -refreshToken")
    return res.status(200).json(
        new ApiResponse(200,updateUser,"Profile picture updated successfully")
    )
})

export const changeCurrentPassword = asyncHandler(async (req, res) => {
    const { error, value } = changePasswordSchema.validate(req.body)
    if (error) {
        throw new ApiError(400, error.details[0].message)
    }
    const { oldPassword, newPassword } = value
    const user = await User.findById(req.user._id).select("+password")
    if (!user) {
        throw new ApiError(404, "User not found")
    }

    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword)
    if (!isPasswordCorrect) {
        throw new ApiError(400, "Invalid old password")
    }
    user.password = newPassword
    await user.save()
    return res.status(200).json(
        new ApiResponse(200, {}, "Password changed successfully")
    )
})

export const forgotPassword = asyncHandler(async (req, res) => {
    const { error, value } = forgotPasswordSchema.validate(req.body)
    if (error) {
        throw new ApiError(400, error.details[0].message)
    }
    const { email } = value
    const user = await User.findOne({ email })
    if (!user) {
        throw new ApiError(404, "User with this email does not exist")
    }
    const resetToken = user.generateTemporaryToken()
    await user.save({ validateBeforeSave: false })
    return res.status(200).json(
        new ApiResponse(
            200,
            { resetToken },
            "Password reset token generated successfully"
        )
    )
})

export const resetPassword = asyncHandler(async (req, res) => {
    const { token } = req.params
    if (!token) {
        throw new ApiError(400, "Reset token is missing from URL parameter")
    }

    const { error, value } = resetPasswordSchema.validate(req.body)
    if (error) {
        throw new ApiError(400, error.details[0].message)
    }
    const { password } = value
    const hashedToken = crypto
        .createHash("sha256")
        .update(token)
        .digest("hex")

    const user = await User.findOne({
        resetPasswordToken: hashedToken,
        resetPasswordExpiry: { $gt: Date.now() }
    })

    if (!user) {
        throw new ApiError(400, "Token is invalid or has expired")
    }

    user.password = password
    user.resetPasswordToken = undefined
    user.resetPasswordExpiry = undefined
    await user.save()

    return res.status(200).json(
        new ApiResponse(200, {}, "Password has been reset successfully")
    )
})

export const onboardCoordinator = asyncHandler(async (req, res) => {
    const { error, value } = coordinatorOnboardSchema.validate(req.body)
    if (error) {
        throw new ApiError(400, error.details[0].message)
    }

    const { eventId, invitationCode, bankDetails } = value
    const coordinatorInvite = await Coordinator.findOne({
        eventId,
        userId: req.user._id,
        invitationStatus: "pending"
    }).select("+invitationCode")

    if (!coordinatorInvite) {
        throw new ApiError(404, "No pending coordinator invitation found for this event")
    }
    if (coordinatorInvite.invitationExpiry && coordinatorInvite.invitationExpiry < new Date()) {
        coordinatorInvite.invitationStatus = "revoked"
        await coordinatorInvite.save()
        throw new ApiError(400, "Invitation has expired")
    }

    if (coordinatorInvite.attempts >= 5) {
        coordinatorInvite.invitationStatus = "revoked"
        await coordinatorInvite.save()
        throw new ApiError(403, "Maximum verification attempts exceeded. Invitation revoked.")
    }

    const hashedInputCode = hashToken(invitationCode)
    if (coordinatorInvite.invitationCode !== hashedInputCode && coordinatorInvite.invitationCode !== invitationCode) {
        coordinatorInvite.attempts += 1
        await coordinatorInvite.save()
        throw new ApiError(400, "Invalid invitation code")
    }

    const encryptedAccountNumber = encryptAccountNumber(bankDetails.accountNumber)
    const user = await User.findById(req.user._id)
    user.bankDetails = {
        accountHolderName: bankDetails.accountHolderName,
        accountNumber: encryptedAccountNumber,
        ifscCode: bankDetails.ifscCode,
        bankName: bankDetails.bankName,
        upiId: bankDetails.upiId || "",
        isVerified: true
    }
    await user.save({ validateBeforeSave: false })

    coordinatorInvite.invitationStatus = "accepted"
    coordinatorInvite.acceptedAt = new Date()
    await coordinatorInvite.save()

    return res.status(200).json(
        new ApiResponse(200, {}, "Coordinator onboarded and verified successfully")
    )
})