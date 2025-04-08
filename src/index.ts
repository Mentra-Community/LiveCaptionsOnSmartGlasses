import path from 'path';
import {
  TpaServer,
  TpaSession,
  StreamType,
  ViewType,
  createTranscriptionStream,
  ExtendedStreamType,
  TranscriptionData,
} from '@augmentos/sdk';
import { TranscriptProcessor, languageToLocale, convertLineWidth } from './utils';
import axios from 'axios';

// Configuration constants
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 80;
const CLOUD_HOST_NAME = process.env.CLOUD_HOST_NAME || "cloud";
const PACKAGE_NAME = "com.augmentos.livecaptions";
const API_KEY = 'test_key'; // In production, this would be securely stored
const MAX_FINAL_TRANSCRIPTS = 5;

// User transcript processors map
const userTranscriptProcessors: Map<string, TranscriptProcessor> = new Map();
// Map to track the active language for each user
const userActiveLanguages: Map<string, string> = new Map();

// For debouncing transcripts per session
interface TranscriptDebouncer {
  lastSentTime: number;
  timer: NodeJS.Timeout | null;
}

/**
 * LiveCaptionsApp - Main application class that extends TpaServer
 */
class LiveCaptionsApp extends TpaServer {
  // Session debouncers for throttling non-final transcripts
  private sessionDebouncers = new Map<string, TranscriptDebouncer>();
  // Track active sessions by user ID
  private activeUserSessions = new Map<string, { session: TpaSession, sessionId: string }>();

  constructor() {
    super({
      packageName: PACKAGE_NAME,
      apiKey: API_KEY,
      port: PORT,
      publicDir: path.join(__dirname, './public'),
      // augmentOSWebsocketUrl: `ws://${CLOUD_HOST_NAME}/tpa-ws`
    });
  }

  /**
   * Called by TpaServer when a new session is created
   */
  protected async onSession(session: TpaSession, sessionId: string, userId: string): Promise<void> {
    console.log(`\n\n🗣️🗣️🗣️Received new session for user ${userId}, session ${sessionId}\n\n`);

    // Initialize transcript processor and debouncer for this session
    this.sessionDebouncers.set(sessionId, { lastSentTime: 0, timer: null });
    
    // Store the active session for this user
    this.activeUserSessions.set(userId, { session, sessionId });

    try {
      // Fetch and apply user settings (language, line width, etc.)
      await this.processSettings(userId, session, sessionId);

    } catch (error) {
      console.error('Error initializing session:', error);
      // Apply default settings if there was an error
      const transcriptProcessor = new TranscriptProcessor(30, 3, MAX_FINAL_TRANSCRIPTS);
      userTranscriptProcessors.set(userId, transcriptProcessor);
      
      // Subscribe with default language using the new method
      const cleanup = session.onTranscriptionForLanguage('en-US', (data: TranscriptionData) => {
        this.handleTranscription(session, sessionId, userId, data);
      });
      
      // Register cleanup handler
      this.addCleanupHandler(cleanup);
    }
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
    
    // Remove active session if it matches this session ID
    const activeSession = this.activeUserSessions.get(userId);
    if (activeSession && activeSession.sessionId === sessionId) {
      this.activeUserSessions.delete(userId);
    }
  }

