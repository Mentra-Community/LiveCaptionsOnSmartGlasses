# Issue 004 — Import Display Profiles from SDK Instead of Local Package

## Problem

After the Hono SDK refactor (which removed the local `packages/display-utils` dependency),
`CaptionsFormatter.ts` failed to deploy with:

```
error: Cannot find module '@mentra/display-utils' from '/app/src/app/utils/CaptionsFormatter.ts'
```

The `Z100_PROFILE` and `NEX_PROFILE` were being imported from `@mentra/display-utils` — a
local workspace package that was removed from `package.json` in the refactor.

The band-aid fix was to inline both profiles directly into `CaptionsFormatter.ts` (~290 lines
of glyph width tables). This works but is wrong:

1. It duplicates data that already lives in `cloud/packages/display-utils`
2. Any update to a profile requires updating multiple places
3. It obscures what `CaptionsFormatter.ts` actually does

## Spike

### What `@mentra/sdk/display-utils` actually contains

`cloud/packages/sdk/src/display-utils.ts` is simply:

```typescript
export * from "@mentra/display-utils"
```

At build time, `bun build` bundles `@mentra/display-utils` (the workspace package) inline
into `dist/display-utils.js` since it's not in the `--external` list. The workspace package
at `cloud/packages/display-utils/` already has ALL profiles:

- `G1_PROFILE` + `G1_PROFILE_LEGACY` ✅
- `Z100_PROFILE` ✅ (measured from NotoSans-Regular.ttf at 21px — production ready)
- `NEX_PROFILE` ✅ (placeholder values, marked as such)
- `G2_PROFILE` ✅ (added with G2 hardware support)

Confirmed by inspecting the published `@mentra/sdk@3.0.0-hono.8`:

```
grep Z100_PROFILE dist/display-utils.js → found ✅
grep NEX_PROFILE  dist/display-utils.js → found ✅
grep G2_PROFILE   dist/display-utils.js → found ✅
```

So `@mentra/sdk/display-utils` **already exports everything** — the band-aid inline was
never necessary. The only thing that needs to change is the import line in
`CaptionsFormatter.ts`.

### Why did this work before?

Before the Hono refactor, `package.json` had:

```json
"@mentra/display-utils": "file:./packages/display-utils"
```

So `import { Z100_PROFILE } from "@mentra/display-utils"` resolved to the local copy.
After the refactor, that dep was removed (correctly — the Dockerfile no longer builds it),
but the import was never updated.

---

## Fix

Single change in `CaptionsFormatter.ts`:

**Before (band-aid):**
- 290 lines of inlined `Z100_GLYPH_WIDTHS`, `Z100_PROFILE`, `NEX_GLYPH_WIDTHS`, `NEX_PROFILE`
- `export { G1_PROFILE, G1_PROFILE_LEGACY }` (Z100/NEX exported from inline defs)

**After:**
```typescript
import {
  TextMeasurer,
  TextWrapper,
  DisplayHelpers,
  G1_PROFILE,
  G1_PROFILE_LEGACY,
  Z100_PROFILE,     // ← now from SDK
  NEX_PROFILE,      // ← now from SDK
  type DisplayProfile,
  type WrapOptions,
  type WrapResult,
} from "@mentra/sdk/display-utils";

export { G1_PROFILE, G1_PROFILE_LEGACY, Z100_PROFILE, NEX_PROFILE };
```

Delete the ~290 lines of inlined glyph tables and profile objects entirely.

---

## MACH1

Per product: Mach1 is the same hardware as Z100. `DisplayManager.ts` should use
`Z100_PROFILE` for Mach1 device type. No separate profile needed.

---

## Files Changed

| File | Change |
|---|---|
| `src/app/utils/CaptionsFormatter.ts` | Remove inlined profiles, import Z100/NEX from `@mentra/sdk/display-utils` |

---

## Out of Scope

- Adding profiles to the SDK source — they're already there via the workspace bundle
- G2 profile — hardware display specs unknown, skip for now
- NEX placeholder accuracy — tracked separately, not a live-captions concern