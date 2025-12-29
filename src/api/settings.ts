/**
 * Settings API Routes
 *
 * Hono sub-app for /api/settings/*
 * Includes language, display-lines, display-width settings
 */
import { Hono } from "hono"
import type { Context } from "hono"
import type { AuthVariables } from "@mentra/sdk"

import { UserSession } from "../app/session/UserSession"

const settings = new Hono<{ Variables: AuthVariables }>()

// ============ ROUTES ============
settings.get("/", getSettingsHandler)
settings.post("/language", setLanguageHandler)
settings.post("/language-hints", setLanguageHintsHandler)
settings.post("/display-lines", setDisplayLinesHandler)
settings.post("/display-width", setDisplayWidthHandler)

export { settings }

// ============ HANDLERS ============

async function getSettingsHandler(c: Context<{ Variables: AuthVariables }>) {
  const userId = c.get("authUserId")
  if (!userId) {
    return c.json({ error: "Not authenticated" }, 401)
  }

  const userSession = UserSession.getUserSession(userId)
  if (!userSession) {
    // Return default settings if no session
    return c.json({
      language: "auto",
      languageHints: [],
      displayLines: 3,
      displayWidth: 1,
    })
  }

  const allSettings = await userSession.settings.getAll()
  return c.json(allSettings)
}

async function setLanguageHandler(c: Context<{ Variables: AuthVariables }>) {
  const userId = c.get("authUserId")
  if (!userId) {
    return c.json({ error: "Not authenticated" }, 401)
  }

  const userSession = UserSession.getUserSession(userId)
  if (!userSession) {
    return c.json({ error: "No active session" }, 404)
  }

  let body
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400)
  }

  const { language } = body
  if (!language || typeof language !== "string") {
    return c.json({ error: "Invalid language" }, 400)
  }

  await userSession.settings.setLanguage(language)
  return c.json({ success: true })
}

async function setLanguageHintsHandler(c: Context<{ Variables: AuthVariables }>) {
  const userId = c.get("authUserId")
  if (!userId) {
    return c.json({ error: "Not authenticated" }, 401)
  }

  const userSession = UserSession.getUserSession(userId)
  if (!userSession) {
    return c.json({ error: "No active session" }, 404)
  }

  let body
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400)
  }

  const { hints } = body
  if (!Array.isArray(hints)) {
    return c.json({ error: "hints must be an array" }, 400)
  }

  await userSession.settings.setLanguageHints(hints)
  return c.json({ success: true })
}

async function setDisplayLinesHandler(c: Context<{ Variables: AuthVariables }>) {
  const userId = c.get("authUserId")
  if (!userId) {
    return c.json({ error: "Not authenticated" }, 401)
  }

  const userSession = UserSession.getUserSession(userId)
  if (!userSession) {
    return c.json({ error: "No active session" }, 404)
  }

  let body
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400)
  }

  const { lines } = body
  if (typeof lines !== "number" || lines < 2 || lines > 5) {
    return c.json({ error: "lines must be a number between 2 and 5" }, 400)
  }

  await userSession.settings.setDisplayLines(lines)
  return c.json({ success: true })
}

async function setDisplayWidthHandler(c: Context<{ Variables: AuthVariables }>) {
  const userId = c.get("authUserId")
  if (!userId) {
    return c.json({ error: "Not authenticated" }, 401)
  }

  const userSession = UserSession.getUserSession(userId)
  if (!userSession) {
    return c.json({ error: "No active session" }, 404)
  }

  let body
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400)
  }

  const { width } = body
  if (typeof width !== "number") {
    return c.json({ error: "width must be a number" }, 400)
  }

  await userSession.settings.setDisplayWidth(width)
  return c.json({ success: true })
}
