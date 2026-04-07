# SDK Display-Utils Integration Issue

## Problem Summary

The `@mentra/sdk@2.1.29-beta.1` exports `display-utils` as a subpath (`@mentra/sdk/display-utils`), but the TypeScript type declarations don't work correctly with this import path. This prevents apps from using the display utilities with proper type safety.

---

## Current Architecture

### Package Structure
```
MentraOS-2/cloud/packages/
├── sdk/                    # @mentra/sdk package
│   ├── src/
│   │   ├── index.ts
│   │   └── display-utils.ts  # Re-exports from display-utils package
│   └── dist/
│       ├── index.js
│       ├── index.d.ts
│       ├── display-utils.js   # Bundled display-utils
│       └── display-utils.d.ts # ❌ PROBLEM: declares wrong module name
│
└── display-utils/          # @mentra/display-utils package (separate)
    └── src/
        ├── index.ts
        ├── TextMeasurer.ts
        ├── TextWrapper.ts
        ├── DisplayHelpers.ts
        └── profiles/
            └── g1.ts
```

### SDK package.json exports
```json
{
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./display-utils": {
      "import": "./dist/display-utils.js",
      "types": "./dist/display-utils.d.ts"  // ← Points to wrong declaration format
    }
  }
}
```

---

## The Error

### What We're Trying to Do

In the captions app, we want to import display utilities from the SDK:

```typescript
import {
  TextMeasurer,
  TextWrapper,
  DisplayHelpers,
  G1_PROFILE,
  G1_PROFILE_LEGACY,
  type DisplayProfile,
} from "@mentra/sdk/display-utils";
```

### What Happens

**TypeScript Error:**
```
error TS2306: File '.../node_modules/@mentra/sdk/dist/display-utils.d.ts' is not a module.
```

### Root Cause

The generated `display-utils.d.ts` file uses **ambient module declaration** syntax:

```typescript
// dist/display-utils.d.ts (CURRENT - BROKEN)
declare module "@mentra/display-utils" {
  export interface DisplayProfile { ... }
  export class TextMeasurer { ... }
  // etc.
}
```

This declares types for a module named `"@mentra/display-utils"`, but:
1. That package doesn't exist on npm
2. We're importing from `"@mentra/sdk/display-utils"` (different path!)

TypeScript can't match the import path to the declared module name.

---

## Solution: Move display-utils Source INTO the SDK

Instead of bundling a separate package, include the display-utils source directly in the SDK.

### Proposed Structure

```
sdk/
├── src/
│   ├── index.ts                 # Main SDK exports
│   ├── display-utils.ts         # Subpath entry point (NEW)
│   │
│   ├── display-utils/           # Display utilities source (MOVED HERE)
│   │   ├── index.ts             # Exports everything
│   │   ├── TextMeasurer.ts
│   │   ├── TextWrapper.ts
│   │   ├── DisplayHelpers.ts
│   │   ├── types.ts             # Shared types
│   │   └── profiles/
│   │       ├── index.ts
│   │       └── g1.ts            # G1_PROFILE, G1_PROFILE_LEGACY
│   │
│   └── ... rest of SDK
│
├── dist/
│   ├── index.js
│   ├── index.d.ts
│   ├── display-utils.js         # Built from src/display-utils.ts
│   └── display-utils.d.ts       # ✅ Proper module types
│
└── package.json
```

### Entry Points

**`src/display-utils.ts`** (subpath entry):
```typescript
// Re-export everything from the display-utils folder
export * from "./display-utils/index";
```

**`src/display-utils/index.ts`**:
```typescript
export { TextMeasurer } from "./TextMeasurer";
export { TextWrapper } from "./TextWrapper";
export { DisplayHelpers } from "./DisplayHelpers";
export { G1_PROFILE, G1_PROFILE_LEGACY } from "./profiles";
export type {
  DisplayProfile,
  FontMetrics,
  WrapOptions,
  WrapResult,
  LineMetrics,
} from "./types";
```

### Build Configuration

**package.json exports:**
```json
{
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./display-utils": {
      "import": "./dist/display-utils.js",
      "types": "./dist/display-utils.d.ts"
    }
  }
}
```

**Build command** (update to include both entry points):
```bash
bun build src/index.ts src/display-utils.ts --outdir dist ...
```

**TypeScript** will generate proper `.d.ts` files:
```typescript
// dist/display-utils.d.ts (CORRECT - after fix)
export { TextMeasurer } from "./display-utils/TextMeasurer";
export { TextWrapper } from "./display-utils/TextWrapper";
// ... proper ES module exports
```

---

## Migration Steps

### 1. Copy display-utils source into SDK

```bash
# From MentraOS-2/cloud/packages/
cp -r display-utils/src/* sdk/src/display-utils/
```

### 2. Create subpath entry point

Create `sdk/src/display-utils.ts`:
```typescript
export * from "./display-utils/index";
```

### 3. Update SDK build scripts

In `sdk/package.json`, update the build to include both entry points:
```json
{
  "scripts": {
    "build:js": "bun build src/index.ts src/display-utils.ts --outdir dist ..."
  }
}
```

### 4. Remove special type bundling

The current build has special scripts to bundle display-utils types:
- `prebuild-display-utils-types`
- `bundle-display-utils-types`

These can be **removed** since TypeScript will generate correct types automatically.

### 5. Update package.json exports

Ensure exports point to the built files (should already be correct).

### 6. Test the build

```bash
cd sdk
bun run build
```

Verify `dist/display-utils.d.ts` contains proper ES module exports, NOT ambient module declarations.

### 7. Publish new beta version

```bash
npm version 2.1.30-beta.1
npm publish --tag beta
```

### 8. Update captions app

```bash
cd apps/live-captions
bun add @mentra/sdk@2.1.30-beta.1
```

Remove the local type declaration workaround (`src/types/display-utils.d.ts`).

---

## Verification

After the fix, this should work with full type safety:

```typescript
// In any app using the SDK
import {
  TextMeasurer,
  TextWrapper,
  DisplayHelpers,
  G1_PROFILE,
  G1_PROFILE_LEGACY,
  type DisplayProfile,
  type WrapResult,
} from "@mentra/sdk/display-utils";

// TypeScript should:
// ✅ Resolve types correctly
// ✅ Provide autocomplete
// ✅ Show proper JSDoc comments
// ✅ Catch type errors

const measurer = new TextMeasurer(G1_PROFILE);
const width = measurer.measureText("Hello"); // ✅ Returns number
```

---

## Alternative: Keep Separate Package

If you want to keep `@mentra/display-utils` as a separate package, you would need to:

1. **Publish it to npm** as `@mentra/display-utils`
2. **Add it as a dependency** of `@mentra/sdk`
3. **Re-export from SDK** with proper types

This is more complex and creates two packages to maintain. The recommended approach is to merge the source into the SDK.

---

## Files to Modify

### In SDK package:

| File | Action |
|------|--------|
| `src/display-utils.ts` | Create (new entry point) |
| `src/display-utils/` | Create directory, copy source |
| `package.json` | Update build scripts, remove type bundling |
| `scripts/bundle-display-utils-types.ts` | Delete (no longer needed) |

### In display-utils package:

| File | Action |
|------|--------|
| `*` | Can be deprecated/removed after SDK includes source |

---

## Current Workaround (Captions App)

Until the SDK is fixed, the captions app uses a local type declaration file:

**`src/types/display-utils.d.ts`**

This manually declares the types for `@mentra/sdk/display-utils`. It works but:
- Requires manual maintenance
- Types may drift from actual implementation
- Not a sustainable solution

**Remove this file** once SDK version with fix is published.