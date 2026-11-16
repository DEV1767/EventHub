import QRCode from "qrcode"
import crypto from "crypto"

export const generateRegistrationQR = async (teamId, registrationNumber, eventId) => {
    const secret = process.env.ACCESS_TOKEN_SECRET || "eventhub-qr-secret"
    const signature = crypto
        .createHmac("sha256", secret)
        .update(`${teamId}:${registrationNumber}:${eventId}`)
        .digest("hex")
        .slice(0, 16)

    const payload = JSON.stringify({
        tid: teamId.toString(),
        reg: registrationNumber,
        eid: eventId.toString(),
        sig: signature
    })

    return await QRCode.toDataURL(payload, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 320,
        color: {
            dark: "#000000",
            light: "#ffffff"
        }
    })
}

export const verifyQrPayload = (payloadString) => {
    try {
        let parsed = typeof payloadString === "string" ? JSON.parse(payloadString) : payloadString
        if (!parsed.tid || !parsed.reg || !parsed.eid || !parsed.sig) {
            return { isValid: false, data: null }
        }

        const secret = process.env.ACCESS_TOKEN_SECRET || "eventhub-qr-secret"
        const expectedSig = crypto
            .createHmac("sha256", secret)
            .update(`${parsed.tid}:${parsed.reg}:${parsed.eid}`)
            .digest("hex")
            .slice(0, 16)

        if (parsed.sig !== expectedSig) {
            return { isValid: false, data: null }
        }

        return { isValid: true, data: parsed }
    } catch {
        return { isValid: false, data: null }
    }
}

export default {
    generateRegistrationQR,
    verifyQrPayload
}
