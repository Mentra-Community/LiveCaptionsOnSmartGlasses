# SDK Reconnection State Mismatch Issue

## Problem Summary

When the SDK successfully reconnects after a disconnection, the app's `UserSession` may have already been disposed, causing a state mismatch where the SDK has a valid connection but the app has no session state.

This results in:
- `/api/transcripts` returning 404 (no active session)
- `/api/settings` returning 404
- Transcription events being received by the SDK but not processed by the app
- Webview showing "No active session" errors

---

## Observed Behavior

### Timeline from Logs (2025-12-15)

```
[10:08:43] Session active, transcripts working
[10:09:23] Inactivity timer fires, clears display
[10:09:34] "User session ended" received from cloud
[10:09:34] onStop called → UserSession.dispose() runs
[10:09:34] UserSession deleted from Map

... 9 minute gap (laptop sleep?) ...

[10:18:47] WebSocket closed with code 1006 (abnormal)
[10:18:47] isNormalClosure: false → SDK attempts reconnection
[10:18:48] ✅ Reconnection successful!
[10:18:48] SDK has valid AppSession, but app has no UserSession
[10:18:48+] /api/transcripts returns 404
```

### Console Errors (Webview)

```
[SSE] No active session
GET /api/transcripts 404 (Not Found)
GET /api/settings 404 (Not Found)
```

### Server Logs

```
[PROXY] GET /api/transcripts - authUserId: isaiahballah@gmail.com
Broadcasting display preview to 0 SSE clients
```

The SDK is receiving transcripts and trying to broadcast, but there are no SSE clients because the webview can't connect (404).

---

## Root Cause Analysis

### SDK's Reconnection Model

The SDK treats reconnection as "restoring the same session":

1. **On abnormal close (code 1006, etc.)**: SDK attempts to reconnect
2. **On successful reconnect**: SDK restores the `AppSession` WebSocket
3. **`onSession()` is NOT called again** - the SDK assumes the app still has the session

### App's Cleanup Model

The app disposes `UserSession` when `onStop` is called:

1. **`onStop` called**: `UserSession.dispose()` runs
2. **UserSession deleted from Map**: `UserSession.userSessions.delete(userId)`
3. **All state is gone**: transcripts, settings manager, display manager, SSE clients

### The Mismatch

| Component | State After Reconnection |
|-----------|-------------------------|
| SDK `AppSession` | ✅ Connected, working |
| App `UserSession` | ❌ Disposed, deleted |
| Webview API calls | ❌ 404 - no session found |

---

## When This Happens

### Confirmed Scenario

1. Laptop goes to sleep
2. Cloud sends "User session ended" (possibly due to timeout)
3. App receives it, calls `onStop`, disposes `UserSession`
4. Laptop wakes up
5. SDK detects broken WebSocket (code 1006)
6. SDK successfully reconnects
7. App has no `UserSession` for reconnected `AppSession`

### Potential Other Scenarios

- Network hiccup causes cloud to think session ended
- Cloud restart/redeploy
- Long network outage followed by recovery
- Race condition between session end and reconnection

---

## SDK Code Analysis

### WebSocket Close Handler (`AppSession`)

```javascript
// dist/index.js lines 3838-3857
const isNormalClosure = code === 1000 || code === 1001 || code === 1008;
const isManualStop = reason.includes("App stopped");
const isUserSessionEnded = reason.includes("User session ended");

if (!isNormalClosure && !isManualStop) {
  // Abnormal closure → attempt reconnection
  this.handleReconnection();
} else {
  // Normal closure → don't reconnect
}

if (isUserSessionEnded) {
  // Emit disconnected with sessionEnded: true
  this.events.emit("disconnected", {
    permanent: true,
    sessionEnded: true
  });
}
```

### AppServer's onDisconnected Handler

```javascript
// dist/index.js lines 5057-5075
session.events.onDisconnected((info) => {
  if (info.sessionEnded === true) {
    this.onStop(sessionId, userId, "User session ended");
  } else if (info.permanent === true) {
    this.onStop(sessionId, userId, `Connection permanently lost`);
  }
  
  // Always delete from maps
  this.activeSessions.delete(sessionId);
  this.activeSessionsByUserId.delete(userId);
});
```

### Missing: Reconnection Event

