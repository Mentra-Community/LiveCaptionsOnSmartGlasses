# Log Cleanup

## Goal

Reduce captions app log volume. Previously producing ~4 million lines per 2 hours. The main offenders were info-level logs that fired on every transcription event, every display update, and every settings change.

## What was changed

### Removed entirely

**In `src/app/session/DisplayManager.ts`:**

- `processAndDisplay` logged the transcription text at info on every single transcript event. Removed entirely.
- `showOnGlasses` logged the display text at info every time something was sent to glasses. Removed entirely.
- `refreshDisplay` logged at info on every settings-triggered refresh. Removed entirely.
- `resetInactivityTimer` logged "Clearing transcript formatter history" at info. Removed entirely.
- Device model subscription callbacks logged at info on every callback. Removed entirely.
- Profile update and settings update logs. Removed entirely.
- Kept: warn/error on connection failures (showOnGlasses, refreshDisplay catch blocks).

**In `src/app/session/SettingsManager.ts`:**

- `initialize` logged all settings values at info. Removed entirely.
- `setLanguage`, `setLanguageHints`, `setDisplayLines`, `setDisplayWidth`, `setWordBreaking` all logged at info on every change. Removed entirely.
- `applyToProcessor` logged all settings being applied at info. Removed entirely.
- Kept: error on broadcast failure.

**In `src/app/session/TranscriptsManager.ts`:**

- `handleTranscription` logged the full transcription text, utteranceId, speakerId at info on every transcript event. Removed entirely. This fired multiple times per second per user and contained sensitive user speech content.

### Sensitive data removed from logs

- Transcript text content was present in multiple log messages across DisplayManager and TranscriptsManager. All instances removed.

### What was kept

- Session start and session stop logs
- Errors and warnings (connection failures, broadcast failures)

## What was NOT changed

- No application logic was modified. Only log lines were removed.