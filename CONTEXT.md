# Tealium Debug Logger — Project Documentation

## Overview
This repository contains a Chrome MV3 extension and a small local Node server used to capture Tealium `utag.DB` debug logs from a single browser tab. The extension provides a focused workflow for starting/stopping a recording session, and each session writes to its own timestamped log file. The UI is intentionally minimal and dark‑mode oriented for quick use during debugging.

## Goals
- Capture `utag.DB` logs reliably from page context (not from console scraping).
- Limit capture to the tab where recording was started.
- Create one log file per recording session with a user‑defined name and ISO timestamp.
- Make logs easy to read and easy to parse (JSONL + pretty JSON).

## Architecture

### Extension (MV3)
- **`manifest.json`** — Declares MV3 extension, content scripts, permissions, and background service worker.
- **`console-bridge.js`** — Injected into the page context (MAIN world). Wraps `utag.DB` and posts entries via `window.postMessage`.
- **`content.js`** — Runs at `document_start`; relays `console-bridge` messages to the extension service worker.
- **`background.js`** — Service worker that manages sessions, counts, and forwards payloads to the local server.
- **`popup.html` / `popup.js`** — Popup UI for naming sessions and starting/stopping recording, plus display of status, destination, saved file name, and counts.

### Server
- **`server.mjs`** — Express server that accepts payloads and writes per‑session files to `logs/sessions/`. It writes both JSONL (`.log`) and pretty JSON (`.pretty.log`) and parses JSON strings in console arguments for readability.

## Data Flow
1. `console-bridge.js` wraps `utag.DB` once recording is enabled for the current tab.
2. Each `utag.DB` call is serialized and posted via `window.postMessage`.
3. `content.js` receives the message and forwards it to the service worker.
4. `background.js` stamps session metadata and sends it to the local server.
5. `server.mjs` writes the payload to a per‑session file and pretty log.

## Session Model
- A session starts when the user clicks **Start recording**.
- The session name is required and is used in filenames.
- Session files are named:

```
<session-name>-<ISO timestamp>.log
<session-name>-<ISO timestamp>.pretty.log
```

- A session ends when the user clicks **REC - Stop**.
- Session start/end entries are included in the log count.

## Logging and Files
- **JSONL log**: `logs/sessions/<name>-<timestamp>.log`
- **Pretty log**: `logs/sessions/<name>-<timestamp>.pretty.log`
- **Ordering**: console log entries are ordered by `sequence` with a 5‑second gap timeout in `server.mjs`.

### Sample Payload
```json
{
  "source": "tealium-extension-console",
  "url": "https://example.com/",
  "captured_at": "2025-12-30T03:22:20.247Z",
  "session_id": "demo-2025-12-30T03:22:20.233Z",
  "session_name": "demo",
  "console": {
    "timestamp": "2025-12-30T03:22:20.200Z",
    "args": [
      "send:443:MAPPINGS"
    ],
    "sequence": 42
  }
}
```

## UI Design
- Dark gray theme, minimal typography.
- Header bar spans the full width.
- Filename input is required and locked during recording.
- Recording state shows:
  - `Sending to: <endpoint>`
  - `Saving to log file: <full filename>`
  - `Logs sent: <count>`
- Completed state shows:
  - `SESSION COMPLETED`
  - `Sent to: <endpoint>`
  - `Saved to log file: <full filename>`
  - `Logs sent: <count>`

## Key Behaviors & Design Decisions
- **Page context hook**: `utag.DB` is wrapped in the MAIN world to capture actual Tealium debug output.
- **Tab scoping**: only the tab where recording was started is allowed to send logs.
- **Session isolation**: each recording session maps to its own output files.
- **No initial payload**: starting a session no longer auto‑sends a `utag` payload.
- **Counts**: live count is tracked in the background service worker and includes start/end entries.

## Configuration
- **Endpoint**: `http://localhost:3005`
- **Server body limit**: `1mb` (adjustable in `server.mjs`).
- **Sequence gap timeout**: `5s` (adjustable in `server.mjs`).

## How to Run

### Start the server
```bash
npm i express
node server.mjs
```

### Load the extension
- Open `chrome://extensions`.
- Enable **Developer mode**.
- Click **Load unpacked** and select this folder.

## File Reference
- `background.js` — session management, counting, request forwarding.
- `console-bridge.js` — `utag.DB` hook and serialization.
- `content.js` — message bridge to service worker.
- `popup.html` — UI markup and styles.
- `popup.js` — UI behavior and state management.
- `server.mjs` — local logging server.

## Known Limitations
- Logging depends on `utag.DB` being present and active on the page.
- If `utagdb=true` is not set, `utag.DB` may not emit logs.
- Session counts are stored in the service worker; a browser restart will reset in‑memory counters (storage keeps the latest count).

## Forward‑Looking Improvements
- Add a “Download latest log” button in the popup.
- Provide per‑session summaries (duration, total count, endpoints used).
- Add optional filtering for specific `utag` tag IDs.
- Add a lightweight health indicator for `utag.DB` availability.

## Change Log (High Level)
- Added MV3 extension with popup controls and tab‑scoped logging.
- Implemented sessionized logging with user‑defined filenames.
- Added local server with JSONL + pretty log output.
- Introduced ordered log output with sequence reordering.
- Removed bridge status payloads and auto‑utag payload on start.
