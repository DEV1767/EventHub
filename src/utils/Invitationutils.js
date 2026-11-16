
import crypto from "crypto"

const generateInvitationCode = () => {
    const invitationCode = crypto
        .randomBytes(8)
        .toString("hex")
        .toUpperCase()

    return invitationCode
}


const hashToken = (token) => {
    return crypto
        .createHash("sha256")
        .update(token)
        .digest("hex")
}

export { generateInvitationCode, hashToken }
