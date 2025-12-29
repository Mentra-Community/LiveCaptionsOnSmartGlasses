/**
 * Captions App - Unified Single Server Architecture (Hono + Bun)
 *
 * Developers control their own Bun.serve server and mount the Hono-based AppServer.
 */

import { serve } from "bun"
import { LiveCaptionsApp } from "./app"
import { api } from "./api"
import indexDev from "./webview/index.html"
import indexProd from "./webview/index.prod.html"

// Configuration
const PORT = parseInt(process.env.PORT || "3333", 10)
const PACKAGE_NAME = process.env.PACKAGE_NAME || "com.mentra.captions"
const API_KEY = process.env.MENTRAOS_API_KEY || ""

if (!API_KEY) {
  console.error("❌ MENTRAOS_API_KEY environment variable is not set")
  process.exit(1)
}

if (!PACKAGE_NAME) {
  console.error("❌ PACKAGE_NAME environment variable is not set")
  process.exit(1)
}

console.log("🚀 Starting Captions App (Unified Hono Architecture)...\n")

const isDevelopment = process.env.NODE_ENV === "development"

// ============================================
// 1. Initialize App (Hono Instance)
// ============================================

const captionsApp = new LiveCaptionsApp({
  packageName: PACKAGE_NAME,
  apiKey: API_KEY,
  port: PORT,
})

// Initialize SDK features (logging, etc.)
await captionsApp.start()

// ============================================
// 2. Mount API Routes
// ============================================

// Mount all routes from the api/ folder
captionsApp.route("/", api)

// ============================================
// 3. Start Bun Server (Option C: Dev controlled)
// ============================================

const server = serve({
  port: PORT,

  // Bun handles React/HTML bundling with HMR for routes
  routes: {
    "/*": isDevelopment ? indexDev : indexProd,
  },

  // Delegate all other requests to Hono
  fetch: captionsApp.fetch,

  // Development mode with HMR
  development: isDevelopment
    ? {
      hmr: true,
      console: true,
    }
    : false,
})

console.log(`\n🎉 Captions app is ready!`)
console.log(`📝 Access the app at: ${server.url}`)
console.log(`   - Webview: ${server.url}`)
console.log(`   - API: ${server.url}/api/hello`)
console.log(`   - Transcripts SSE: ${server.url}/api/transcripts/stream`)
console.log(`   - MentraOS Webhook: ${server.url}/webhook\n`)

// ============================================
// Graceful Shutdown
// ============================================

const shutdown = async () => {
  console.log("\n🛑 Shutting down...")
  await captionsApp.stop()
  server.stop()
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
