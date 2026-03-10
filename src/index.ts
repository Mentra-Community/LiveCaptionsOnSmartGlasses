/**
 * Live Captions App — Hono-based fullstack entry point
 *
 * Single Bun.serve() with Hono (via AppServer) handling everything:
 * - MentraOS webhook + SDK session lifecycle
 * - Auth middleware (cookie + bearer token)
 * - API routes mounted directly on the AppServer
 * - React webview served at /webview
 *
 * Auth flow:
 * - Mobile injects aos_signed_user_token / aos_temp_token into the webview URL
 * - /api/mentra/auth/init exchanges the token and sets a signed session cookie
 * - All API routes read userId from c.get("authUserId") via Hono context
 */

import { createMentraAuthRoutes } from "@mentra/sdk";
import indexHtml from "./webview/index.html";
import { LiveCaptionsApp } from "./app";

const PORT = parseInt(process.env.PORT || "3000", 10);
const PACKAGE_NAME = process.env.PACKAGE_NAME || "com.mentra.captions";
const API_KEY = process.env.MENTRAOS_API_KEY || "";
const COOKIE_SECRET = process.env.COOKIE_SECRET || API_KEY;

if (!API_KEY) {
  console.error("❌ MENTRAOS_API_KEY environment variable is not set");
  process.exit(1);
}

if (!PACKAGE_NAME) {
  console.error("❌ PACKAGE_NAME environment variable is not set");
  process.exit(1);
}

console.log("🚀 Starting Live Captions App...\n");

// Initialize App — extends AppServer which extends Hono
const app = new LiveCaptionsApp({
  packageName: PACKAGE_NAME,
  apiKey: API_KEY,
  port: PORT,
  cookieSecret: COOKIE_SECRET,
});

// Mount Mentra auth routes — handles /api/mentra/auth/init token exchange
// This sets a signed session cookie the SDK middleware reads on every request
app.route(
  "/api/mentra/auth",
  createMentraAuthRoutes({
    apiKey: API_KEY,
    packageName: PACKAGE_NAME,
    cookieSecret: COOKIE_SECRET,
  }),
);

// Start the SDK (registers SDK internal routes, checks version)
await app.start();

console.log(`✅ Live Captions running on port ${PORT}`);

const isDevelopment = process.env.NODE_ENV === "development";

// Single Bun server: static webview routes + everything else through Hono
Bun.serve({
  port: PORT,
  idleTimeout: 255, // max allowed; keeps SSE connections alive
  development: isDevelopment && {
    hmr: true,
    console: true,
  },
  routes: {
    // Serve React webview at root and /webview
    "/": indexHtml,
    "/webview": indexHtml,
    "/webview/*": indexHtml,
  },
  fetch(request) {
    // All other requests (API, webhooks, auth) go through Hono
    return app.fetch(request);
  },
});

// Graceful shutdown
const shutdown = async () => {
  console.log("\n🛑 Shutting down...");
  await app.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
