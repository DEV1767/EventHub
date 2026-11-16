import nodemailer from "nodemailer";
import {qstashClient}from "../config/qstash.js"

export const transporter=nodemailer.createTransport({
    service:"gmail",
    auth:{
        user:process.env.APP_EMAIL,
        pass:process.env.APP_EMAIL_PASSWORD
    }
})

export const sendDirectEmail=async({to,subject,html})=>{
    try{
        const info=await transporter.sendMail({
            from: `"EventHub Notifications" <${process.env.APP_EMAIL}>`,
            to,
            subject,
            html
        })
        return {success:true,messageId:info.messageId}
    }catch(error){
        console.log("Direct email delivery failed",error?.message)
        return {success:false,error:error?.message}
    }
}

export const dispatchNotificationWithFallback=async({to,subject,html,qstashPayload})=>{
    let queued=false
    if(process.env.QSTASH_TOKEN && process.env.APP_URL){
        try{
            await qstashClient.publishJSON({
                url:`${process.env.APP_URL}/api/v1/webhooks/notifications`,
                body:qstashPayload||{to,subject,html}
            })
            queued=true
        }catch(queueErr){
            console.warn("Qstash queue unavailable.Triggering direct SMTP fallback....")
        }
    }
    if(!queued){
         sendDirectEmail({ to, subject, html }).catch(err => {
            console.error("Fallback email failed:", err?.message)
        })
    }
}

export default{
    transporter,
    sendDirectEmail,
    dispatchNotificationWithFallback
}