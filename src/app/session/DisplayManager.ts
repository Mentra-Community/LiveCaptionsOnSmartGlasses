import { ViewType } from "@mentra/sdk";

import {
  CaptionsFormatter,
  G1_PROFILE,
  Z100_PROFILE,
  NEX_PROFILE,
  type DisplayProfile,
  type TranscriptHistoryEntry,
} from "../utils/CaptionsFormatter";
import { UserSession } from "./UserSession";

/**
 * Map device model names to display profiles
 */
function getProfileForModel(
  modelName: string | null | undefined,
): DisplayProfile {
  if (!modelName) return G1_PROFILE; // Default to G1

  const lower = modelName.toLowerCase();

  // Even Realities G1
  if (
    lower.includes("g1") ||
    lower.includes("even realities") ||
    lower.includes("even_g1")
  ) {
    return G1_PROFILE;
  }

  // Vuzix Z100 and Mentra Mach1 (same hardware)
  if (
    lower.includes("z100") ||
    lower.includes("vuzix") ||
    lower.includes("mach1") ||
    lower.includes("mach 1")
  ) {
    return Z100_PROFILE;
  }

  // Mentra Nex / Mentra Display
  if (
    lower.includes("nex") ||
    lower.includes("mentra display") ||
    lower.includes("mentra_nex")
  ) {
    return NEX_PROFILE;
  }

  // Default to G1 for unknown devices
  return G1_PROFILE;
}

/**
 * Safely get the device model name from AppSession
 * Works with both old SDK (no device property) and new SDK (has device.modelName)
 */
function getDeviceModelName(
  appSession: UserSession["appSession"],
): string | null {
  try {
    // Try new SDK device state API
    const device = (appSession as any).device;
    if (device?.modelName?.value) {
      return device.modelName.value;
    }
    // Fallback: check capabilities
    const capabilities = (appSession as any).capabilities;
    if (capabilities?.modelName) {
      return capabilities.modelName;
    }
  } catch {
    // Ignore errors, return null
  }
  return null;
}

/**
 * Safely subscribe to device model changes
 * Returns cleanup function or null if subscription not available
 */
function subscribeToDeviceModel(
  appSession: UserSession["appSession"],
  callback: (modelName: string | null) => void,
): (() => void) | null {
  try {
    // Try new SDK device state API
    const device = (appSession as any).device;
    if (device?.modelName?.subscribe) {
      return device.modelName.subscribe(callback);
    }

    // Try capabilities_update event
    const events = appSession.events;
    if (events?.on) {
      const handler = (data: { modelName?: string | null }) => {
        if (data.modelName !== undefined) {
          callback(data.modelName);
        }
      };
      events.on("capabilities_update", handler);
      // Return cleanup function
      return () => {
        try {
          (events as any).off?.("capabilities_update", handler);
        } catch {
          // Ignore cleanup errors
        }
      };
    }
  } catch {
    // Ignore errors
  }
  return null;
}

export class DisplayManager {
  private formatter: CaptionsFormatter;
  private inactivityTimer: NodeJS.Timeout | null = null;
  private readonly userSession: UserSession;
  private readonly logger: UserSession["logger"];
  private lastSpeakerId: string | undefined = undefined; // Track last speaker for change detection

  // Current display profile (detected from connected glasses)
  private currentProfile: DisplayProfile = G1_PROFILE;

  // Current display settings
  private currentDisplayWidthPx: number = G1_PROFILE.displayWidthPx;
  private currentMaxLines: number = G1_PROFILE.maxLines;
  private currentWordBreaking: boolean = true;
  private currentWidthSetting: number = 2; // 0=Narrow, 1=Medium, 2=Wide (default: Wide)

  // Device state subscription cleanup
  private deviceStateCleanup: (() => void) | null = null;

