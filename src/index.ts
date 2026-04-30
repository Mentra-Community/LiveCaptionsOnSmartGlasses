/**
 * Live Captions App — v3 SDK fullstack entry point
 *
 * Single Bun.serve() with MiniAppServer (Hono) handling everything:
 * - MentraOS webhook + SDK session lifecycle
 * - Auth middleware (automatic via MiniAppServer)
 * - API routes mounted directly on the app
 * - React webview served at /webview
 */

import indexHtml from "./webview/index.html";
import { LiveCaptionsApp } from "./app";

const PORT = parseInt(process.env.PORT || "3000", 10);
const PACKAGE_NAME = process.env.PACKAGE_NAME || "com.mentra.captions";
const API_KEY = process.env.MENTRAOS_API_KEY || "";

if (!API_KEY) {
  console.error("MENTRAOS_API_KEY environment variable is not set");
  process.exit(1);
}

if (!PACKAGE_NAME) {
  console.error("PACKAGE_NAME environment variable is not set");
  process.exit(1);
}

console.log("Starting Live Captions App...\n");

// Initialize App
const app = new LiveCaptionsApp({
  packageName: PACKAGE_NAME,
  apiKey: API_KEY,
  port: PORT,
});

// Start the SDK (registers internal routes, checks version)
await app.start();

console.log(`Live Captions running on port ${PORT}`);

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
