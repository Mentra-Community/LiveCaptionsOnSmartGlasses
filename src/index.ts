import path from 'path';
import {
  TpaServer,
  TpaSession,
  StreamType,
  ViewType,
  TranscriptionData,
} from '@augmentos/sdk';
import { TranscriptProcessor, languageToLocale, convertLineWidth } from './utils';
import axios from 'axios';
import { convertToPinyin } from './utils/ChineseUtils';

// Configuration constants
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 80;
// const CLOUD_HOST_NAME = process.env.CLOUD_HOST_NAME;
const PACKAGE_NAME = process.env.PACKAGE_NAME;
const AUGMENTOS_API_KEY = process.env.AUGMENTOS_API_KEY; // In production, this would be securely stored
const MAX_FINAL_TRANSCRIPTS = 30;

// Verify env vars are set.
if (!AUGMENTOS_API_KEY) {
  throw new Error('AUGMENTOS_API_KEY environment variable is required.');
}
if (!PACKAGE_NAME) {
  throw new Error('PACKAGE_NAME environment variable is required.');
}
// if (!CLOUD_HOST_NAME) {
//   throw new Error('CLOUD_HOST_NAME environment variable is required.');
// }

// User transcript processors map
const userTranscriptProcessors: Map<string, TranscriptProcessor> = new Map();
// Map to track the active language for each user
const userActiveLanguages: Map<string, string> = new Map();

// For debouncing transcripts per session
interface TranscriptDebouncer {
  lastSentTime: number;
  timer: NodeJS.Timeout | null;
}

// For managing inactivity timers per session
interface InactivityTimer {
  timer: NodeJS.Timeout | null;
  lastActivityTime: number;
}

/**
 * LiveCaptionsApp - Main application class that extends TpaServer
 */
class LiveCaptionsApp extends TpaServer {
  // Session debouncers for throttling non-final transcripts
  private sessionDebouncers = new Map<string, TranscriptDebouncer>();
  // Track active sessions by user ID
  private activeUserSessions = new Map<string, { session: TpaSession, sessionId: string }>();
  // Inactivity timers for clearing text after 1 minute of no activity
  private inactivityTimers = new Map<string, InactivityTimer>();

  constructor() {
    super({
      packageName: PACKAGE_NAME!,
      apiKey: AUGMENTOS_API_KEY!,
      port: PORT,
      publicDir: path.join(__dirname, './public'),
    });
  }

  /**
   * Called by TpaServer when a new session is created
   */
  protected async onSession(session: TpaSession, sessionId: string, userId: string): Promise<void> {
    console.log(`\n\n🗣️🗣️🗣️Received new session for user ${userId}, session ${sessionId}\n\n`);

    // Initialize transcript processor and debouncer for this session
    this.sessionDebouncers.set(sessionId, { lastSentTime: 0, timer: null });
    
    // Initialize inactivity timer for this session
    this.inactivityTimers.set(sessionId, { timer: null, lastActivityTime: Date.now() });
    
    // Store the active session for this user
    this.activeUserSessions.set(userId, { session, sessionId });

    try {
      // Set up settings change handlers
      this.setupSettingsHandlers(session, sessionId, userId);
      
      // Apply initial settings
      await this.applySettings(session, sessionId, userId);

    } catch (error) {
      console.error('Error initializing session:', error);
      // Apply default settings if there was an error
      const transcriptProcessor = new TranscriptProcessor(30, 3, MAX_FINAL_TRANSCRIPTS);
      userTranscriptProcessors.set(userId, transcriptProcessor);
      
      // Subscribe with default language
      const cleanup = session.onTranscriptionForLanguage('en-US', (data: TranscriptionData) => {
        this.handleTranscription(session, sessionId, userId, data);
      });
      
      // Register cleanup handler
      this.addCleanupHandler(cleanup);
    }
  }

  /**
   * Set up handlers for settings changes
   */
  private setupSettingsHandlers(
    session: TpaSession,
    sessionId: string,
    userId: string
  ): void {
    // Handle line width changes
    session.settings.onValueChange('line_width', (newValue, oldValue) => {
      console.log(`Line width changed for user ${userId}: ${oldValue} -> ${newValue}`);
      this.applySettings(session, sessionId, userId);
    });

    // Handle number of lines changes
    session.settings.onValueChange('number_of_lines', (newValue, oldValue) => {
      console.log(`Number of lines changed for user ${userId}: ${oldValue} -> ${newValue}`);
      this.applySettings(session, sessionId, userId);
    });

    // Handle language changes
    session.settings.onValueChange('transcribe_language', (newValue, oldValue) => {
      console.log(`Transcribe language changed for user ${userId}: ${oldValue} -> ${newValue}`);
      this.applySettings(session, sessionId, userId);
    });
  }

