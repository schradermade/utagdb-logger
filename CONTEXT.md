# Jarvis — Project Documentation

## Overview
Jarvis is a Chrome MV3 extension for Tealium debugging. It captures `utag.DB` logs from the page context, inspects consent/CMP state, and exports a case file that can be handed to an LLM or CSE. The primary UI is a dark, compact side panel with a Tools tab and an Export tab. A small optional local server exists for sending `utag` payloads, but log capture now persists in extension storage.

## Goals
- Capture `utag.DB` logs reliably from page context (not console scraping).
- Keep data scoped to the active tab (strict tab isolation in the side panel).
- Provide readable previews for logs and consent while preserving raw export integrity.
- Generate a single case file that bundles the latest logger and consent data.

## Architecture

### Extension (MV3)
- `manifest.json` — MV3 configuration, permissions, side panel, and app icons.
- `console-bridge.js` — Injected into the page (MAIN world). Wraps `utag.DB` and posts entries via `window.postMessage`.
- `content.js` — Runs at `document_start`; relays console logs and consent snapshots to the service worker, and provides tab UUIDs.
- `background.js` — Service worker that manages sessions, counts, and persists logs to `chrome.storage.local`.
- `sidepanel.html` / `sidepanel.js` — Side panel UI, feature switching, consent polling, and export preview.
- `popup.html` / `popup.js` — Legacy popup UI (secondary, not the primary workflow).

### Local Server (Optional)
- `server.mjs` — Express server used by the "Send Utag" path (not required for log storage). It accepts payloads at `http://localhost:3005`.

## Data Flow

### utag.DB Logger
1. `console-bridge.js` wraps `utag.DB`, polls `utag.db_log`, and posts new entries with `db_index` and `db_generation`.
2. `content.js` forwards the entries to the service worker with `tab_uuid`.
3. `background.js` writes entries into `chrome.storage.local` under:
   - `utagdbLogs:session:<sessionId>` (array of log entries)
   - `utagdbSession:<sessionId>` (session metadata)
4. Session start/end markers are inserted as log entries.
5. `sessionLogCount`, `sessionId`, and `lastSessionId` are updated for UI and export.

### Consent Monitor
- `content.js` collects consent data from supported CMPs and signals including:
  - OneTrust, Cookiebot, Didomi, Digital Control Room, TrustArc, Usercentrics
  - TCF (`__tcfapi`), USP (`__uspapi`), opt-out cookies, and GPC
- Snapshots are stored in `chrome.storage.local` under `consentSnapshot:tab:<uuid>`.
- `sidepanel.js` auto-refreshes consent on open and polls every 2 seconds while the Consent Monitor tab is active, deduping updates to prevent flicker.

### Storage Map
- A per-tab snapshot of cookies, local storage, session storage, and `utag` data is collected on demand and stored under `storageSnapshot:tab:<uuid>`.

### Export Case File
- Export tab builds a case file combining:
  - `utagdb_logger` (latest session logs + metadata)
  - `consent_monitor` (latest per-tab consent snapshot)
- Export supports toggles and redaction options for URLs and signal values.
- Preview is pretty-printed and line-numbered, but the exported JSON remains raw (no data shape changes).
- iQ Profile tab authenticates via `POST /v3/auth/accounts/<account>/profiles/<profile>` and fetches profile JSON from `us-west-2-platform` with `includes` parameters.

## UI Summary
- Fixed header with Tools/Export tabs and robot icon.
- Feature cards scroll horizontally; Tools view contains the logger and stubbed sections.
- Logger preview:
  - Pretty-printed JSON
  - Line numbers per log (not per line)
  - Numbers and separators are non-selectable for clean copy/paste
- iQ Profile view:
  - Token retrieval (username + API key)
  - Includes toggles + custom includes
  - Pretty preview with non-selectable line numbers
- Consent view:
  - Required / Present / GPC / State
  - Canonical category labels (e.g., `C0001: Strictly Necessary`)
  - Signal list in code-like containers

## Storage Keys
- `enabled`, `sessionId`, `sessionFilename`, `sessionLogCount`, `lastSessionId`
- `utagdbLogs:session:<sessionId>`
- `utagdbSession:<sessionId>`
- `consentSnapshot:tab:<uuid>`
- `storageSnapshot:tab:<uuid>`
- `iqProfileSnapshot:tab:<uuid>`

## Configuration
- `http://localhost:3005` is used by the optional `send_utag` workflow.
- Host permissions allow access to all URLs for consent and storage inspection.

## Known Limitations
- Logging requires `utag.DB` to be present and active on the page.
- Long-running sessions can grow `chrome.storage.local` usage.
- Export uses the latest session and active tab snapshot; historical aggregation is not yet implemented.

## Runbook
1. Load unpacked extension from this folder in `chrome://extensions`.
2. Open the side panel, start recording, and inspect logs/consent.
3. Use Export to generate a case file.