  /**
   * Processes user settings - either fetches them from API or uses provided settings
   * Can be used for both initial session setup and settings updates
   */
  public async processSettings(
    userId: string,
    session?: TpaSession, 
    sessionId?: string, 
    providedSettings?: any[]
  ): Promise<any> {
    try {
      // If no session provided, try to find an active one
      if (!session || !sessionId) {
        console.log(`No session provided for user ${userId}, looking for active session`);
        const activeSession = this.getActiveSessionForUser(userId);
        
        if (activeSession) {
          console.log(`Found active session ${activeSession.sessionId} for user ${userId}, using it`);
          return this.processSettings(userId, activeSession.session, activeSession.sessionId, providedSettings);
        } else {
          console.log(`No active session found for user ${userId}, cannot process settings`);
          return {
            status: 'Failed to process settings',
            error: 'No active session available',
            userId
          };
        }
      }
      
      let settings: any[] = providedSettings || [];
      
      // If settings aren't provided, fetch them from API
      if (!providedSettings) {
        console.log(`Fetching settings for user ${userId}`);
        const response = await axios.get(`http://${CLOUD_HOST_NAME}/tpasettings/user/${PACKAGE_NAME}`, {
          headers: { Authorization: `Bearer ${userId}` }
        });
        settings = response.data.settings;
        console.log(`Fetched settings for user ${userId}:`, settings);
      } else {
        console.log('Using provided settings for user:', userId);
      }
      
      // Extract settings
      const lineWidthSetting = settings.find(s => s.key === 'line_width');
      const numberOfLinesSetting = settings.find(s => s.key === 'number_of_lines');
      const transcribeLanguageSetting = settings.find(s => s.key === 'transcribe_language');

      // Process language setting - handle both direct updating and initial fetch cases
      let language: string;
      let locale: string;
      
      if (providedSettings) {
        // For updateSettings path
        locale = languageToLocale(transcribeLanguageSetting?.value) || 'en-US';
      } else {
        // For fetchAndApplySettings path
        language = transcribeLanguageSetting?.value || 'English';
        locale = languageToLocale(language);
      }

      // Get previous processor to check for language changes and preserve history
      const previousTranscriptProcessor = userTranscriptProcessors.get(userId);
      const previousLocale = userActiveLanguages.get(userId) || 'none';
      
      const languageChanged = previousLocale !== 'none' && previousLocale !== locale;
      
      // Store the current language
      userActiveLanguages.set(userId, locale);

      // Process line width
      let lineWidth = 30; // default
      const isChineseLanguage = locale.toLowerCase().startsWith('zh-') || locale.toLowerCase().startsWith('ja-');
      
      if (lineWidthSetting) {
        lineWidth = convertLineWidth(lineWidthSetting.value, isChineseLanguage);
      } else if (isChineseLanguage) {
        lineWidth = 10; // Special default for Chinese/Japanese
      }

      // Process number of lines
      let numberOfLines = 3; // default
      if (numberOfLinesSetting) {
        numberOfLines = Number(numberOfLinesSetting.value);
        if (isNaN(numberOfLines) || numberOfLines < 1) numberOfLines = 3;
      }

      console.log(`Applied settings for user ${userId}: language=${locale}, lineWidth=${lineWidth}, numberOfLines=${numberOfLines}, isChineseLanguage=${isChineseLanguage}`);

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
      if (session) {
        const formattedTranscript = newProcessor.getFormattedTranscriptHistory();
        this.showTranscriptsToUser(session, formattedTranscript, true);
      }

      // If we're in session context, set up transcription handler
      console.log(`Setting up transcription handlers for session ${sessionId}`);
      
      // Clean up previous handler if it exists
      // This would need to be implemented if we want to support language switching in a session
      
      const languageHandler = (data: TranscriptionData) => {
        this.handleTranscription(session, sessionId, userId, data);
      };

      // Subscribe to language-specific transcription
      const cleanup = session.onTranscriptionForLanguage(locale, languageHandler);
      
      // Register cleanup handler
      this.addCleanupHandler(cleanup);
      
      console.log(`Subscribed to transcriptions in ${locale} for user ${userId}`);

      // Return status for API endpoint response
      return {
        status: 'Settings processed successfully',
        languageChanged: languageChanged,
        transcriptsPreserved: !languageChanged,
        sessionUpdated: true
      };
    } catch (error) {
      console.error(`Error processing settings for user ${userId}:`, error);
      throw error;
    }
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
    let transcriptProcessor = userTranscriptProcessors.get(userId);
    if (!transcriptProcessor) {
      // Create default processor if none exists
      transcriptProcessor = new TranscriptProcessor(30, 3, MAX_FINAL_TRANSCRIPTS);
      userTranscriptProcessors.set(userId, transcriptProcessor);
    }

    const isFinal = transcriptionData.isFinal;
    const newTranscript = transcriptionData.text;
    const language = transcriptionData.language;

    console.log(`[Session ${sessionId}]: Received transcription in language: ${language}`);

    // Process the transcript
    transcriptProcessor.processString(newTranscript, isFinal);

    let textToDisplay;
    if (isFinal) {
      // Get formatted history for final transcripts
      textToDisplay = transcriptProcessor.getFormattedTranscriptHistory();
      console.log(`[Session ${sessionId}]: finalTranscriptCount=${transcriptProcessor.getFinalTranscriptHistory().length}`);
    } else {
      // For non-final, get combined history plus current partial transcript
      const combinedTranscriptHistory = transcriptProcessor.getCombinedTranscriptHistory();
      const textToProcess = `${combinedTranscriptHistory} ${newTranscript}`;
      textToDisplay = transcriptProcessor.getFormattedPartialTranscript(textToProcess);
    }

    // Log and debounce the display
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
    session.layouts.showTextWall(transcript, {
      view: ViewType.MAIN,
      // Use a fixed duration for final transcripts (20 seconds)
      durationMs: isFinal ? 20000 : undefined,
    });
  }

  // Helper method to get active session for a user
  public getActiveSessionForUser(userId: string): { session: TpaSession, sessionId: string } | null {
    return this.activeUserSessions.get(userId) || null;
  }
}

// Create and start the app
const liveCaptionsApp = new LiveCaptionsApp();

// Add settings endpoint
const expressApp = liveCaptionsApp.getExpressApp();
expressApp.post('/settings', async (req: any, res: any) => {
  try {
    const { userIdForSettings, settings } = req.body;

    if (!userIdForSettings || !Array.isArray(settings)) {
      return res.status(400).json({ error: 'Missing userId or settings array in payload' });
    }

    // Process settings - the method will find active session if available
    const result = await liveCaptionsApp.processSettings(userIdForSettings, undefined, undefined, settings);
    
    res.json(result);
  } catch (error) {
    console.error('Error in settings endpoint:', error);
    res.status(500).json({ error: 'Internal server error updating settings' });
  }
});

// Start the server
liveCaptionsApp.start().then(() => {
  console.log(`${PACKAGE_NAME} server running on port ${PORT}`);
}).catch(error => {
  console.error('Failed to start server:', error);
});