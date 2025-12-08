# Captions App Development Guide

## Commands
- **Dev**: `bun run dev` - Starts with hot reloading (watches src/index.ts)
- **Start**: `bun run start` - Builds webview then starts in development mode
- **Build Webview**: `bun run build:webview` - Compiles React frontend with Tailwind
- **Test**: `bun test src/app/utils` - Run unit tests
- **Ngrok**: `bun run ngrok` - Expose local server via ngrok

## Architecture

This app uses a **two-server hybrid architecture**:

1. **Express Server (Port 3333)** - "Front Door"
   - MentraOS AppServer integration
   - Authentication middleware
   - Session/webhook endpoints
   - SSE streaming endpoint (`/api/transcripts/stream`)
   - Proxies unmatched routes to Bun

2. **Bun Server (Port 3334)** - "Backend"
   - React webview with hot reload
   - REST API routes
   - JSX/Tailwind processing

## Project Structure

```
src/
├── index.ts              # Main entry - coordinates both servers
├── api/                  # Bun API routes
│   ├── routes.ts         # Route definitions
│   ├── auth-helpers.ts   # Auth utilities
│   ├── settings.ts       # Settings endpoints
│   ├── transcripts.ts    # Transcripts endpoints
│   └── transcripts-stream.ts
├── app/                  # MentraOS App Logic
│   ├── index.ts          # LiveCaptionsApp class (AppServer)
│   ├── session/          # Session managers
│   │   ├── UserSession.ts
│   │   ├── TranscriptsManager.ts
│   │   ├── SettingsManager.ts
│   │   └── DisplayManager.ts
│   └── utils/            # App utilities
│       ├── CaptionsFormatter.ts
│       ├── ChineseUtils.ts
│       └── languageLocale.ts
└── webview/              # React Frontend
    ├── index.html        # Dev entry
    ├── index.prod.html   # Production entry
    ├── App.tsx           # Main component
    ├── frontend.tsx      # React root
    ├── components/       # UI components
    ├── hooks/            # React hooks (useTranscripts, useSettings)
    └── lib/              # Utilities (cn, etc.)
```

## Code Style Guidelines
- **TypeScript**: Strict mode enabled, ESNext target
- **Formatting**: Use Prettier defaults
- **Modules**: ES Modules (`"type": "module"`)
- **Imports**: Use `@/` alias for webview imports
- **Naming**: camelCase for variables/functions, PascalCase for classes/components
- **Types**: Always define return types and parameter types

## Key Patterns

### Manager Pattern
UserSession orchestrates three managers:
- `TranscriptsManager` - Handles transcription events, SSE broadcast
- `SettingsManager` - Cloud-persisted settings via SimpleStorage
- `DisplayManager` - Glasses display via CaptionsFormatter

### Authentication
- Express middleware sets `req.authUserId`
- Bun routes receive `x-auth-user-id` header (forwarded from Express)
- Use `requireAuth()` wrapper for protected Bun routes

### SSE Streaming
- Endpoint: `/api/transcripts/stream`
- Broadcasts: transcripts, display previews, settings updates
- Handled in Express (not proxied to Bun)

## Dependencies
- Runtime: @mentra/sdk, React 19, Radix UI, Tailwind
- Display: @mentra/sdk/display-utils (TextMeasurer, TextWrapper, G1_PROFILE)
- Chinese: @node-rs/jieba, pinyin-pro

## Environment Variables
- `PORT` - Server port (default: 3333)
- `PACKAGE_NAME` - MentraOS package name
- `MENTRAOS_API_KEY` - API key from console (required)
- `NODE_ENV` - development/production