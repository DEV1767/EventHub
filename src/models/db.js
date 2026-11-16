import mongoose from "mongoose"

let cached=global.mongoose|| {conn:null,promise:null}

export const connect_db=async()=>{
    const MONGO_URL=process.env.MONGO_URL

    if(!MONGO_URL) throw new Error("MONGO_URL is missing")
    
    if(cached.conn) return cached.conn
    if(!cached.promise){
        cached.promise=mongoose.connect(MONGO_URL,{
            serverSelectionTimeoutMS: 10000,
            bufferCommands: false,
        })
    }

    try {
        cached.conn = await cached.promise;
    } catch (error) {
        cached.promise = null;
        throw error;
    }
    global.mongoose = cached;
    console.log(" Database connected!");
    return cached.conn;

}