  constructor(userSession: UserSession) {
    this.userSession = userSession;
    this.logger = userSession.logger.child({ service: "DisplayManager" });

    // Detect initial device model
    const initialModel = getDeviceModelName(userSession.appSession);
    this.currentProfile = getProfileForModel(initialModel);
    this.currentDisplayWidthPx = this.currentProfile.displayWidthPx;
    this.currentMaxLines = this.currentProfile.maxLines;

    this.logger.info(
      `Initializing DisplayManager with profile: ${this.currentProfile.id} (model: ${initialModel || "unknown"})`,
    );

    // Initialize formatter with detected profile
    // Using character-no-hyphen mode for clean word breaks without hyphens
    this.formatter = new CaptionsFormatter(this.currentProfile, {
      maxFinalTranscripts: 30,
      breakMode: this.currentWordBreaking ? "character" : "word",
      displayWidthPx: this.currentDisplayWidthPx,
      maxLines: this.currentMaxLines,
    });

    // Subscribe to device model changes
    this.subscribeToDeviceChanges();
  }

  /**
   * Subscribe to device state changes to update profile when glasses change
   */
  private subscribeToDeviceChanges(): void {
    // Use safe subscription helper that works with both old and new SDK
    this.deviceStateCleanup = subscribeToDeviceModel(
      this.userSession.appSession,
      (modelName: string | null) => {
        const newProfile = getProfileForModel(modelName);

        if (newProfile.id !== this.currentProfile.id) {
          this.logger.info(
            `Device model changed: ${modelName} -> switching to profile ${newProfile.id}`,
          );
          this.updateProfile(newProfile);
        }
      },
    );

    if (this.deviceStateCleanup) {
      this.logger.info("Subscribed to device model changes");
    } else {
      this.logger.warn(
        "Device state subscription not available, using default profile",
      );
    }
  }

  /**
   * Update the display profile (when glasses change)
   */
  private updateProfile(newProfile: DisplayProfile): void {
    const previousHistory = this.formatter.getFinalTranscriptHistory();

    this.currentProfile = newProfile;

    // Recalculate display width based on current width setting and new profile
    this.currentDisplayWidthPx = this.calculateDisplayWidth(
      this.currentWidthSetting,
      newProfile,
    );
    this.currentMaxLines = Math.min(this.currentMaxLines, newProfile.maxLines);

    this.logger.info(
      `Profile updated to ${newProfile.id}: displayWidth=${this.currentDisplayWidthPx}px, maxLines=${this.currentMaxLines}`,
    );

    // Recreate formatter with new profile
    this.formatter = new CaptionsFormatter(newProfile, {
      maxFinalTranscripts: 30,
      breakMode: this.currentWordBreaking ? "character" : "word",
      displayWidthPx: this.currentDisplayWidthPx,
      maxLines: this.currentMaxLines,
    });

    // Restore transcript history
    for (const entry of previousHistory) {
      this.formatter.processTranscription(
        entry.text,
        true,
        entry.speakerId,
        entry.hadSpeakerChange,
      );
    }

    this.logger.info(
      `Preserved ${previousHistory.length} transcripts after profile change`,
    );

    // Refresh display with new profile
    this.refreshDisplay();
  }

  /**
   * Calculate display width in pixels based on width setting and profile
   */
  private calculateDisplayWidth(
    widthSetting: number,
    profile: DisplayProfile,
  ): number {
    const maxWidthPx = profile.displayWidthPx;
    let widthPercent: number;

    switch (widthSetting) {
      case 0: // Narrow
        widthPercent = 0.7;
        break;
      case 1: // Medium
        widthPercent = 0.85;
        break;
      case 2: // Wide
      default:
        widthPercent = 1.0;
        break;
    }

    return Math.round(maxWidthPx * widthPercent);
  }

