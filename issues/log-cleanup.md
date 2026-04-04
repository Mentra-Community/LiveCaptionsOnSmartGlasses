# Log Cleanup

## Goal

Reduce captions app log volume. Currently producing ~4 million lines per 2 hours. The main offenders are info-level logs that fire on every transcription event, every display update, and every settings change.

## What to change

### Downgrade to debug

**In `src/app/session/DisplayManager.ts`:**

- `processAndDisplay` logs the transcription text at info on every single transcript event. This is the highest-volume log in the app. Downgrade to debug.
- `showOnGlasses` logs the display text at info every time something is sent to glasses. Downgrade to debug.
- `refreshDisplay` logs at info on every settings-triggered refresh. Downgrade to debug.
- `resetInactivityTimer` logs "Clearing transcript formatter history" at info. Downgrade to debug.

**In `src/app/session/SettingsManager.ts`:**

- `initialize` logs all settings values at info. Fine at debug.
- `setLanguage`, `setLanguageHints`, `setDisplayLines`, `setDisplayWidth` all log at info on every change. Downgrade to debug.
- `applyToProcessor` logs all settings being applied at info. Downgrade to debug.

**In `src/app/session/TranscriptsManager.ts`:**

- `handleTranscription` logs the full transcription text, utteranceId, speakerId at info on every transcript event. This should not be logged in production at all, or at most at debug level without the transcript text.

### Remove sensitive data from logs

- `handleTranscription` includes `text: transcriptData.text` in the log object. This is user speech content and should not be persisted in logs. Remove the text field from the log, or replace with a length indicator like `textLength: transcriptData.text.length`.
- `processAndDisplay` logs `"Processing transcript: \"${text.substring(0, 50)}...\""`. Same issue. Remove the text content.
- `showOnGlasses` logs `"Showing on glasses: \"${cleaned.substring(0, 100)}...\""`. Remove the text content.

### Keep at info

- Session start and session stop
- Errors
- Settings changes that affect user experience (keep one log per change, not multiple)

## What NOT to change

- Do not refactor the transcription pipeline or display logic. Just change log levels and remove sensitive content from log messages.