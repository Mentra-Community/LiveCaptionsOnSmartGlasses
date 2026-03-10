# Timezone-Correct Timestamps in Live Captions

## Problem

Transcript timestamps shown in the webview are wrong for most users. The
`formatTimestamp()` method in `TranscriptsManager.ts` calls `date.getHours()` /
`date.getMinutes()` — which uses the **server's local time** (UTC on prod
infrastructure), not the user's local time.

A user in New York (UTC-5) sees "4:32 PM" when their phone says "11:32 PM".

```typescript
// Current broken implementation
private formatTimestamp(date: Date): string {
  const hours = date.getHours()       // ← server local time (UTC on prod)
  const minutes = date.getMinutes()   // ← server local time (UTC on prod)
  ...
}
```

---

## Spike: How Does the SDK Expose Timezone?

The MentraOS cloud sends a `mentraosSettings` object to every connected app on
`CONNECTION_ACK` and whenever settings change. One of the keys is `userTimezone`
— an IANA timezone string like `"America/New_York"` that reflects the timezone
configured on the user's phone.

The SDK exposes it via `SettingsManager`:

```typescript
// Read once
const tz = session.settings.getMentraOS<string>("userTimezone")

// React to changes
session.settings.onMentraosChange<string>("userTimezone", (newTz) => {
  // update stored value
})
```

This is exactly the pattern used in the Dashboard app
(`DashboardServer.ts` L149 / L164).

### What if userTimezone is not set?

The setting may be absent on older phone app versions or if the user hasn't
granted timezone permission. In that case `getMentraOS` returns `undefined`.

Two fallback options:
1. **Server UTC** — what we do today (wrong for most users)
2. **Client-side formatting** — send the raw UTC epoch from the server and let
   the browser's `Intl.DateTimeFormat` convert it using `navigator.timeZone`

Option 2 is the better fallback because the browser always knows its own
timezone. Even without `userTimezone` from the SDK, the webview will show
correct local time as long as the user opens the webview on their phone (which
is always the case for this app).

---

## Design

### Where the fix lives

The timestamp is generated on the **server** in `TranscriptsManager.formatTimestamp()`.
It currently formats to a human-readable string before sending over SSE. Two
approaches:

#### Option A: Format on server with SDK timezone (current architecture)
- Pass `userTimezone` into `TranscriptsManager` at construction time
- `formatTimestamp` uses `Intl.DateTimeFormat` with the timezone
- Fallback: send raw ISO string, let client format

#### Option B: Send raw epoch, format on client ✅ Preferred
- Server sends `timestamp` as a Unix epoch ms integer (or ISO string)
- Webview formats it with `Intl.DateTimeFormat` using `navigator.timeZone`
- No timezone state to manage on the server at all
- Works correctly even if `userTimezone` setting is absent

Option B is simpler, more robust, and consistent with how web apps normally
handle this. The browser's `Intl.DateTimeFormat` with `navigator.timeZone` is
always correct for the device the webview is running on.

Option A is an enhancement on top of B: if the server knows `userTimezone` it
can validate/log, but the client should still do the formatting.

---

## Implementation Plan

### 1. `TranscriptsManager.ts` — send epoch instead of formatted string

Change `createEntry` to store the raw timestamp as an epoch number, and send
it over SSE as a number instead of a pre-formatted string:

```typescript
// TranscriptEntry: change timestamp type
timestamp: number | null   // Unix epoch ms (null for interim)

// createEntry:
timestamp: data.isFinal ? Date.now() : null,

// broadcast message:
timestamp: entry.timestamp,  // number or null — unchanged
```

The `formatTimestamp()` private method is deleted entirely.

### 2. `useTranscripts.ts` — update Transcript interface

```typescript
export interface Transcript {
  ...
  timestamp: number | null   // epoch ms, was string | null
}
```

No other changes needed in the hook — the raw number flows through unchanged.

### 3. `TranscriptItem.tsx` — format on the client

Replace the raw `transcript.timestamp` string display with a client-side
formatter:

```typescript
function formatTimestamp(epochMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    // undefined locale = browser default
    // no timeZone = navigator.timeZone (device local time) ✅
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(epochMs))
}

// In render:
{transcript.timestamp ? formatTimestamp(transcript.timestamp) : (transcript.isFinal ? "" : "Now")}
```

`Intl.DateTimeFormat` with no `timeZone` option defaults to the runtime
environment's timezone — which in a mobile webview is the **phone's timezone**,
always correct.

### 4. `UserSession.ts` / `SettingsManager` — store timezone (optional enhancement)

Even though the client handles formatting, it's still useful to store
`userTimezone` in the session for future server-side use (e.g., date headers
in the transcript list, "Today" / "Yesterday" grouping):

```typescript
// In UserSession.initialize():
const userTimezone = this.appSession.settings.getMentraOS<string>("userTimezone")
this.userTimezone = userTimezone || null

this.appSession.settings.onMentraosChange<string>("userTimezone", (tz) => {
  this.userTimezone = tz || null
})
```

This is low-cost and makes the timezone available if we ever need server-side
date formatting (e.g., showing "Tuesday 12:34 PM" vs just "12:34 PM").

---

## Files to Change

| File | Change |
|---|---|
| `src/app/session/TranscriptsManager.ts` | `timestamp` field → `number \| null`; delete `formatTimestamp()`; send epoch in `createEntry` and `broadcast` |
| `src/webview/hooks/useTranscripts.ts` | `Transcript.timestamp` type → `number \| null` |
| `src/webview/components/TranscriptItem.tsx` | Add `formatTimestamp(epochMs)` using `Intl.DateTimeFormat`; replace raw display |
| `src/app/session/UserSession.ts` | (Optional) Store `userTimezone` from `getMentraOS` + `onMentraosChange` |

---

## What This Does NOT Change

- The `displayPreview.timestamp` field is already a `number` (epoch) and is not
  displayed as a clock time — no change needed
- The existing SSE wire format is preserved (timestamp is already a field in the
  broadcast message, just changes from `string` to `number`)
- No SDK changes required — `userTimezone` is already available via
  `session.settings.getMentraOS("userTimezone")`
