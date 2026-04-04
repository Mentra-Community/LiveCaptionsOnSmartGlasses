/**
 * authFetch — authenticated fetch wrapper for Live Captions webview.
 *
 * Attaches the MentraOS frontendToken as a Bearer token on every request
 * so the Hono auth middleware can identify the user via c.get("authUserId").
 *
 * Usage:
 *   import { createAuthFetch } from "../lib/authFetch"
 *   const authFetch = createAuthFetch(frontendToken)
 *   const res = await authFetch("/api/settings")
 */

export function createAuthFetch(frontendToken: string | null) {
  return function authFetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    const headers = new Headers(init?.headers);

    if (frontendToken) {
      headers.set("Authorization", `Bearer ${frontendToken}`);
    }

    return fetch(input, { ...init, headers });
  };
}
