import type { MentraSession } from "@mentra/sdk";
import { TranscriptsManager } from "./TranscriptsManager";
import { SettingsManager } from "./SettingsManager";
import { DisplayManager } from "./DisplayManager";
import { languageToLocale } from "../utils/languageLocale";

export class UserSession {
  static readonly userSessions: Map<string, UserSession> = new Map<
    string,
    UserSession
  >();
  readonly userId: string;
  readonly session: MentraSession;
  readonly logger: MentraSession["logger"];
  readonly transcripts: TranscriptsManager;
  readonly settings: SettingsManager;
  readonly display: DisplayManager;

  private transcriptionCleanup: (() => void) | null = null;

  constructor(session: MentraSession) {
    this.session = session;
    this.userId = session.userId!;
    this.logger = session.logger;
    this.transcripts = new TranscriptsManager(this);
    this.settings = new SettingsManager(this);
    this.display = new DisplayManager(this);
    UserSession.userSessions.set(this.userId, this);
  }

  /**
   * Initialize the user session with settings and transcription subscription.
   * Called after construction to set up the session.
   */
  async initialize(): Promise<void> {
    try {
      // Initialize settings first (loads from cloud storage)
      await this.settings.initialize();

      // Get language configuration from settings
      const language = await this.settings.getLanguage();
      const languageHints = await this.settings.getLanguageHints();
      const locale = languageToLocale(language);

      // Get display settings and update DisplayManager
      const displayWidth = await this.settings.getDisplayWidth();
      const displayLines = await this.settings.getDisplayLines();
      const wordBreaking = await this.settings.getWordBreaking();
      this.display.updateSettings(displayWidth, displayLines, wordBreaking);

      // Configure transcription with language hints
      if (languageHints.length > 0) {
        this.session.transcription.configure({
          languageHints,
        });
      }

      // Subscribe to transcription events with language filter
      // If "auto" mode, use "en-US" as fallback
      const subscriptionLocale = language === "auto" ? "en-US" : locale;

      this.transcriptionCleanup = this.session.transcription.forLanguage(
        subscriptionLocale,
        (data) => {
          this.transcripts.handleTranscription(data);
        },
      );

      this.logger.info(
        {
          language,
          locale: subscriptionLocale,
          hints: languageHints,
          displayLines,
          displayWidth,
        },
        `UserSession initialized with language ${language}`,
      );
    } catch (error) {
      this.logger.error(
        { error },
        "Error initializing UserSession, using fallback subscription",
      );

      // Fallback: subscribe with default language (en-US) and no hints
      this.transcriptionCleanup = this.session.transcription.forLanguage(
        "en-US",
        (data) => {
          this.transcripts.handleTranscription(data);
        },
      );
    }
  }

  dispose() {
    // Clean up transcription subscription
    if (this.transcriptionCleanup) {
      this.transcriptionCleanup();
      this.transcriptionCleanup = null;
    }

    this.transcripts.dispose();
    this.settings.dispose();
    this.display.dispose();
    UserSession.userSessions.delete(this.userId);
  }

  public static getUserSession(userId: string): UserSession | undefined {
    return UserSession.userSessions.get(userId);
  }
}
