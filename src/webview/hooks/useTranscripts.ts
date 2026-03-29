import { useReducer, useEffect, useRef, useCallback } from "react";
import { createAuthFetch } from "../lib/authFetch";

export interface Transcript {
  id: string;
  utteranceId: string | null;
  speaker: string;
  text: string;
  timestamp: number | null; // Unix epoch ms — formatted client-side in user's timezone
  isFinal: boolean;
}

export interface DisplayPreview {
  text: string;
  lines: string[];
  isFinal: boolean;
  timestamp: number;
}

// Reconnection configuration
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 20;
const HEARTBEAT_TIMEOUT_MS = 45000; // Consider connection dead if no data for 45s
const HEARTBEAT_CHECK_INTERVAL_MS = 10000;

// --- State machine types ---

type ConnectionState =
  | { status: "idle" }
  | { status: "connecting"; attempt: number }
  | { status: "connected" }
  | { status: "reconnecting"; attempt: number; secondsRemaining: number }
  | { status: "disconnected"; error: string };

interface State {
  connection: ConnectionState;
  transcripts: Transcript[];
  displayPreview: DisplayPreview | null;
  isRecording: boolean;
}

interface TranscriptEvent {
  id: string;
  utteranceId: string | null;
  speaker: string;
  text: string;
  timestamp: number | null;
  type: "interim" | "final";
}

type Action =
  | { type: "CONNECT"; attempt: number }
  | { type: "CONNECTED" }
  | { type: "LOAD_TRANSCRIPTS"; transcripts: Transcript[] }
  | { type: "SSE_TRANSCRIPT"; event: TranscriptEvent }
  | { type: "SCHEDULE_RECONNECT"; attempt: number; secondsRemaining: number }
  | { type: "UPDATE_COUNTDOWN"; secondsRemaining: number }
  | { type: "DISCONNECTED"; error: string }
  | { type: "SET_DISPLAY_PREVIEW"; preview: DisplayPreview }
  | { type: "TOGGLE_RECORDING" }
  | { type: "CLEAR_TRANSCRIPTS" }
  | { type: "RESET_CONNECTION" };

const initialState: State = {
  connection: { status: "idle" },
  transcripts: [],
  displayPreview: null,
  isRecording: false,
};

// --- Transcript update logic ---

function applyTranscriptEvent(
  transcripts: Transcript[],
  event: TranscriptEvent,
): Transcript[] {
  const newTranscript: Transcript = {
    id: event.id,
    utteranceId: event.utteranceId,
    speaker: event.speaker,
    text: event.text,
    timestamp: event.timestamp,
    isFinal: event.type === "final",
  };

  // Use utteranceId for correlation if available
  if (event.utteranceId) {
    const existingIndex = transcripts.findIndex(
      (t) => t.utteranceId === event.utteranceId,
    );
    if (existingIndex >= 0) {
      const updated = [...transcripts];
      updated[existingIndex] = newTranscript;
      return updated;
    }
    return [...transcripts, newTranscript];
  }

  // Legacy behavior: no utteranceId
  if (event.type === "interim") {
    const filtered = transcripts.filter(
      (t) => !(t.speaker === event.speaker && !t.isFinal),
    );
    return [...filtered, newTranscript];
  }

  // Final, no utteranceId — deduplicate by id
  const alreadyExists = transcripts.some(
    (t) => t.isFinal && t.id === event.id,
  );
  if (alreadyExists) return transcripts;

  const filtered = transcripts.filter(
    (t) => !(t.speaker === event.speaker && !t.isFinal),
  );
  return [...filtered, newTranscript];
}

// --- Reducer ---

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "CONNECT":
      return {
        ...state,
        connection: { status: "connecting", attempt: action.attempt },
      };

    case "CONNECTED":
      return {
        ...state,
        connection: { status: "connected" },
      };

    case "LOAD_TRANSCRIPTS":
      return {
        ...state,
        transcripts: action.transcripts,
      };

    case "SSE_TRANSCRIPT":
      return {
        ...state,
        transcripts: applyTranscriptEvent(state.transcripts, action.event),
      };

    case "SCHEDULE_RECONNECT":
      return {
        ...state,
        connection: {
          status: "reconnecting",
          attempt: action.attempt,
          secondsRemaining: action.secondsRemaining,
        },
      };

    case "UPDATE_COUNTDOWN":
      if (state.connection.status !== "reconnecting") return state;
      return {
        ...state,
        connection: {
          ...state.connection,
          secondsRemaining: action.secondsRemaining,
        },
      };

    case "DISCONNECTED":
      return {
        ...state,
        connection: { status: "disconnected", error: action.error },
      };

    case "SET_DISPLAY_PREVIEW":
      return {
        ...state,
        displayPreview: action.preview,
      };

    case "TOGGLE_RECORDING":
      return {
        ...state,
        isRecording: !state.isRecording,
      };

    case "CLEAR_TRANSCRIPTS":
      return {
        ...state,
        transcripts: [],
      };

    case "RESET_CONNECTION":
      return {
        ...state,
        connection: { status: "idle" },
      };

    default:
      return state;
  }
}

