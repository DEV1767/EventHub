import joi from "joi"


const phoneRegex = /^\+?[0-9]{10,15}$/
const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/
const upiRegex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/
const objectIdRegex = /^[0-9a-fA-F]{24}$/

export const SendOtpSchema = joi.object({
    email: joi.string().trim().lowercase().email().required()
})

export const RegisterUserSchema = joi.object({
    name: joi.string().trim().min(2).max(50).required(),
    email: joi.string().trim().lowercase().email().required(),
    phonenumber: joi.string().trim().pattern(phoneRegex).required(),
    collegename: joi.string().min(2).max(100).trim().lowercase().required(),
    password: joi.string().trim().min(6).max(64).required(),
    role: joi.string().valid("student", "faculty", "principal", "admin").default("student"),
    department: joi.string().trim().max(50).allow("").optional(),
    otp: joi.string().trim().length(6).pattern(/^[0-9]{6}$/).required()
})

export const LoginUserSchema = joi.object({
    email: joi.string().trim().lowercase().email().required(),
    password: joi.string().required()
})

export const UpdateUserProfileSchema = joi.object({
    name: joi.string().trim().min(2).max(50),
    department: joi.string().trim().max(50).allow(""),
    phonenumber: joi.string().trim().pattern(phoneRegex)
}).min(1)

export const changePasswordSchema = joi.object({
    oldPassword: joi.string().required(),
    newPassword: joi.string().trim().min(6).max(64).invalid(joi.ref("oldPassword")).required()
})

export const forgotPasswordSchema = joi.object({
    email: joi.string().trim().lowercase().email().required()
})

export const resetPasswordSchema = joi.object({
    password: joi.string().min(6).max(64).required()
})

export const coordinatorOnboardSchema = joi.object({
    eventId: joi.string().trim().pattern(objectIdRegex).required(),
    invitationCode: joi.string().trim().required(),
    bankDetails: joi.object({
        accountHolderName: joi.string().trim().min(2).max(100).required(),
        accountNumber: joi.string().trim().pattern(/^[0-9]{9,18}$/).required(),
        ifscCode: joi.string().trim().uppercase().pattern(ifscRegex).required(),
        bankName: joi.string().trim().min(2).max(100).required(),
        upiId: joi.string().trim().lowercase().pattern(upiRegex).allow("").optional()
    }).required()
})

export const createEventSchema = joi.object({
    title: joi.string().trim().min(3).max(100).required(),

    description: joi.string().trim().min(10).required(),

    category: joi.string()
        .valid("Technical", "Cultural", "Sports", "Workshop", "Hackathon", "Seminar", "Other")
        .required(),

    otherCategoryDetails: joi.when("category", {
        is: "Other",
        then: joi.string().trim().min(3).required(),
        otherwise: joi.forbidden()
    }),

    department: joi.string().trim().min(2).max(50).required(),

    venue: joi.string().trim().min(2).max(150).required(),

    startDate: joi.date().required(),

    endDate: joi.date()
        .greater(joi.ref("startDate"))
        .required(),

    registrationStartDate: joi.date()
        .default(() => new Date()),

    registrationEndDate: joi.date()
        .greater(joi.ref("registrationStartDate"))
        .less(joi.ref("startDate"))
        .required(),

    participationType: joi.string()
        .valid("Individual", "Team")
        .required(),

    minTeamSize: joi.when("participationType", {
        is: "Team",
        then: joi.number().integer().min(2).required(),
        otherwise: joi.forbidden()
    }),

    maxTeamSize: joi.when("participationType", {
        is: "Team",
        then: joi.number().integer()
            .min(joi.ref("minTeamSize"))
            .required(),
        otherwise: joi.forbidden()
    }),

    maxParticipants: joi.number().integer().min(1).required(),

    registrationFee: joi.number().min(0).default(0),

    rules: joi.alternatives().try(
        joi.array().items(joi.string().trim().min(1)).min(1),
        joi.string().trim().min(1)
    ).required(),

    termsAndConditions: joi.alternatives().try(
        joi.array().items(joi.string().trim()),
        joi.string().trim()
    ).optional(),

    budget: joi.alternatives().try(
        joi.number().min(0),
        joi.object(),
        joi.string()
    ).required(),

    submissionSettings: joi.alternatives().try(
        joi.object({
            isRequired: joi.boolean().default(false),
            facultyNote: joi.string().trim().allow("").default(""),
            maxSizeMB: joi.number().min(1).max(50).default(15),
            initialRegistrationFee: joi.number().min(0).default(0),
            finalParticipationFee: joi.number().min(0).default(0)
        }),
        joi.string()
    ).optional()
})


export default {
    RegisterUserSchema,
    LoginUserSchema,
    UpdateUserProfileSchema,
    changePasswordSchema,
    resetPasswordSchema,
    forgotPasswordSchema,
    coordinatorOnboardSchema
}
