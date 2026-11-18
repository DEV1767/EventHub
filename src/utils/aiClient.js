import fs from "fs"
import path from "path"

const AI_BASE_URL = process.env.PYTHON_AI_URL || "http://127.0.0.1:8001"

export const uploadPdfToVectorStore = async (filePath, eventId, title = "", collegeName = "") => {
    const fileBuffer = fs.readFileSync(filePath)
    const fileName = path.basename(filePath)
    const blob = new Blob([fileBuffer], { type: "application/pdf" })

    const formData = new FormData()
    formData.append("file", blob, fileName)
    formData.append("event_id", String(eventId))
    formData.append("title", title || "")
    formData.append("college_name", collegeName || "")

    const response = await fetch(`${AI_BASE_URL}/api/documents/upload-pdf`, {
        method: "POST",
        body: formData
    })

    if (!response.ok) {
        const errText = await response.text()
        throw new Error(`AI Vector Store Error: ${errText}`)
    }

    return await response.json()
}

export const syncEventToVectorStore = async (event) => {
    const response = await fetch(`${AI_BASE_URL}/api/documents/sync-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            event_id: String(event._id || event.id),
            event: event
        })
    })

    if (!response.ok) {
        const errText = await response.text()
        throw new Error(`AI Sync Error: ${errText}`)
    }

    return await response.json()
}

export const askRag = async (eventId, query) => {
    const response = await fetch(`${AI_BASE_URL}/api/rag/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            event_id: String(eventId),
            query: query
        })
    })

    if (!response.ok) {
        const errText = await response.text()
        throw new Error(`RAG Error: ${errText}`)
    }

    return await response.json()
}

export const askOperationsAgent = async (eventId, query, threadId = "default_session") => {
    const response = await fetch(`${AI_BASE_URL}/api/agent/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            event_id: String(eventId),
            query: query,
            thread_id: threadId
        })
    })

    if (!response.ok) {
        const errText = await response.text()
        throw new Error(`Agent Error: ${errText}`)
    }

    return await response.json()
}
