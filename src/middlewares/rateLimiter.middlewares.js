import rateLimit from "express-rate-limit";
import { ApiError } from "../utils/apiHandler.js";

export const authRateLimiter = rateLimit({
    windowMs:15*60*1000,
    limit:100,
    standardHeaders:true,
    legacyHeaders:false,
    message:"Too many requests. Please try again after 15 minutes.",
    handler:(req,res,next,options)=>{
        next(new ApiError(options.statusCode,options.message))
    }
})

export const uploadRateLimiter=rateLimit({
    windowMs:15*60*1000,
    limit:30,
    standardHeaders:true,
    legacyHeaders:false,
    message:"Upload limit reached: Maximum 30 file uploads per 15 minutes. Please try again later.",
    handler: (req, res, next, options) => {
        next(new ApiError(options.statusCode, options.message))
    },
})
export default {authRateLimiter,uploadRateLimiter}