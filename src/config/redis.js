import {createClient} from "redis"

const redisClient=createClient({
    url:process.env.REDIS_URL,
    socket:{
        reconnectStrategy:(retries)=>{
            if(retries>10){
               return new Error("Redis connection retry limit reached")
            }
            return Math.min(retries*100,3000)
        }
    }
})


redisClient.on("error",(err)=>{
    console.log("Redis error:",err.message)
})

redisClient.on("connect",()=>{
    console.log("Redis connected")
})

redisClient.on("ready",()=>{
    console.log("Redis is ready to use")
})

export const ConnectRedis=async()=>{
    if(!redisClient.isOpen){
        await redisClient.connect()
    }
    return redisClient
}


export default redisClient
