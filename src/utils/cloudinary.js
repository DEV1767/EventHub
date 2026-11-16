import {v2 as cloudinary} from "cloudinary"
import fs from "fs"

cloudinary.config({
    cloud_name:process.env.CLOUDINARY_CLOUD_NAME,
    api_key:process.env.CLOUDINARY_API_KEY,
    api_secret:process.env.CLOUDINARY_API_SECRET
})


export const uploadOnCloudinary=async(localFieldPath,folder="eventhub")=>{
    try{
        if(!localFieldPath) return null

        const responce=await cloudinary.uploader.upload(localFieldPath,{
            resource_type:"auto",
            folder
        })

        if (fs.existsSync(localFieldPath)){
            fs.unlinkSync(localFieldPath)
        }

        return {
            url:responce.secure_url,
            public_id:responce.public_id
        }
    }catch(error){
        if(localFieldPath && fs.existsSync(localFieldPath)){
            fs.unlinkSync(localFieldPath)
        }
        return null
    }
}

export const deletFromCloudinary=async(publicId,resource_type="image")=>{
    try{
        if(!publicId) return null
        return await cloudinary.uploader.destroy(publicId,{resource_type:resource_type})
    }catch(error){
        return null
    }
}

export default{
    uploadOnCloudinary,
    deletFromCloudinary
}