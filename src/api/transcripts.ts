/**
 * Transcripts API Routes
 *
 * Hono sub-app for /api/transcripts/*
 */
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import type { Context } from "hono"
import type { AuthVariables } from "@mentra/sdk"

import { UserSession } from "../app/session/UserSession"

const transcripts = new Hono<{ Variables: AuthVariables }>()

// ============ ROUTES ============
transcripts.get("/", getTranscriptsHandler)
transcripts.get("/latest", getLatestHandler)
transcripts.get("/stream", streamHandler)

export { transcripts }

// ============ HANDLERS ============

async function getTranscriptsHandler(c: Context<{ Variables: AuthVariables }>) {
  const userId = c.get("authUserId")
  if (!userId) {
    return c.json({ error: "Not authenticated" }, 401)
  }

  const userSession = UserSession.getUserSession(userId)
  if (!userSession) {
    return c.json({ error: "No active session" }, 404)
  }

  const allTranscripts = userSession.transcripts.getAll()
  return c.json({ transcripts: allTranscripts })
}

async function getLatestHandler(c: Context<{ Variables: AuthVariables }>) {
  const userId = c.get("authUserId")
  if (!userId) {
    return c.json({ error: "Not authenticated" }, 401)
  }

  const userSession = UserSession.getUserSession(userId)
  if (!userSession) {
    return c.json({ error: "No active session" }, 404)
  }

  const allTranscripts = userSession.transcripts.getAll()
  const latest = allTranscripts[allTranscripts.length - 1] || null

  return c.json({
    transcript: latest,
    updatedAt: new Date().toISOString(),
  })
}

const SSE_HEARTBEAT_INTERVAL_MS = 15000

async function streamHandler(c: Context<{ Variables: AuthVariables }>) {
  const userId = c.get("authUserId")

  console.log(`[SSE] /api/transcripts/stream request - userId: ${userId}`)

  if (!userId) {
    console.log("[SSE] Unauthorized - no userId")
    return c.text("Unauthorized", 401)
  }

  const userSession = UserSession.getUserSession(userId)
  console.log(`[SSE] UserSession lookup for ${userId}: ${userSession ? "FOUND" : "NOT FOUND"}`)

  if (!userSession) {
    console.log("[SSE] No active session for user")
    return c.text("No active session", 404)
  }

  // Use Hono's native SSE streaming
  return streamSSE(c, async (stream) => {
    const clientId = `${userId}-${Date.now()}`
    let isAlive = true

    // Send initial connection message
    await stream.writeSSE({ data: JSON.stringify({ type: "connected" }) })
    console.log(`[SSE] Client ${clientId} connected`)

    // Create SSE client for the transcript manager
    const client = {
      send: (data: unknown) => {
        if (!isAlive) return
        try {
          stream.writeSSE({ data: JSON.stringify(data) })
        } catch (err) {
          console.log(`[SSE] Client ${clientId} send error:`, err)
          isAlive = false
          userSession.transcripts.removeSSEClient(client)
        }
      },
    }

    // Register client
    userSession.transcripts.addSSEClient(client)
    console.log(`[SSE] SSE client registered. Total clients: ${userSession.transcripts["sseClients"].size}`)

    // Heartbeat loop
    const heartbeatLoop = async () => {
      while (isAlive) {
        try {
          await stream.writeSSE({
            data: JSON.stringify({ type: "heartbeat", timestamp: Date.now() }),
          })
          await Bun.sleep(SSE_HEARTBEAT_INTERVAL_MS)
        } catch {
          isAlive = false
          break
        }
      }
    }

    // Start heartbeat in background
    heartbeatLoop()

    // Wait for abort signal (client disconnect)
    stream.onAbort(() => {
      console.log(`[SSE] Connection closed for user ${userId}`)
      isAlive = false
      userSession.transcripts.removeSSEClient(client)
      console.log(`[SSE] Client removed. Remaining clients: ${userSession.transcripts["sseClients"].size}`)
    })
  })
}