  /**
   * Update display settings
   *
   * @param displayWidth - Display width setting: 0=Narrow (70%), 1=Medium (85%), 2=Wide (100%)
   * @param numberOfLines - Maximum number of lines to display (2-5)
   * @param wordBreaking - Whether to break words mid-word (true) or only at word boundaries (false)
   */
  updateSettings(
    displayWidth: number,
    numberOfLines: number,
    wordBreaking: boolean = true,
  ): void {
    this.currentWidthSetting = displayWidth;
    this.currentDisplayWidthPx = this.calculateDisplayWidth(
      displayWidth,
      this.currentProfile,
    );
    this.currentMaxLines = Math.min(
      Math.max(2, numberOfLines),
      this.currentProfile.maxLines,
    ); // Clamp between 2 and profile max
    this.currentWordBreaking = wordBreaking;

    const widthPercent =
      displayWidth === 0 ? 70 : displayWidth === 1 ? 85 : 100;

    this.logger.info(
      `Settings update: profile=${this.currentProfile.id}, displayWidth=${displayWidth} (${widthPercent}% = ${this.currentDisplayWidthPx}px), lines=${this.currentMaxLines}, wordBreaking=${this.currentWordBreaking}`,
    );

    // Get previous transcript history to preserve it
    const previousHistory = this.formatter.getFinalTranscriptHistory();

    // Create new formatter with updated settings
    // breakMode: 'character' = break mid-word with hyphens for 100% utilization
    // breakMode: 'word' = break at word boundaries only
    this.formatter = new CaptionsFormatter(this.currentProfile, {
      maxFinalTranscripts: 30,
      breakMode: this.currentWordBreaking ? "character" : "word",
      displayWidthPx: this.currentDisplayWidthPx,
      maxLines: this.currentMaxLines,
    });

    // Restore transcript history (with speaker info preserved)
    for (const entry of previousHistory) {
      this.formatter.processTranscription(
        entry.text,
        true,
        entry.speakerId,
        entry.hadSpeakerChange,
      );
    }

    this.logger.info(
      `Preserved ${previousHistory.length} transcripts after settings change`,
    );

    // Immediately refresh the display with new settings
    this.refreshDisplay();
  }

  /**
   * Refresh the display with current transcript history using current settings
   * Called after settings change to show instant preview
   */
  private refreshDisplay(): void {
    const history = this.formatter.getFinalTranscriptHistory();

    if (history.length === 0) {
      // No transcripts yet, send empty preview
      this.userSession.transcripts.broadcastDisplayPreview("", [""], true);
      return;
    }

    // Process empty string to get current display state from history
    const result = this.formatter.processTranscription(
      "",
      true,
      undefined,
      false,
    );

    if (result.displayText.trim()) {
      const cleaned = this.cleanTranscriptText(result.displayText);
      const lines = cleaned.split("\n");

      this.logger.info(
        `Refreshing display with new settings: ${lines.length} lines`,
      );

      // Send to glasses
      try {
        this.userSession.appSession.layouts.showTextWall(cleaned, {
          view: ViewType.MAIN,
          durationMs: 20000,
        });
      } catch (err) {
        this.logger.warn(
          { err },
          "Failed to refresh display - connection may be closed",
        );
      }

      // Broadcast to webview preview
      this.userSession.transcripts.broadcastDisplayPreview(
        cleaned,
        lines,
        true,
      );
    }
  }

  /**
   * Process transcription text and display on glasses
   * @param text - The transcription text
   * @param isFinal - Whether this is a final transcription
   * @param speakerId - Optional speaker ID from diarization
   */
  processAndDisplay(text: string, isFinal: boolean, speakerId?: string): void {
    // Detect speaker change
    const speakerChanged =
      speakerId !== undefined && speakerId !== this.lastSpeakerId;

    if (speakerChanged) {
      this.logger.info(
        `Speaker changed: ${this.lastSpeakerId || "none"} -> ${speakerId}`,
      );
      this.lastSpeakerId = speakerId;
    }

    this.logger.info(
      `Processing transcript: "${text.substring(0, 50)}..." (final: ${isFinal}, speaker: ${
        speakerId || "unknown"
      }, changed: ${speakerChanged})`,
    );

    // Process using the new formatter
    const result = this.formatter.processTranscription(
      text,
      isFinal,
      speakerId,
      speakerChanged,
    );

    this.logger.info(
      `Formatted for display: "${result.displayText.substring(0, 100)}..."`,
    );
    this.showOnGlasses(result.displayText, isFinal);
    this.resetInactivityTimer();
  }

