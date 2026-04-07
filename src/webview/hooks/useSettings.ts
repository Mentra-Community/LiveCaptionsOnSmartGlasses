import { useState, useEffect, useCallback, useRef } from "react";
import { createAuthFetch } from "../lib/authFetch";

export interface CaptionSettings {
  language: string;
  languageHints: string[];
  displayLines: number;
  displayWidth: number;
  wordBreaking: boolean;
}

export function useSettings(frontendToken: string | null = null) {
  const [settings, setSettings] = useState<CaptionSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchSettings = useCallback(async () => {
    const authFetch = createAuthFetch(frontendToken);
    try {
      setLoading(true);
      setError(null);

      const response = await authFetch("/api/settings");

      if (!mountedRef.current) return;

      if (response.status === 401) {
        setError("Not authenticated");
        setLoading(false);
        return;
      }

      if (response.status === 404) {
        setError("No active session");
        setLoading(false);
        return;
      }

      if (!response.ok) {
        setError(`Failed to load settings: ${response.status}`);
        setLoading(false);
        return;
      }

      const data = await response.json();

      if (!mountedRef.current) return;

      setSettings(data);
      setLoading(false);
      setError(null);
    } catch (err) {
      console.error("[useSettings] Failed to fetch settings:", err);
      if (mountedRef.current) {
        setError("Failed to load settings");
        setLoading(false);
      }
    }
  }, [frontendToken]);

  // Initial fetch
  useEffect(() => {
    mountedRef.current = true;
    fetchSettings();

    return () => {
      mountedRef.current = false;
    };
  }, [fetchSettings]);

  // Listen for SSE settings updates
  useEffect(() => {
    const handleSSEMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "settings_update" && data.settings) {
          console.log(
            "[useSettings] Received settings update via SSE:",
            data.settings,
          );
          setSettings(data.settings);
        }
      } catch {
        // Ignore parse errors - might be transcript data
      }
    };

    // Listen on the existing SSE connection for settings updates
    // The SSE connection is managed by useTranscripts, but we can listen
    // for custom events on window
    const handleSettingsUpdate = (event: CustomEvent<CaptionSettings>) => {
      console.log(
        "[useSettings] Received settings update event:",
        event.detail,
      );
      setSettings(event.detail);
    };

    window.addEventListener(
      "settings_update",
      handleSettingsUpdate as EventListener,
    );

    return () => {
      window.removeEventListener(
        "settings_update",
        handleSettingsUpdate as EventListener,
      );
    };
  }, []);

  const updateLanguage = useCallback(
    async (language: string): Promise<boolean> => {
      const authFetch = createAuthFetch(frontendToken);
      try {
        const response = await authFetch("/api/settings/language", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language }),
        });

        if (response.ok) {
          // Optimistically update local state
          // The SSE broadcast will confirm the update
          setSettings((prev) => (prev ? { ...prev, language } : null));
          return true;
        }

        console.error(
          "[useSettings] Failed to update language:",
          response.status,
        );
        return false;
      } catch (err) {
        console.error("[useSettings] Failed to update language:", err);
        return false;
      }
    },
    [frontendToken],
  );

  const updateHints = useCallback(
    async (hints: string[]): Promise<boolean> => {
      const authFetch = createAuthFetch(frontendToken);
      try {
        const response = await authFetch("/api/settings/language-hints", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hints }),
        });

        if (response.ok) {
          setSettings((prev) =>
            prev ? { ...prev, languageHints: hints } : null,
          );
          return true;
        }

        console.error("[useSettings] Failed to update hints:", response.status);
        return false;
      } catch (err) {
        console.error("[useSettings] Failed to update hints:", err);
        return false;
      }
    },
    [frontendToken],
  );

  const updateDisplayLines = useCallback(
    async (lines: number): Promise<boolean> => {
      const authFetch = createAuthFetch(frontendToken);
      try {
        const response = await authFetch("/api/settings/display-lines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lines }),
        });

        if (response.ok) {
          setSettings((prev) =>
            prev ? { ...prev, displayLines: lines } : null,
          );
          return true;
        }

        console.error(
          "[useSettings] Failed to update display lines:",
          response.status,
        );
        return false;
      } catch (err) {
        console.error("[useSettings] Failed to update display lines:", err);
        return false;
      }
    },
    [frontendToken],
  );

  const updateDisplayWidth = useCallback(
    async (width: number): Promise<boolean> => {
      const authFetch = createAuthFetch(frontendToken);
      try {
        const response = await authFetch("/api/settings/display-width", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ width }),
        });

        if (response.ok) {
          setSettings((prev) =>
            prev ? { ...prev, displayWidth: width } : null,
          );
          return true;
        }

        console.error(
          "[useSettings] Failed to update display width:",
          response.status,
        );
        return false;
      } catch (err) {
        console.error("[useSettings] Failed to update display width:", err);
        return false;
      }
    },
    [frontendToken],
  );

  const updateWordBreaking = useCallback(
    async (enabled: boolean): Promise<boolean> => {
      const authFetch = createAuthFetch(frontendToken);
      try {
        const response = await authFetch("/api/settings/word-breaking", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        });

        if (response.ok) {
          setSettings((prev) =>
            prev ? { ...prev, wordBreaking: enabled } : null,
          );
          return true;
        }

        console.error(
          "[useSettings] Failed to update word breaking:",
          response.status,
        );
        return false;
      } catch (err) {
        console.error("[useSettings] Failed to update word breaking:", err);
        return false;
      }
    },
    [frontendToken],
  );

  return {
    settings,
    loading,
    error,
    updateLanguage,
    updateHints,
    updateDisplayLines,
    updateDisplayWidth,
    updateWordBreaking,
    refetch: fetchSettings,
  };
}
