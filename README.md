# Jarvis Extension

Jarvis is a Chrome MV3 extension for Tealium debugging. It captures `utag.DB`
logs from the page context, inspects consent/CMP state, and exports a case file
from the side panel UI. Log capture now persists in extension storage; a local
server is optional for the "Send Utag" flow.

## Features

- Capture `utag.DB` logs in the page context (no console scraping).
- Per-tab sessions with strict tab isolation in the side panel.
- Tools tab for logger, consent monitor, storage snapshots, and more.
- Export tab to build a case file (logger + consent + iQ profile).
- Recent exports list with download actions.
- Optional local server for sending `utag` payloads.

## Project Layout

- `manifest.json` — Chrome extension manifest (MV3).
- `sidepanel.html`, `sidepanel.js` — primary side panel UI and workflow.
- `popup.html`, `popup.js` — legacy popup UI (secondary workflow).
- `content.js` — content script (page -> extension bridge).
- `console-bridge.js` — injected in page context to hook `utag.DB`.
- `background.js` — service worker, session handling, storage pipeline.
- `server.mjs` — optional local server for `send_utag`.
- `logs/` — log output when the local server is used.

## Requirements

- Chrome (or Chromium-based browser) with MV3 support.
- Node.js 18+ (only if you use the optional local server).

## Setup

1. Load the extension:
   - Open `chrome://extensions`
   - Enable Developer Mode
   - Click **Load unpacked**
   - Select this project folder

2. Optional local server (for `send_utag`):
   ```bash
   npm i express
   node server.mjs
   ```

## Usage

1. Open the side panel.
2. Go to the Logger card and start recording.
3. Inspect logs, consent, or storage snapshots as needed.
4. Use the Export tab to build and download a case file.

## Data Storage

- Session logs are stored in `chrome.storage.local` by session ID.
- Consent, storage, and iQ snapshots are stored per tab UUID.
- The optional local server writes log files under `logs/`.

## How It Works

- `console-bridge.js` wraps `utag.DB` in the page context and posts entries.
- `content.js` relays entries and consent snapshots to the service worker.
- `background.js` persists logs and session metadata in extension storage.
- `sidepanel.js` renders tools and builds the case file for export.
- `server.mjs` accepts `send_utag` payloads if you opt in.

## Configuration

- Local server endpoint: `http://localhost:3005`
- Update `server.mjs` and `popup.js` if you want a different host/port.

## Troubleshooting

- **No logs**: Ensure `utagdb=true` is set or `utag.DB` is actually firing.
- **Side panel shows 0 logs**: The counter tracks console logs plus session
  start/end markers.
- **Send Utag fails**: Start the local server or disable the flow.
- **Large sessions**: Long runs can grow `chrome.storage.local` usage.

## Notes

- The side panel is the primary workflow; the popup is legacy.
- Only the active tab is captured for each recording session.

## License

Private/internal use.