  /**
   * Apply settings from the session to the transcript processor
   */
  private async applySettings(
    session: TpaSession,
    sessionId: string,
    userId: string
  ): Promise<void> {
    try {
      // Extract settings
      const language = session.settings.get<string>('transcribe_language', 'English');
      const locale = languageToLocale(language);
      const previousLanguage = userActiveLanguages.get(userId) || 'none';
      const languageChanged = previousLanguage !== 'none' && previousLanguage !== language;
      
      // Store the current language
      userActiveLanguages.set(userId, language);

      // Process line width
      const isChineseLanguage = language === 'Chinese (Hanzi)';
      let lineWidth: number;
      
      if (isChineseLanguage) {
        lineWidth = session.settings.get<number>('line_width', 10);
      } else {
        lineWidth = session.settings.get<number>('line_width', 30);
      }
      
      lineWidth = convertLineWidth(lineWidth.toString(), isChineseLanguage);

      // Process number of lines
      let numberOfLines = session.settings.get<number>('number_of_lines', 3);
      if (isNaN(numberOfLines) || numberOfLines < 1) numberOfLines = 3;

      console.log(`Applied settings for user ${userId}: language=${locale}, lineWidth=${lineWidth}, numberOfLines=${numberOfLines}, isChineseLanguage=${isChineseLanguage}`);

      // Get previous processor to check for language changes and preserve history
      const previousTranscriptProcessor = userTranscriptProcessors.get(userId);
      
      // Create new processor with the settings
      const newProcessor = new TranscriptProcessor(lineWidth, numberOfLines, MAX_FINAL_TRANSCRIPTS, isChineseLanguage);

      // Preserve transcript history if language didn't change and we have a previous processor
      if (!languageChanged && previousTranscriptProcessor) {
        const previousHistory = previousTranscriptProcessor.getFinalTranscriptHistory();
        for (const transcript of previousHistory) {
          newProcessor.processString(transcript, true);
        }
        console.log(`Preserved ${previousHistory.length} transcripts after settings change`);
      } else if (languageChanged) {
        console.log(`Cleared transcript history due to language change`);
      }

      // Update the processor
      userTranscriptProcessors.set(userId, newProcessor);

      // Show the updated transcript layout immediately with the new formatting
      const formattedTranscript = newProcessor.processString("", true);
      this.showTranscriptsToUser(session, formattedTranscript, true);

      // Set up transcription handler for the selected language
      console.log(`Setting up transcription handlers for session ${sessionId} with language ${locale}`);
      
      // Subscribe to language-specific transcription
      const languageHandler = (data: TranscriptionData) => {
        this.handleTranscription(session, sessionId, userId, data);
      };
      
      const cleanup = session.onTranscriptionForLanguage(locale, languageHandler);
      
      // Register cleanup handler
      this.addCleanupHandler(cleanup);
      
      console.log(`Subscribed to transcriptions in ${locale} for user ${userId}`);
      
    } catch (error) {
      console.error(`Error applying settings for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Resets the inactivity timer for a session and schedules text clearing
   */
  private resetInactivityTimer(session: TpaSession, sessionId: string, userId: string): void {
    const inactivityTimer = this.inactivityTimers.get(sessionId);
    if (!inactivityTimer) return;

    // Clear existing timer
    if (inactivityTimer.timer) {
      clearTimeout(inactivityTimer.timer);
    }

    // Update last activity time
    inactivityTimer.lastActivityTime = Date.now();

    // Schedule transcript processor clearing after 1 minute (60000ms)
    inactivityTimer.timer = setTimeout(() => {
      // console.log(`Clearing transcript processor history due to inactivity for session ${sessionId}`);
      
      // Clear the transcript processor's history
      const transcriptProcessor = userTranscriptProcessors.get(userId);
      if (transcriptProcessor) {
        // Clear the processor's history
        transcriptProcessor.clear();
        
        // Show empty state to user
        session.layouts.showTextWall("", {
          view: ViewType.MAIN,
          durationMs: 1000, // Brief display to clear the text
        });
        
        // console.log(`Transcript processor history cleared for user ${userId}`);
      }
    }, 40000);
  }

  /**
   * Called by TpaServer when a session is stopped
   */
  protected async onStop(sessionId: string, userId: string, reason: string): Promise<void> {
    console.log(`Session ${sessionId} stopped: ${reason}`);
    
    // Clean up session resources
    const debouncer = this.sessionDebouncers.get(sessionId);
    if (debouncer?.timer) {
      clearTimeout(debouncer.timer);
    }
    this.sessionDebouncers.delete(sessionId);
    
    // Clean up inactivity timer
    const inactivityTimer = this.inactivityTimers.get(sessionId);
    if (inactivityTimer?.timer) {
      clearTimeout(inactivityTimer.timer);
    }
    this.inactivityTimers.delete(sessionId);
    
    // Remove active session if it matches this session ID
    const activeSession = this.activeUserSessions.get(userId);
    if (activeSession && activeSession.sessionId === sessionId) {
      this.activeUserSessions.delete(userId);
    }

    // Clear all user-related data from global maps
    const transcriptProcessorRemoved = userTranscriptProcessors.delete(userId);
    const activeLanguageRemoved = userActiveLanguages.delete(userId);
    
    // console.log(`Cleaned up user ${userId} data: transcriptProcessor=${transcriptProcessorRemoved}, activeLanguage=${activeLanguageRemoved}`);
  }

  /**
   * Handles transcription data from the AugmentOS cloud
   */
  private handleTranscription(
    session: TpaSession, 
    sessionId: string, 
    userId: string, 
    transcriptionData: any
  ): void {
    // Reset inactivity timer when new transcription is received
    this.resetInactivityTimer(session, sessionId, userId);

    // console.log(`[Session ${JSON.stringify(transcriptionData)}]: Resetting inactivity timer`);

    let transcriptProcessor = userTranscriptProcessors.get(userId);
    if (!transcriptProcessor) {
      // Create default processor if none exists
      transcriptProcessor = new TranscriptProcessor(30, 3, MAX_FINAL_TRANSCRIPTS);
      userTranscriptProcessors.set(userId, transcriptProcessor);
    }

    const isFinal = transcriptionData.isFinal;
    // if (isFinal) {
    //   console.log(`[Session ${sessionId}]: Received final transcription`);
    //   return;
    // }
    let newTranscript = transcriptionData.text;
    const language = languageToLocale(transcriptionData.transcribeLanguage);

    console.log(`[Session ${sessionId}]: Received transcription in language: ${language}`);

    // Check if the language is Chinese and user has selected Pinyin format
    const activeLanguage = userActiveLanguages.get(userId);
    if (activeLanguage === 'Chinese (Pinyin)') {
      const pinyinTranscript = convertToPinyin(newTranscript);
      console.log(`[Session ${sessionId}]: Converting Chinese to Pinyin`);
      newTranscript = pinyinTranscript;
    }

    // Process the transcript and get the formatted text
    const textToDisplay = transcriptProcessor.processString(newTranscript, isFinal);
    console.log(`[Session ${sessionId}]: ${textToDisplay}`);
    console.log(`[Session ${sessionId}]: isFinal=${isFinal}`);

    this.debounceAndShowTranscript(session, sessionId, textToDisplay, isFinal);
  }

  /**
   * Debounces transcript display to avoid too frequent updates for non-final transcripts
   */
  private debounceAndShowTranscript(
    session: TpaSession,
    sessionId: string,
    transcript: string,
    isFinal: boolean
  ): void {
    const debounceDelay = 400; // in milliseconds
    let debouncer = this.sessionDebouncers.get(sessionId);
    
    if (!debouncer) {
      debouncer = { lastSentTime: 0, timer: null };
      this.sessionDebouncers.set(sessionId, debouncer);
    }

    // Clear any scheduled timer
    if (debouncer.timer) {
      clearTimeout(debouncer.timer);
      debouncer.timer = null;
    }

    const now = Date.now();

    // Show final transcripts immediately
    if (isFinal) {
      this.showTranscriptsToUser(session, transcript, isFinal);
      debouncer.lastSentTime = now;
      return;
    }

    // Throttle non-final transcripts
    if (now - debouncer.lastSentTime >= debounceDelay) {
      this.showTranscriptsToUser(session, transcript, false);
      debouncer.lastSentTime = now;
    } else {
      debouncer.timer = setTimeout(() => {
        this.showTranscriptsToUser(session, transcript, false);
        if (debouncer) {
          debouncer.lastSentTime = Date.now();
        }
      }, debounceDelay);
    }
  }

  /**
   * Displays transcript text in the AR view
   */
  private showTranscriptsToUser(
    session: TpaSession,
    transcript: string,
    isFinal: boolean
  ): void {
    const cleanedTranscript = this.cleanTranscriptText(transcript);

    session.layouts.showTextWall(cleanedTranscript, {
      view: ViewType.MAIN,
      // Use a fixed duration for final transcripts (20 seconds)
      durationMs: isFinal ? 20000 : undefined,
    });
  }

  /**
   * Cleans the transcript text by removing leading punctuation while preserving Spanish question marks
   * and Chinese characters
   */
  private cleanTranscriptText(text: string): string {
    // Remove basic punctuation marks (both Western and Chinese)
    // Western: . , ; : ! ?
    // Chinese: 。 ， ； ： ！ ？
    return text.replace(/^[.,;:!?。，；：！？]+/, '').trim();
  }

  /**
   * Helper method to get active session for a user
   */
  public getActiveSessionForUser(userId: string): { session: TpaSession, sessionId: string } | null {
    return this.activeUserSessions.get(userId) || null;
  }
}

// Create and start the app
const liveCaptionsApp = new LiveCaptionsApp();


// Start the server
liveCaptionsApp.start().then(() => {
  console.log(`${PACKAGE_NAME} server running on port ${PORT}`);
}).catch(error => {
  console.error('Failed to start server:', error);
});