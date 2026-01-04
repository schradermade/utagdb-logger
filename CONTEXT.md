# Jarvis — Project Documentation

## Overview
Jarvis is a Chrome MV3 extension for Tealium debugging. It captures `utag.DB` logs from the page context, inspects consent/CMP state, and exports a case file that can be handed to an LLM or CSE. The primary UI is a dark, compact side panel with Guide, Tools, Export, and Recent tabs. A small optional local server exists for sending `utag` payloads, but log capture now persists in extension storage.

## Goals
- Capture `utag.DB` logs reliably from page context (not console scraping).
- Keep data scoped to the active tab (strict tab isolation in the side panel).
- Provide readable previews for logs and consent while preserving raw export integrity.
- Generate a single case file that bundles the latest logger, consent, and iQ profile data (each optional).

## Architecture

### Extension (MV3)
- `manifest.json` — MV3 configuration, permissions, side panel, and app icons.
- `console-bridge.js` — Injected into the page (MAIN world). Wraps `utag.DB`, posts entries via `window.postMessage`, and responds to GPC requests from the content script.
- `content.js` — Runs at `document_start`; relays console logs and consent snapshots to the service worker, provides tab UUIDs, and requests page-context GPC for consent snapshots.
- `background.js` — Service worker that manages sessions, counts, and persists logs to `chrome.storage.local`.
- `sidepanel.html` / `sidepanel.js` — Side panel UI, feature switching, consent polling, export preview, and per-tab UI state handling.
- `popup.html` / `popup.js` — Legacy popup UI (secondary, not the primary workflow).

### Local Server (Optional)
- `server.mjs` — Express server used by the "Send Utag" path (not required for log storage). It accepts payloads at `http://localhost:3005`.

### High-Level Flow (Diagram)
```
Page (utag.js)
  └─ console-bridge.js (MAIN) ── window.postMessage ──┐
                                                      │
content.js (ISOLATED) ── chrome.runtime.sendMessage ───┼─► background.js
                                                      │    └─ chrome.storage.local
sidepanel.js ── chrome.runtime.sendMessage ───────────┘
  └─ Builds Case File + Previews
```

## Data Flow

### utag.DB Logger
1. `console-bridge.js` wraps `utag.DB`, polls `utag.db_log`, and posts new entries with `db_index` and `db_generation`.
2. `content.js` forwards the entries to the service worker with `tab_uuid`.
3. `background.js` writes entries into `chrome.storage.local` under:
   - `utagdbLogs:session:<sessionId>` (array of log entries)
   - `utagdbSession:<sessionId>` (session metadata)
4. Session start/end markers are inserted as log entries.
5. `sessionLogCount`, `sessionId`, and `lastSessionId` are updated for UI and export.
6. The side panel logger preview filters session logs by the active tab UUID.
7. Log entries are stored as strings (derived from `utag.DB` args) to reduce size.

### Consent Monitor
- `content.js` collects consent data from supported CMPs and signals including:
  - OneTrust, Cookiebot, Didomi, Digital Control Room, TrustArc, Usercentrics
  - TCF (`__tcfapi`), USP (`__uspapi`), opt-out cookies, and GPC
- Snapshots are stored in `chrome.storage.local` under `consentSnapshot:tab:<uuid>`.
- `sidepanel.js` auto-refreshes consent on open and polls every 2 seconds while the Consent Monitor tab is active, deduping updates to prevent flicker.
- GPC signals include both page-context and content-script values for comparison.

### Storage Map
- A per-tab snapshot of cookies, local storage, session storage, and `utag` data is collected on demand and stored under `storageSnapshot:tab:<uuid>`.

### Export Case File
- Export tab builds a case file combining:
  - `utagdb_logger` (latest session logs + metadata)
  - `consent_monitor` (latest per-tab consent snapshot)
  - `iq_profile` (latest per-tab iQ profile snapshot)
- Recent tab lists the last 3 exported case files (metadata only, no downloads).
- Export supports toggles and redaction options for URLs and signal values.
- Preview is pretty-printed and line-numbered, but the exported JSON remains raw (no data shape changes).
- iQ Profile tab authenticates via `POST /v3/auth/accounts/<account>/profiles/<profile>` and fetches profile JSON from `us-west-2-platform` with `includes` parameters.
- Recent iQ token inputs (last 5) are stored globally and can be applied with one click.
- Export preview shows estimated download size based on the raw JSON blob.

## UI Summary
- Fixed header with Guide/Tools/Export/Recent tabs and robot icon.
- Feature cards scroll horizontally; Tools view contains the logger and stubbed sections.
- Feature cards show hollow/green dots indicating whether that section has exportable data.
- Logger preview:
  - Pretty-printed JSON
  - Line numbers per log (not per line)
  - Numbers and separators are non-selectable for clean copy/paste
  - Includes an utagdb cookie toggle with a live indicator
- iQ Profile view:
  - Token retrieval (username + API key)
  - Includes toggles + custom includes
  - Pretty preview with non-selectable line numbers
  - Recent Clients list for quick form fill
- Consent view:
  - Required / Present / GPC / State
  - Canonical category labels (e.g., `C0001: Strictly Necessary`)
  - Signal list in code-like containers
- Guide view:
  - End-to-end workflow and per-tool instructions
  - Export indicator legend and tips

## Storage Keys
- `enabled`, `sessionId`, `sessionFilename`, `sessionLogCount`, `lastSessionId`
- `utagdbLogs:session:<sessionId>`
- `utagdbSession:<sessionId>`
- `consentSnapshot:tab:<uuid>`
- `storageSnapshot:tab:<uuid>`
- `iqProfileSnapshot:tab:<uuid>`
- `exportHistory`
- `iqRecentInputs`

## Configuration
- `http://localhost:3005` is used by the optional `send_utag` workflow.
- Host permissions allow access to all URLs for consent and storage inspection.

## Known Limitations
- Logging requires `utag.DB` to be present and active on the page.
- Long-running sessions can grow `chrome.storage.local` usage.
- Export uses the latest session and active tab snapshot; historical aggregation is not yet implemented.

## Storage Management
- When `chrome.storage.local` exceeds ~7MB, the extension trims older sessions down to ~6MB, preserving the current session.

## Runbook
1. Load unpacked extension from this folder in `chrome://extensions`.
2. Open the side panel, start recording, and inspect logs/consent.
3. Use Export to generate a case file.
