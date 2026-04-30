import { MiniAppServer, type MentraSession } from "@mentra/sdk";
import { getMentraAuth } from "@mentra/sdk";
import type { Context } from "hono";
import { UserSession } from "./session/UserSession";

export interface LiveCaptionsAppConfig {
  packageName: string;
  apiKey: string;
  port: number;
}

export function createLiveCaptionsApp(
  config: LiveCaptionsAppConfig,
): MiniAppServer {
  const app = new MiniAppServer({
    packageName: config.packageName,
    apiKey: config.apiKey,
    port: config.port,
  });

  // ── MentraOS Session Lifecycle ──────────────────────────────────────────

  app.onSession((session: MentraSession) => {
    const userId = session.userId;
    if (!userId) {
      session.logger.error("Session connected without a userId");
      return;
    }

    const userSession = new UserSession(session);
    userSession.initialize().catch((error) => {
      session.logger.error({ error }, "Error initializing UserSession");
      userSession.dispose();
    });

    session.onStopped(() => {
      UserSession.getUserSession(userId)?.dispose();
    });
  });

  app.onStop((session, reason) => {
    if (session?.userId) {
      UserSession.getUserSession(session.userId)?.dispose();
    }
  });

  // ── API Routes ──────────────────────────────────────────────────────────

  // ── Transcripts ─────────────────────────────────────────────────────────

  app.get("/api/transcripts", (c: Context) => {
    const auth = getMentraAuth(c as any);
    const userId = auth?.userId;
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const userSession = UserSession.getUserSession(userId);
    if (!userSession) return c.json({ error: "No active session" }, 404);

    return c.json({ transcripts: userSession.transcripts.getAll() });
  });

  // ── Transcript SSE stream ───────────────────────────────────────────────

  app.get("/api/transcripts/stream", (c: Context) => {
    const auth = getMentraAuth(c as any);
    const userId = auth?.userId;
    if (!userId) return c.text("Unauthorized", 401);

    const userSession = UserSession.getUserSession(userId);
    if (!userSession) return c.text("No active session", 404);

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "connected" })}\n\n`),
        );

        const client = {
          send: (data: unknown) => {
            try {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
              );
            } catch {
              userSession.transcripts.removeSSEClient(client);
            }
          },
        };

        userSession.transcripts.addSSEClient(client);

        c.req.raw.signal?.addEventListener("abort", () => {
          userSession.transcripts.removeSSEClient(client);
          try {
            controller.close();
          } catch {
            // already closed
          }
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  });

  // ── Settings ────────────────────────────────────────────────────────────

  app.get("/api/settings", async (c: Context) => {
    const auth = getMentraAuth(c as any);
    const userId = auth?.userId;
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const userSession = UserSession.getUserSession(userId);
    if (!userSession) return c.json({ error: "No active session" }, 404);

    return c.json(await userSession.settings.getAll());
  });

  app.post("/api/settings/language", async (c: Context) => {
    const auth = getMentraAuth(c as any);
    const userId = auth?.userId;
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const userSession = UserSession.getUserSession(userId);
    if (!userSession) return c.json({ error: "No active session" }, 404);

    let body: { language?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!body.language || typeof body.language !== "string") {
      return c.json({ error: "Invalid language" }, 400);
    }

    await userSession.settings.setLanguage(body.language);
    return c.json({ success: true });
  });

  app.post("/api/settings/language-hints", async (c: Context) => {
    const auth = getMentraAuth(c as any);
    const userId = auth?.userId;
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const userSession = UserSession.getUserSession(userId);
    if (!userSession) return c.json({ error: "No active session" }, 404);

    let body: { hints?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!Array.isArray(body.hints)) {
      return c.json({ error: "hints must be an array" }, 400);
    }

    await userSession.settings.setLanguageHints(body.hints);
    return c.json({ success: true });
  });

  app.post("/api/settings/display-lines", async (c: Context) => {
    const auth = getMentraAuth(c as any);
    const userId = auth?.userId;
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const userSession = UserSession.getUserSession(userId);
    if (!userSession) return c.json({ error: "No active session" }, 404);

    let body: { lines?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (typeof body.lines !== "number" || body.lines < 2 || body.lines > 5) {
      return c.json({ error: "lines must be a number between 2 and 5" }, 400);
    }

    await userSession.settings.setDisplayLines(body.lines);
    return c.json({ success: true });
  });

  app.post("/api/settings/display-width", async (c: Context) => {
    const auth = getMentraAuth(c as any);
    const userId = auth?.userId;
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const userSession = UserSession.getUserSession(userId);
    if (!userSession) return c.json({ error: "No active session" }, 404);

    let body: { width?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (typeof body.width !== "number") {
      return c.json({ error: "width must be a number" }, 400);
    }

    await userSession.settings.setDisplayWidth(body.width);
    return c.json({ success: true });
  });

  app.post("/api/settings/word-breaking", async (c: Context) => {
    const auth = getMentraAuth(c as any);
    const userId = auth?.userId;
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const userSession = UserSession.getUserSession(userId);
    if (!userSession) return c.json({ error: "No active session" }, 404);

    let body: { enabled?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (typeof body.enabled !== "boolean") {
      return c.json({ error: "enabled must be a boolean" }, 400);
    }

    await userSession.settings.setWordBreaking(body.enabled);
    return c.json({ success: true });
  });

  // ── Auth info ───────────────────────────────────────────────────────────

  app.get("/api/me", (c: Context) => {
    const auth = getMentraAuth(c as any);
    const userId = auth?.userId;
    return c.json({ userId: userId ?? null, isAuthenticated: !!userId });
  });

  return app;
}

// Re-export for backward compat with index.ts that imports LiveCaptionsApp
export class LiveCaptionsApp extends MiniAppServer {
  constructor(config: LiveCaptionsAppConfig) {
    super({
      packageName: config.packageName,
      apiKey: config.apiKey,
      port: config.port,
    });

    // Set up session lifecycle
    this.onSession((session: MentraSession) => {
      const userId = session.userId;
      if (!userId) {
        session.logger.error("Session connected without a userId");
        return;
      }

      const userSession = new UserSession(session);
      userSession.initialize().catch((error) => {
        session.logger.error({ error }, "Error initializing UserSession");
        userSession.dispose();
      });

      session.onStopped(() => {
        UserSession.getUserSession(userId)?.dispose();
      });
    });

    this.onStop((session, reason) => {
      if (session?.userId) {
        UserSession.getUserSession(session.userId)?.dispose();
      }
    });

    this.setupApiRoutes();
  }

  private setupApiRoutes(): void {
    // ── Transcripts ─────────────────────────────────────────────────────

    this.get("/api/transcripts", (c: Context) => {
      const auth = getMentraAuth(c as any);
      const userId = auth?.userId;
      if (!userId) return c.json({ error: "Unauthorized" }, 401);

      const userSession = UserSession.getUserSession(userId);
      if (!userSession) return c.json({ error: "No active session" }, 404);

      return c.json({ transcripts: userSession.transcripts.getAll() });
    });

    this.get("/api/transcripts/stream", (c: Context) => {
      const auth = getMentraAuth(c as any);
      const userId = auth?.userId;
      if (!userId) return c.text("Unauthorized", 401);

      const userSession = UserSession.getUserSession(userId);
      if (!userSession) return c.text("No active session", 404);

      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "connected" })}\n\n`,
            ),
          );

          const client = {
            send: (data: unknown) => {
              try {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
                );
              } catch {
                userSession.transcripts.removeSSEClient(client);
              }
            },
          };

          userSession.transcripts.addSSEClient(client);

          c.req.raw.signal?.addEventListener("abort", () => {
            userSession.transcripts.removeSSEClient(client);
            try {
              controller.close();
            } catch {
              // already closed
            }
          });
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    });

    // ── Settings ─────────────────────────────────────────────────────────

    this.get("/api/settings", async (c: Context) => {
      const auth = getMentraAuth(c as any);
      const userId = auth?.userId;
      if (!userId) return c.json({ error: "Unauthorized" }, 401);

      const userSession = UserSession.getUserSession(userId);
      if (!userSession) return c.json({ error: "No active session" }, 404);

      return c.json(await userSession.settings.getAll());
    });

    this.post("/api/settings/language", async (c: Context) => {
      const auth = getMentraAuth(c as any);
      const userId = auth?.userId;
      if (!userId) return c.json({ error: "Unauthorized" }, 401);

      const userSession = UserSession.getUserSession(userId);
      if (!userSession) return c.json({ error: "No active session" }, 404);

      let body: { language?: unknown };
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
      }

      if (!body.language || typeof body.language !== "string") {
        return c.json({ error: "Invalid language" }, 400);
      }

      await userSession.settings.setLanguage(body.language);
      return c.json({ success: true });
    });

    this.post("/api/settings/language-hints", async (c: Context) => {
      const auth = getMentraAuth(c as any);
      const userId = auth?.userId;
      if (!userId) return c.json({ error: "Unauthorized" }, 401);

      const userSession = UserSession.getUserSession(userId);
      if (!userSession) return c.json({ error: "No active session" }, 404);

      let body: { hints?: unknown };
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
      }

      if (!Array.isArray(body.hints)) {
        return c.json({ error: "hints must be an array" }, 400);
      }

      await userSession.settings.setLanguageHints(body.hints);
      return c.json({ success: true });
    });

    this.post("/api/settings/display-lines", async (c: Context) => {
      const auth = getMentraAuth(c as any);
      const userId = auth?.userId;
      if (!userId) return c.json({ error: "Unauthorized" }, 401);

      const userSession = UserSession.getUserSession(userId);
      if (!userSession) return c.json({ error: "No active session" }, 404);

      let body: { lines?: unknown };
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
      }

      if (typeof body.lines !== "number" || body.lines < 2 || body.lines > 5) {
        return c.json({ error: "lines must be a number between 2 and 5" }, 400);
      }

      await userSession.settings.setDisplayLines(body.lines);
      return c.json({ success: true });
    });

    this.post("/api/settings/display-width", async (c: Context) => {
      const auth = getMentraAuth(c as any);
      const userId = auth?.userId;
      if (!userId) return c.json({ error: "Unauthorized" }, 401);

      const userSession = UserSession.getUserSession(userId);
      if (!userSession) return c.json({ error: "No active session" }, 404);

      let body: { width?: unknown };
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
      }

      if (typeof body.width !== "number") {
        return c.json({ error: "width must be a number" }, 400);
      }

      await userSession.settings.setDisplayWidth(body.width);
      return c.json({ success: true });
    });

    this.post("/api/settings/word-breaking", async (c: Context) => {
      const auth = getMentraAuth(c as any);
      const userId = auth?.userId;
      if (!userId) return c.json({ error: "Unauthorized" }, 401);

      const userSession = UserSession.getUserSession(userId);
      if (!userSession) return c.json({ error: "No active session" }, 404);

      let body: { enabled?: unknown };
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
      }

      if (typeof body.enabled !== "boolean") {
        return c.json({ error: "enabled must be a boolean" }, 400);
      }

      await userSession.settings.setWordBreaking(body.enabled);
      return c.json({ success: true });
    });

    this.get("/api/me", (c: Context) => {
      const auth = getMentraAuth(c as any);
      const userId = auth?.userId;
      return c.json({ userId: userId ?? null, isAuthenticated: !!userId });
    });
  }
}
