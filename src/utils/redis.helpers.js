import redisClient from "../config/redis.js"

export const setCache = async (key, value, ttlInSeconds = null) => {
    try {
        const stringValue = typeof value === "object" ? JSON.stringify(value) : String(value)
        if (ttlInSeconds) {
            return await redisClient.set(key, stringValue, { EX: ttlInSeconds })
        }
        return await redisClient.set(key, stringValue)
    } catch {
        return null
    }
}

export const getCache = async (key) => {
    try {
        const data = await redisClient.get(key)
        if (!data) return null
        try {
            return JSON.parse(data)
        } catch {
            return data
        }
    } catch {
        return null
    }
}

export const deleteCache = async (key) => {
    try {
        return await redisClient.del(key)
    } catch {
        return null
    }
}

export const checkCacheExists = async (key) => {
    try {
        const exists = await redisClient.exists(key)
        return exists === 1
    } catch {
        return false
    }
}

export default {
    setCache,
    getCache,
    deleteCache,
    checkCacheExists
}
