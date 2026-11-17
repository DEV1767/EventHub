import mongoose from "mongoose"


const BudgetCategorySchema = new mongoose.Schema({
    name: {
        type: String,
        enum: ["Food", "Refreshments", "Printing", "Decoration", "Marketing", "Logistics", "Equipment", "Hardware", "Transportation", "Prizes", "Miscellaneous", "Other"],
        required: true
    },
    otherCategoryDetails: {
        type: String,
        trim: true,
        default: ""
    },
    allocatedAmount: {
        type: Number,
        default: 0,
        min: 0
    },
    spentAmount: {
        type: Number,
        default: 0,
        min: 0
    }
}, { _id: false })


const EventSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },

    description: {
        type: String,
        required: true,
        trim: true
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

    department: {
        type: String,
        trim: true,
        uppercase: true,
        default: "OTHER"
    },

    tags: [{
        type: String,
        trim: true
    }],

    banner: {
        url: {
            type: String,
            default: ""
        },
        public_id: {
            type: String,
            default: ""
        }
    },

    advertisementBanner: {
        url: {
            type: String,
            default: ""
        },
        public_id: {
            type: String,
            default: ""
        },
        redirectUrl: {
            type: String,
            trim: true,
            default: ""
        }
    },

    collegename: {
        type: String,
        required: true,
        lowercase: true,
        trim: true,
        index: true
    },

    organizingDepartment: {
        type: String,
        trim: true,
        default: ""
    },

    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    contactEmail: {
        type: String,
        trim: true,
        lowercase: true
    },

    contactPhone: {
        type: String,
        trim: true
    },

    venue: {
        type: String,
        required: true,
        trim: true
    },

    startDate: {
        type: Date,
        required: true
    },

    endDate: {
        type: Date,
        required: true
    },

    registrationStartDate: {
        type: Date,
        default: Date.now
    },

    registrationEndDate: {
        type: Date,
        required: true
    },

    participationType: {
        type: String,
        enum: ["Individual", "Team"],
        default: "Individual"
    },

    teamSize: {
        min: {
            type: Number,
            default: 1,
            min: 1
        },
        max: {
            type: Number,
            default: 1,
            min: 1
        }
    },

    maxParticipants: {
        type: Number,
        required: true,
        min: 1
    },

    registeredCount: {
        type: Number,
        default: 0,
        min: 0
    },

    registrationFee: {
        type: Number,
        default: 0,
        min: 0
    },

    registrationStatus: {
        type: String,
        enum: ["Upcoming", "Open", "Closed"],
        default: "Upcoming"
    },

    eligibility: {
        type: String,
        trim: true,
        default: "Open to all students"
    },

    registrationInstructions: {
        type: String,
        trim: true,
        default: ""
    },

    budget: {
        totalAllocated: {
            type: Number,
            default: 0,
            min: 0
        },
        totalSpent: {
            type: Number,
            default: 0,
            min: 0
        },
        categories: [BudgetCategorySchema]
    },

    coordinators: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    }],

    status: {
        type: String,
        enum: ["Draft", "Upcoming", "Ongoing", "Completed", "Cancelled"],
        default: "Draft"
    },

    isPublished: {
        type: Boolean,
        default: false
    },

    rules: [{
        type: String,
        trim: true
    }],

    rulesVisible: {
        type: Boolean,
        default: true
    },

    termsAndConditions: {
        type: String,
        trim: true,
        default: ""
    },

    certificate: {
        isProvided: {
            type: Boolean,
            default: true
        },
        type: {
            type: String,
            enum: ["Participation", "Merit", "Appreciation", "None"],
            default: "Participation"
        }
    },

    isAiChatEnabled: {
        type: Boolean,
        default: false
    },

    isMealDistributionEnabled: {
        type: Boolean,
        default: true
    },

    foodSlots: [{
        slotId: {
            type: String,
            required: true,
            trim: true
        },
        name: {
            type: String,
            required: true,
            trim: true
        },
        startTime: {
            type: String,
            required: true,
            trim: true
        },
        endTime: {
            type: String,
            required: true,
            trim: true
        },
        isActive: {
            type: Boolean,
            default: true
        }
    }],

    submissionSettings: {
        isRequired: {
            type: Boolean,
            default: false
        },
        facultyNote: {
            type: String,
            trim: true,
            default: ""
        },
        maxSizeMB: {
            type: Number,
            default: 15
        },
        initialRegistrationFee: {
            type: Number,
            default: 0,
            min: 0
        },
        finalParticipationFee: {
            type: Number,
            default: 0,
            min: 0
        },
        demoDocument: {
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
            }
        }
    }

}, { timestamps: true })



EventSchema.index({ collegename: 1, status: 1, startDate: 1 })
EventSchema.index({ createdBy: 1 })
EventSchema.index({ isPublished: 1, registrationStatus: 1 })

export default mongoose.model("Event", EventSchema)