The SDK logs `✅ Reconnection successful!` but does NOT:
- Emit a `reconnected` event
- Call `onSession` again
- Notify the app in any way

---

## Proposed Solutions

### Option A: SDK Emits `reconnected` Event (Recommended)

**SDK Changes:**

```typescript
// In handleReconnection() after successful reconnect
async handleReconnection() {
  // ... existing reconnection logic ...
  
  await this.connect(this.sessionId);
  this.logger.debug(`✅ Reconnection successful!`);
  this.reconnectAttempts = 0;
  
  // NEW: Emit reconnected event
  this.events.emit("reconnected", {
    sessionId: this.sessionId,
    userId: this.userId
  });
}
```

**AppServer Changes:**

```typescript
// In handleSessionRequest() after setting up session
session.events.onReconnected(() => {
  this.logger.info(`🔄 Session ${sessionId} reconnected, re-calling onSession`);
  this.onSession(session, sessionId, userId);
});
```

**App Changes:**

```typescript
// In LiveCaptionsApp.onSession()
protected async onSession(session: AppSession, sessionId: string, userId: string) {
  // Check if UserSession already exists (reconnection case)
  let userSession = UserSession.getUserSession(userId);
  
  if (userSession) {
    // Reconnection - update the AppSession reference
    userSession.updateAppSession(session);
    await userSession.resubscribe();
  } else {
    // New session
    userSession = new UserSession(session);
    await userSession.initialize();
  }
}
```

### Option B: App Doesn't Dispose on `onStop`

Instead of disposing immediately, mark the session as "disconnected" and keep it around:

```typescript
protected async onStop(sessionId: string, userId: string, reason: string) {
  const userSession = UserSession.getUserSession(userId);
  if (userSession) {
    userSession.markDisconnected();  // Don't dispose yet
  }
}

// Later, if session reconnects, it's still there
// If session truly ends, add a timeout to dispose after N minutes
```

**Pros:** Simple app-side fix
**Cons:** Memory leak potential, state could go stale

### Option C: App Listens for `onDisconnected` Directly

Instead of relying on `onStop`, the app could listen to the raw disconnect events:

```typescript
protected async onSession(session: AppSession, sessionId: string, userId: string) {
  const userSession = new UserSession(session);
  
  session.events.onDisconnected((info) => {
    if (info.sessionEnded && info.permanent) {
      userSession.dispose();
    }
    // Otherwise, keep it around for potential reconnection
  });
}
```

**Pros:** More control over when to dispose
**Cons:** Duplicates logic that should be in SDK

---

## Recommended Approach

**Short-term (App-side workaround):**
- Don't dispose `UserSession` immediately in `onStop`
- Add a grace period (e.g., 60 seconds) before disposing
- If SDK reconnects within grace period, session is still usable

**Long-term (SDK fix):**
- Emit `reconnected` event from SDK
- AppServer can optionally re-call `onSession` or a new `onReconnected` handler
- Apps can choose how to handle reconnection

---

## Detection & Monitoring

To detect this state in production:

### Add Logging

```typescript
// In API routes
if (!userSession) {
  logger.warn({
    userId,
    activeSessions: Array.from(UserSession.userSessions.keys()),
    sdkConnected: ???  // Need way to check SDK connection state
  }, "API request for user without UserSession");
}
```

### Health Check Enhancement

```typescript
// Add to /health endpoint
{
  userSessions: UserSession.userSessions.size,
  sdkSessions: captionsApp.getActiveSessionCount(),
  mismatch: sdkSessions !== userSessions
}
```

---

## Related Files

- `src/app/index.ts` - `LiveCaptionsApp.onStop()`
- `src/app/session/UserSession.ts` - `UserSession.dispose()`
- `@mentra/sdk/dist/index.js` - lines 3838-3857 (close handler), 4350-4380 (reconnection)

---

## Status

- [x] Issue identified
- [x] Root cause analyzed
- [ ] Short-term workaround implemented
- [ ] SDK fix implemented
- [ ] Testing completed

---

## Notes

- This issue was first observed after laptop sleep/wake cycle
- May not occur in normal operation where disconnections are brief
- The 9-minute gap suggests unusual circumstances (sleep/network outage)
- Consider if this edge case is worth fixing or just documenting