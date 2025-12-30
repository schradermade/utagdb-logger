# Tealium Debug Logger Extension

A lightweight Chrome extension that captures `utag.DB` debug logs from a single tab and streams them to a local Node server for analysis. Each recording session writes to its own timestamped log file.

## Features

- Capture `utag.DB` logs in the page context (no console scraping).
- Start/stop recording from the popup UI.
- Per-session log files with user-defined names and ISO timestamps.
- Dark-mode popup UI with clear session status and counters.
- JSONL and pretty JSON logs for easy parsing.

## Project Layout

- `manifest.json` — Chrome extension manifest (MV3).
- `popup.html`, `popup.js` — popup UI and controls.
- `content.js` — content script (bridges page -> extension messages).
- `console-bridge.js` — injected in page context to hook `utag.DB`.
- `background.js` — service worker, session handling, logging pipeline.
- `server.mjs` — local server that writes logs to disk.
- `logs/` — log output (per-session in `logs/sessions/`).

## Requirements

- Chrome (or Chromium-based browser) with MV3 support.
- Node.js 18+ (for `fetch` and ESM `server.mjs`).

## Setup

1. Install dependencies for the server:

   ```bash
   npm i express
   ```

2. Start the server:

   ```bash
   node server.mjs
   ```

3. Load the extension:

   - Open `chrome://extensions`
   - Enable Developer Mode
   - Click **Load unpacked**
   - Select this project folder

## Usage

1. Open the popup.
2. Enter a session name (required).
3. Click **Start recording**.
4. Logs are written to:

   ```
   logs/sessions/<name>-<ISO timestamp>.log
   logs/sessions/<name>-<ISO timestamp>.pretty.log
   ```

5. Click **REC - Stop** to end the session. A summary is shown in the popup.

## Log Formats

- `.log` is JSON Lines (one JSON object per line).
- `.pretty.log` pretty-prints JSON and parses any JSON strings in `console.args`.

Example entry:

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

## How It Works

- `console-bridge.js` wraps `utag.DB` in the page context and posts each entry to the window.
- `content.js` relays those entries to the extension service worker.
- `background.js` tags entries with the active session info and forwards them to the local server.
- `server.mjs` writes one file per session and orders console logs by sequence.

## Configuration

- Endpoint: `http://localhost:3005`
- Update `server.mjs` and `popup.js` if you want a different host/port.

## Troubleshooting

- **No logs**: Ensure `utagdb=true` is set or `utag.DB` is actually firing on the page.
- **Popup shows 0 logs**: The counter tracks only console log entries, plus session start/end.
- **Payload too large**: Adjust `express.json({ limit: '1mb' })` in `server.mjs`.
- **Out of order logs**: The server reorders by sequence with a 5s gap timeout.

## Notes

- Only the tab where you start recording is captured.
- Session filenames are sanitized for filesystem safety.

## License

Private/internal use.