// --- Hook ---

export function useTranscripts(frontendToken: string | null = null) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Refs for imperative handles (not UI state)
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatCheckRef = useRef<NodeJS.Timeout | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const isConnectingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Ref so scheduleReconnect can call the latest connect without being
  // in its own dep array (avoids infinite memo loop).
  const connectRef = useRef<(attempt: number) => Promise<void>>(async () => {});

  // Cleanup function
  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    if (heartbeatCheckRef.current) {
      clearInterval(heartbeatCheckRef.current);
      heartbeatCheckRef.current = null;
    }
  }, []);

  // Calculate retry delay with exponential backoff
  const getRetryDelay = useCallback((attempt: number): number => {
    const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
    return Math.min(delay, MAX_RETRY_DELAY_MS);
  }, []);

  // Schedule a reconnection attempt
  const scheduleReconnect = useCallback(
    (attempt: number) => {
      if (abortControllerRef.current?.signal.aborted) return;

      if (attempt >= MAX_RECONNECT_ATTEMPTS) {
        dispatch({
          type: "DISCONNECTED",
          error: "Connection lost. Please refresh the page to reconnect.",
        });
        return;
      }

      const delay = getRetryDelay(attempt);
      console.log(
        `[SSE] Scheduling reconnect attempt ${attempt + 1}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`,
      );

      const secondsRemaining = Math.round(delay / 1000);
      dispatch({
        type: "SCHEDULE_RECONNECT",
        attempt,
        secondsRemaining,
      });

      // Clear any existing countdown interval
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }

      // Update countdown every second
      const startTime = Date.now();
      countdownIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, Math.round((delay - elapsed) / 1000));
        dispatch({ type: "UPDATE_COUNTDOWN", secondsRemaining: remaining });

        if (remaining <= 0 && countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
        }
      }, 1000);

      reconnectTimeoutRef.current = setTimeout(() => {
        if (!abortControllerRef.current?.signal.aborted) {
          // Clear countdown when actually reconnecting
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
          }
          // Use ref so we always call the latest connect (avoids stale closure)
          connectRef.current(attempt + 1);
        }
      }, delay);
    },
    [getRetryDelay],
  );

  // Main connection function
  const connect = useCallback(
    async (attempt: number = 0) => {
      const signal = abortControllerRef.current?.signal;
      if (signal?.aborted) return;

      // If we have no token yet, don't even try — wait for auth to complete.
      // The useEffect below re-runs when frontendToken changes, which will
      // call connect(0) again with the real token.
      if (!frontendToken) {
        dispatch({
          type: "DISCONNECTED",
          error: "Waiting for authentication...",
        });
        return;
      }

      // If already connecting, bail. But: if this call came from the useEffect
      // (i.e. attempt === 0 and we just got a new token), reset the flag so
      // an authenticated connect can always proceed.
      if (isConnectingRef.current && attempt === 0) {
        isConnectingRef.current = false;
        cleanup();
      }
      if (isConnectingRef.current) return;

      isConnectingRef.current = true;
      cleanup();
      dispatch({ type: "CONNECT", attempt });

      try {
        console.log(`[SSE] Connecting (attempt ${attempt + 1})...`);

        const authFetch = createAuthFetch(frontendToken);

        // First, try to load initial transcript history
        const response = await authFetch("/api/transcripts", { signal });

        if (signal?.aborted) {
          isConnectingRef.current = false;
          return;
        }

        if (response.status === 401) {
          // 401 with a token means the token is genuinely invalid/expired —
          // don't retry in a loop, just bail and let auth re-initialize.
          console.log("[SSE] Not authenticated (token rejected)");
          dispatch({
            type: "DISCONNECTED",
            error: "Authentication failed. Please re-open the app.",
          });
          isConnectingRef.current = false;
          return;
        }

        if (response.status === 404) {
          console.log("[SSE] No active session");
          isConnectingRef.current = false;
          scheduleReconnect(attempt);
          return;
        }

        if (response.ok) {
          const data = await response.json();
          dispatch({
            type: "LOAD_TRANSCRIPTS",
            transcripts: data.transcripts || [],
          });
        }

        // Connect to SSE stream.
        // EventSource doesn't support custom headers, but the SDK auth middleware
        // also accepts a session cookie (set by /api/mentra/auth/init). If no
        // cookie is present we append the token as a query param so the server
        // can fall back to bearer auth via URL.
        const sseUrl = frontendToken
          ? `/api/transcripts/stream?aos_frontend_token=${encodeURIComponent(frontendToken)}`
          : "/api/transcripts/stream";
        const eventSource = new EventSource(sseUrl);
        eventSourceRef.current = eventSource;
        lastActivityRef.current = Date.now();

        eventSource.onopen = () => {
          if (signal?.aborted) return;

          console.log("[SSE] Connected successfully");
          dispatch({ type: "CONNECTED" });
          lastActivityRef.current = Date.now();
          isConnectingRef.current = false;
        };

        eventSource.onmessage = (event) => {
          if (signal?.aborted) return;

          lastActivityRef.current = Date.now();

          try {
            const data = JSON.parse(event.data);

            // Handle heartbeat/ping messages
            if (data.type === "heartbeat" || data.type === "ping") {
              console.log("[SSE] Heartbeat received");
              return;
            }

            if (data.type === "connected") {
              console.log("[SSE] Server confirmed connection");
              return;
            }

            // Handle settings update - dispatch custom event for useSettings hook
            if (data.type === "settings_update" && data.settings) {
              console.log("[SSE] Settings update received:", data.settings);
              window.dispatchEvent(
                new CustomEvent("settings_update", { detail: data.settings }),
              );
              return;
            }

            // Handle display preview update
            if (data.type === "display_preview") {
              dispatch({
                type: "SET_DISPLAY_PREVIEW",
                preview: {
                  text: data.text,
                  lines: data.lines,
                  isFinal: data.isFinal,
                  timestamp: data.timestamp,
                },
              });
              return;
            }

            // Transcript event
            dispatch({
              type: "SSE_TRANSCRIPT",
              event: {
                id: data.id,
                utteranceId: data.utteranceId ?? null,
                speaker: data.speaker,
                text: data.text,
                timestamp: data.timestamp,
                type: data.type,
              },
            });
          } catch (e) {
            console.error("[SSE] Failed to parse message:", e);
          }
        };

        eventSource.onerror = (e) => {
          console.error("[SSE] Connection error:", e);

          if (signal?.aborted) return;

          isConnectingRef.current = false;

          // Close the current connection
          if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
          }

          // Schedule reconnection
          scheduleReconnect(attempt);
        };

        // Start heartbeat monitoring
        heartbeatCheckRef.current = setInterval(() => {
          if (signal?.aborted) return;

          const timeSinceLastActivity = Date.now() - lastActivityRef.current;

          if (timeSinceLastActivity > HEARTBEAT_TIMEOUT_MS) {
            console.log(
              `[SSE] No activity for ${timeSinceLastActivity}ms, reconnecting...`,
            );

            if (eventSourceRef.current) {
              eventSourceRef.current.close();
              eventSourceRef.current = null;
            }

            scheduleReconnect(0); // Start fresh with attempt 0
          }
        }, HEARTBEAT_CHECK_INTERVAL_MS);
      } catch (err) {
        console.error("[SSE] Failed to connect:", err);

        if (signal?.aborted) {
          isConnectingRef.current = false;
          return;
        }

        isConnectingRef.current = false;
        scheduleReconnect(attempt);
      }
    },
    [cleanup, scheduleReconnect, frontendToken],
  );

  // Keep connectRef in sync with the latest connect so scheduleReconnect
  // never holds a stale closure over frontendToken.
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // Initial connection and cleanup.
  // Runs whenever frontendToken changes (null → real value triggers first connect).
  useEffect(() => {
    const ac = new AbortController();
    abortControllerRef.current = ac;

    // Don't attempt until we actually have a token
    if (frontendToken) {
      connect(0);
    }

    return () => {
      ac.abort();
      cleanup();
    };
  }, [connect, cleanup, frontendToken]);

  // Manual reconnect function (for UI button)
  const reconnect = useCallback(() => {
    console.log("[SSE] Manual reconnect triggered");
    cleanup();
    dispatch({ type: "RESET_CONNECTION" });
    connect(0);
  }, [connect, cleanup]);

  const toggleRecording = useCallback(() => {
    dispatch({ type: "TOGGLE_RECORDING" });
  }, []);

  const clearTranscripts = useCallback(() => {
    dispatch({ type: "CLEAR_TRANSCRIPTS" });
  }, []);

  return {
    transcripts: state.transcripts,
    connected: state.connection.status === "connected",
    error:
      state.connection.status === "reconnecting"
        ? `Connection lost. Reconnecting in ${state.connection.secondsRemaining}s...`
        : state.connection.status === "disconnected"
          ? state.connection.error
          : null,
    reconnectAttempt:
      state.connection.status === "reconnecting"
        ? state.connection.attempt
        : 0,
    isRecording: state.isRecording,
    toggleRecording,
    clearTranscripts,
    reconnect,
    displayPreview: state.displayPreview,
  };
}