  private showOnGlasses(text: string, isFinal: boolean): void {
    const cleaned = this.cleanTranscriptText(text);
    const lines = cleaned.split("\n");

    this.logger.info(
      `Showing on glasses: "${cleaned.substring(0, 100)}..." (final: ${isFinal}, duration: ${
        isFinal ? "20s" : "indefinite"
      })`,
    );

    // Send to glasses
    try {
      this.userSession.appSession.layouts.showTextWall(cleaned, {
        view: ViewType.MAIN,
        durationMs: isFinal ? 20000 : undefined,
      });
    } catch (err) {
      this.logger.warn(
        { err },
        "Failed to show on glasses - connection may be closed",
      );
    }

    // Broadcast to webview preview
    this.userSession.transcripts.broadcastDisplayPreview(
      cleaned,
      lines,
      isFinal,
    );
  }

  private cleanTranscriptText(text: string): string {
    // Remove leading punctuation marks (both Western and Chinese)
    // Western: . , ; : ! ?
    // Chinese: 。 ， ； ： ！ ？
    // But preserve speaker labels like [1]: at the start of lines
    return text
      .split("\n")
      .map((line) => {
        // Check if line starts with speaker label [N]:
        const speakerLabelMatch = line.match(/^\[\d+\]:\s*/);
        if (speakerLabelMatch) {
          // Preserve the label, clean the rest
          const label = speakerLabelMatch[0];
          const rest = line.substring(label.length);
          return label + rest.replace(/^[.,;:!?。，；：！？]+/, "").trim();
        }
        // No speaker label, clean normally
        return line.replace(/^[.,;:!?。，；：！？]+/, "").trim();
      })
      .join("\n");
  }

  private resetInactivityTimer(): void {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
    }

    // Clear transcript processor history after 40 seconds of inactivity
    this.inactivityTimer = setTimeout(() => {
      this.logger.info(
        "Clearing transcript formatter history due to inactivity",
      );

      this.formatter.clear();
      this.lastSpeakerId = undefined; // Reset speaker tracking

      // Show empty state to clear the glasses display
      try {
        this.userSession.appSession.layouts.showTextWall("", {
          view: ViewType.MAIN,
          durationMs: 1000,
        });
      } catch (err) {
        this.logger.warn(
          { err },
          "Failed to clear glasses display - connection may be closed",
        );
      }
    }, 40000);
  }

  /**
   * Get the transcript history (for preserving across settings changes)
   */
  getFinalTranscriptHistory(): TranscriptHistoryEntry[] {
    return this.formatter.getFinalTranscriptHistory();
  }

  /**
   * Get the current display profile
   */
  getCurrentProfile(): DisplayProfile {
    return this.currentProfile;
  }

  /**
   * Get the current display width in pixels
   */
  getCurrentDisplayWidthPx(): number {
    return this.currentDisplayWidthPx;
  }

  /**
   * Check if character breaking (mid-word) is enabled
   * @deprecated Use isCharacterBreakingEnabled() instead
   */
  isWordBreakingEnabled(): boolean {
    return this.currentWordBreaking;
  }

  /**
   * Check if character breaking (mid-word, no hyphens) is enabled
   */
  isCharacterBreakingEnabled(): boolean {
    return this.currentWordBreaking;
  }

  /**
   * Set character breaking mode
   * @param enabled - true for character-level breaking, false for word-level only
   */
  setCharacterBreaking(enabled: boolean): void {
    if (this.currentWordBreaking !== enabled) {
      this.updateSettings(
        this.currentWidthSetting,
        this.currentMaxLines,
        enabled,
      );
    }
  }

  dispose(): void {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
    }

    if (this.deviceStateCleanup) {
      this.deviceStateCleanup();
      this.deviceStateCleanup = null;
    }
  }
}
