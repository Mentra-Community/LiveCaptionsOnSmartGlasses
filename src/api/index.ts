/**
 * API Router
 *
 * Main Hono router that mounts all API sub-apps.
 * Mount this on the AppServer with: app.route("/", api)
 */
import { Hono } from "hono"
import type { Context } from "hono"
import type { AuthVariables } from "@mentra/sdk"

import { transcripts } from "./transcripts"
import { settings } from "./settings"

const api = new Hono<{ Variables: AuthVariables }>()

// ============ MOUNT SUB-APPS ============
api.route("/api/transcripts", transcripts)
api.route("/api/settings", settings)

// ============ STANDALONE ROUTES ============
api.get("/api/me", getMeHandler)
api.get("/api/hello", getHelloHandler)
api.get("/api/hello/:name", getHelloNameHandler)
api.get("/api/captions/status", getCaptionsStatusHandler)

export { api }

// ============ HANDLERS ============

function getMeHandler(c: Context<{ Variables: AuthVariables }>) {
    const userId = c.get("authUserId")
    const hasActiveSession = c.get("activeSession") !== null

    return c.json({
        authenticated: !!userId,
        userId: userId || null,
        hasActiveSession,
    })
}

function getHelloHandler(c: Context) {
    return c.json({
        message: "Hello from Captions API!",
        method: "GET",
    })
}

function getHelloNameHandler(c: Context) {
    const name = c.req.param("name")
    return c.json({
        message: `Hello, ${name}!`,
    })
}

function getCaptionsStatusHandler(c: Context) {
    return c.json({
        active: true,
        captionsEnabled: true,
    })
}
