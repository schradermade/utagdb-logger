# CLAUDE.md - Jarvis Extension Technical Reference

## Project Overview

**Jarvis** is a Chrome MV3 (Manifest V3) extension designed for Tealium debugging and analysis. It captures `utag.DB` logs directly from the page context, inspects consent/CMP (Consent Management Platform) state across multiple vendors, collects storage snapshots, and exports comprehensive case files for debugging and support workflows.

**Primary Purpose:** Enable Tealium developers and support engineers to capture, inspect, and export debugging data without relying on console scraping or manual collection.

**Key Capabilities:**
- Real-time `utag.DB` log capture with session persistence
- Multi-vendor consent inspection (OneTrust, Cookiebot, Didomi, TrustArc, etc.)
- Storage snapshot (cookies, localStorage, sessionStorage, utag data)
- iQ Profile fetching with authentication
- Case file export with redaction options
- Tab-isolated data collection
- Side panel UI as primary workflow

## Architecture

### High-Level Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Web Page (Target Site)                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Page Context (MAIN world)                                │  │
│  │  - utag.js (Tealium Universal Tag)                        │  │
│  │  - console-bridge.js (injected, wraps utag.DB)            │  │
│  │    • Polls utag.db_log for new entries                    │  │
│  │    • Posts logs via window.postMessage                    │  │
│  │    • Tracks GPC signals                                   │  │
│  └────────────┬─────────────────────────────────────────────┘  │
│               │ window.postMessage                              │
│               ▼                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Isolated Context (ISOLATED world)                        │  │
│  │  - content.js                                             │  │
│  │    • Receives messages from console-bridge                │  │
│  │    • Collects consent from CMPs                           │  │
│  │    • Reads storage (cookies, localStorage, etc.)          │  │
│  │    • Manages tab UUIDs via sessionStorage                 │  │
│  └────────────┬─────────────────────────────────────────────┘  │
└───────────────┼─────────────────────────────────────────────────┘
                │ chrome.runtime.sendMessage
                ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Chrome Extension (MV3)                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  background.js (Service Worker)                           │  │
│  │  - Receives log entries from content scripts              │  │
│  │  - Persists to chrome.storage.local                       │  │
│  │  - Manages sessions (start/stop, metadata)                │  │
│  │  - Handles storage trimming (7MB threshold → 6MB target)  │  │
│  │  - Manages side panel state per tab                       │  │
│  └────────────┬─────────────────────────────────────────────┘  │
│               │ chrome.storage.local                            │
│               ▼                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  sidepanel.js / sidepanel.html (Primary UI)              │  │
│  │  - Guide, Tools, Export, Recent tabs                      │  │
│  │  - Logger preview (per-tab filtering)                     │  │
│  │  - Consent monitor (auto-refresh, 2s polling)             │  │
│  │  - iQ Profile fetcher (with token caching)                │  │
│  │  - Export builder with preview and redaction              │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  popup.js / popup.html (Legacy UI)                        │  │
│  │  - Basic start/stop controls                             │  │
│  │  - Secondary workflow (not primary)                       │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                │ Optional: send_utag flow
                ▼
┌─────────────────────────────────────────────────────────────────┐
│  server.mjs (Optional Local Server)                            │
│  - Express server on http://localhost:3005                     │
│  - Accepts payloads and writes to logs/ directory              │
│  - Buffers console logs by session/URL, flushes on end         │
└─────────────────────────────────────────────────────────────────┘
```

### Technology Stack

- **Manifest Version:** Chrome MV3
- **Languages:** Vanilla JavaScript (ES6+)
- **Storage:** chrome.storage.local (persistent extension storage)
- **Communication:** chrome.runtime.sendMessage, window.postMessage
- **Optional Server:** Node.js 18+, Express.js
- **UI Framework:** None (vanilla HTML/CSS/JS)

### Execution Contexts

1. **MAIN world (page context):** `console-bridge.js` runs here to access `window.utag` directly
2. **ISOLATED world (content script):** `content.js` runs here for security and access to chrome APIs
3. **Service Worker:** `background.js` manages state and storage
4. **Extension Pages:** `sidepanel.html`, `popup.html` for UI

## File Structure

```
utagdb-logger/
├── manifest.json              # Chrome MV3 manifest
├── background.js              # Service worker (session management, storage)
├── console-bridge.js          # MAIN world script (wraps utag.DB)
├── content.js                 # ISOLATED world script (relays data, consent)
├── sidepanel.html             # Primary UI (side panel)
├── sidepanel.js               # Side panel logic (2000+ LOC)
├── popup.html                 # Legacy popup UI
├── popup.js                   # Legacy popup logic
├── server.mjs                 # Optional local server (Express)
├── jarvis-robot.png           # Icon
├── jarvis-robot-extension.png # Extension icon
├── logs/                      # Server output directory (if server used)
├── README.md                  # User documentation
├── CONTEXT.md                 # Project architecture docs
├── OPERATOR_GUIDE.md          # User workflow guide
└── CLAUDE.md                  # This file (technical reference)
```

## Key Components

### 1. console-bridge.js (MAIN World)

**Purpose:** Run in page context to directly access `window.utag` and wrap `utag.DB`.

**Key Functions:**
- `isUtagDbEnabled()` - Checks if `utagdb=true` cookie or `utag.cfg.utagdb=true` is set
- `postLog(entry, meta)` - Posts log entries via `window.postMessage` to content script
- `drainDbLog()` - Polls `utag.db_log` array for new entries (every 1s)
- `wrapUtagDb()` - Wraps `utag.DB` function to intercept calls
- `ensureWrapped()` - Ensures wrapper is installed (runs every 1s)

**Message Types Sent:**
- `console_log` - Log entry with args, timestamp, sequence, db_index, db_generation
- `gpc_signal` - GPC (Global Privacy Control) value from navigator
- `gpc_response` - Response to GPC request from content script

**Message Types Received:**
- `set_enabled` - Enable/disable logging
- `set_utagdb_enabled` - Override utagdb flag
- `get_gpc` - Request current GPC value

**State Management:**
- `sequence` - Incremental log sequence number
- `enabled` - Whether logging is active
- `lastDbIndex` - Last index read from `utag.db_log`
- `dbGeneration` - Generation counter (resets if log array shrinks)
- `utagdbOverride` - Override for utagdb detection

### 2. content.js (ISOLATED World)

**Purpose:** Bridge between page context and extension, collect consent/storage data.

**Key Functions:**
- `getTabUuid()` - Generate/retrieve persistent UUID for tab (via sessionStorage)
- `collectStorageSnapshot()` - Capture cookies, localStorage, sessionStorage, utag data
- `collectConsentSnapshot()` - Async function to collect all consent signals (800+ LOC)
- `requestPageGpc()` - Request GPC value from page context via postMessage
- `parseCookieMap()` - Parse document.cookie into Map

**Consent Vendor Support:**
- OneTrust (OptanonConsent, OnetrustActiveGroups cookies)
- Cookiebot (window.Cookiebot object)
- CookieYes (cookieyes-consent cookie)
- Didomi (window.Didomi object)
- Digital Control Room (window._cookiereports)
- TrustArc (window.truste)
- Usercentrics (window.UC_UI)
- TCF (Transparency & Consent Framework via __tcfapi)
- USP (US Privacy String via __uspapi)
- GPC (navigator.globalPrivacyControl)
- Tealium Consent Integration (tci.* keys in utag.data)

**Message Types Handled:**
- `set_enabled` - Forward to page context
- `get_storage_map` - Return storage snapshot
- `get_tab_uuid` - Return tab UUID
- `get_consent_status` - Return consent snapshot
- `get_utag` - Return utag data
- `get_utagdb_cookie` - Check utagdb status
- `set_utagdb_cookie` - Set/clear utagdb cookie and config

**Consent Data Structure:**
```javascript
{
  url: string,
  captured_at: ISO timestamp,
  tab_uuid: string,
  gpc: { value: "On"|"Off"|"Unknown", tone: "ok"|null },
  required: { value: string, tone: string, signals: string[] },
  present: { value: string, tone: string, signals: string[] },
  state: { value: string, tone: string },
  categories: [{ name: string, accepted: boolean }],
  signals: [{ label: string, value: any }]
}
```

### 3. background.js (Service Worker)

**Purpose:** Manage sessions, persist logs, handle side panel state.

**Key Constants:**
```javascript
ENABLED_KEY = 'enabled'
SESSION_KEY = 'sessionId'
FILENAME_KEY = 'sessionFilename'
COUNT_KEY = 'sessionLogCount'
LAST_SESSION_KEY = 'lastSessionId'
LOGS_KEY_PREFIX = 'utagdbLogs:session:'
SESSION_META_PREFIX = 'utagdbSession:'
STORAGE_TRIM_THRESHOLD_BYTES = 7 * 1024 * 1024  // 7MB
STORAGE_TRIM_TARGET_BYTES = 6 * 1024 * 1024     // 6MB
```

**Key Functions:**
- `generateSessionId(name)` - Generate session ID: `${name}-${ISO timestamp}`
- `ensureStorageUnderLimit(protectedSessionIds)` - Trim old sessions when over 7MB
- `enqueueLogWrite(sessionId, entry)` - Queue log writes with serialization
- `enqueueConsoleSend(key, payload)` - Queue sends to optional local server
- `notifyActiveTabEnabled(enabled)` - Notify content script of enabled state
- `sendPayloadWithRetry(payload, label)` - Retry logic for server sends (250ms, 500ms, 1s delays)

**Message Handlers:**
- `get_enabled` - Return current enabled state, session info
- `set_enabled` - Start/stop session, create/update session metadata
- `console_log` - Append log entry to session (if enabled)
- `send_utag` - Send utag payload to local server (optional)
- `get_storage_map` - Proxy to content script
- `get_tab_uuid` - Proxy to content script
- `get_consent_status` - Proxy to content script
- `get_utagdb_cookie` - Proxy to content script
- `set_utagdb_cookie` - Proxy to content script

**Side Panel Management:**
- `setSidePanelForTab(tabId, enabled)` - Enable/disable side panel for specific tab
- `openSidePanelForTab(tabId)` - Open side panel for tab
- `closeSidePanelForTab(tabId)` - Close side panel for tab
- `syncSidePanelToTabs()` - Sync enabled state to all tabs
- Tracks enabled tabs in `enabledSidePanelTabs` Set
- Automatically closes side panel when switching to non-enabled tabs

**Session Metadata Structure:**
```javascript
{
  session_id: string,
  session_name: string | null,
  started_at: ISO timestamp,
  ended_at: ISO timestamp | null,
  observed_url: string | null
}
```

### 4. sidepanel.js / sidepanel.html (Primary UI)

**Purpose:** Main user interface for all extension features.

**UI Structure:**
```
┌─────────────────────────────────────────────────────────┐
│  Header: [Guide] [Tools] [Export] [Recent] [Robot Icon]│
├─────────────────────────────────────────────────────────┤
│  Guide Tab:                                             │
│  - End-to-end workflow instructions                     │
│  - Per-tool guides (Logger, Consent, iQ, Export)        │
│  - Export indicator legend                              │
├─────────────────────────────────────────────────────────┤
│  Tools Tab:                                             │
│  ┌───────────────────────────────────────────────────┐ │
│  │ [Logger] [Session] [Rules] [Payloads] [iQ] ...   │ │ (Horizontal scroll)
│  └───────────────────────────────────────────────────┘ │
│  Logger Card:                                           │
│  - utagdb cookie toggle with live indicator            │
│  - Start/Stop recording button                          │
│  - Log preview (pretty-printed JSON)                    │
│  - Line numbers per log entry (non-selectable)          │
│  Consent Monitor Card:                                  │
│  - Refresh button, auto-refresh on open                 │
│  - Required / Present / GPC / State indicators          │
│  - Category list with canonical labels                  │
│  - Signal list in code containers                       │
│  iQ Profile Card:                                       │
│  - Account, Profile, Username, API Key inputs           │
│  - Get Token button                                     │
│  - Include toggles + custom includes                    │
│  - Fetch Profile button                                 │
│  - Pretty preview with non-selectable line numbers      │
│  - Recent Clients list for quick fill                   │
│  Storage Card:                                          │
│  - Snapshot button                                      │
│  - Cookies, localStorage, sessionStorage, utag lists    │
│  - Search filter                                        │
├─────────────────────────────────────────────────────────┤
│  Export Tab:                                            │
│  - Include toggles (Logger, Consent, iQ)                │
│  - Redact options (URLs, signal values)                 │
│  - Refresh Preview button                               │
│  - Preview pane (pretty-printed, line-numbered)         │
│  - Estimated size display                               │
│  - Export Case File button                              │
├─────────────────────────────────────────────────────────┤
│  Recent Tab:                                            │
│  - Last 3 exported case files (metadata only)           │
│  - Download buttons for each                            │
└─────────────────────────────────────────────────────────┘
```

**Key State Variables:**
```javascript
currentTabId: number | null           // Active Chrome tab ID
currentTabUuid: string | null         // Active tab UUID from sessionStorage
storageSnapshotsByTab: Map<uuid, data>
consentSnapshotsByTab: Map<uuid, data>
consentCoreSignaturesByTab: Map<uuid, string>  // For deduping
iqSnapshotsByTab: Map<uuid, data>
iqTokensByTab: Map<uuid, token>
iqHostsByTab: Map<uuid, host>
iqAccountsByTab: Map<uuid, account>
iqProfilesByTab: Map<uuid, profile>
iqUsernamesByTab: Map<uuid, username>
iqKeysByTab: Map<uuid, apiKey>
```

**Key Functions:**
- `setActiveFeature(feature)` - Switch feature card, start/stop consent polling
- `setActiveTopTab(tab)` - Switch top-level tab
- `fetchConsentSnapshot(options)` - Request consent from content script, dedupe updates
- `startConsentPolling()` - Poll every 2s while Consent tab active
- `stopConsentPolling()` - Clear poll timer
- `toggleUtagdbCookie()` - Enable/disable utagdb cookie via content script
- `refreshExportPreview()` - Build export preview from latest data
- `exportCaseFile()` - Download case file as JSON
- `loadRecentExports()` - Load last 3 exports from storage

**Storage Keys (per-tab):**
```
consentSnapshot:tab:<uuid>
storageSnapshot:tab:<uuid>
iqProfileSnapshot:tab:<uuid>
```

**Storage Keys (global):**
```
exportHistory        // Array of last 3 export metadata
iqRecentInputs       // Last 5 iQ client inputs
```

**Export Case File Structure:**
```javascript
{
  exported_at: ISO timestamp,
  tab_url: string (optional, redacted if disabled),
  utagdb_logger: {
    session: { session_id, session_name, started_at, ended_at, observed_url },
    logs: string[],         // Array of log entries (strings)
    log_count: number
  } | null,
  consent_monitor: {
    // Consent snapshot data (see content.js structure)
  } | null,
  iq_profile: {
    // iQ profile JSON
  } | null
}
```

### 5. server.mjs (Optional Local Server)

**Purpose:** Optional Express server to receive and log payloads to file system.

**Configuration:**
- Port: 3005
- Base URL: http://localhost:3005
- Logs directory: `./logs/`
- Session logs: `./logs/sessions/<session-id>.log`

**Key Functions:**
- `handleConsolePayload(payload)` - Buffer console logs by session+URL
- `flushConsoleBuffer(key)` - Sort and write buffered logs
- `writePayload(payload)` - Append to log files (raw + pretty)
- `getLogPaths(payload)` - Determine log file paths by session

**Payload Types:**
- `source: 'tealium-extension-console'` - Console log (buffered)
- `source: 'tealium-extension-session'` with `event: 'end'` - Session end (flush buffer)
- Other payloads - Written immediately

**Buffering Strategy:**
- Console logs are buffered per `<session-id>::<url>`
- Sorted by `db_generation * 1_000_000_000 + db_index` (or sequence)
- Flushed on session end event or other payload types

## Data Flow

### 1. Log Capture Flow

```
1. User visits page with utag.js
2. console-bridge.js wraps utag.DB
3. utag.DB is called → wrapper intercepts
4. wrapper drains utag.db_log array
5. postMessage to content.js with log entries
6. content.js forwards to background.js via chrome.runtime.sendMessage
7. background.js appends to chrome.storage.local
   - Key: utagdbLogs:session:<sessionId>
   - Value: Array of log strings
8. sidepanel.js reads from storage on demand
9. Logs filtered by tab UUID for display
```

### 2. Consent Capture Flow

```
1. User opens side panel, navigates to Consent Monitor
2. sidepanel.js sends get_consent_status to background.js
3. background.js proxies to content.js for active tab
4. content.js calls collectConsentSnapshot() (async)
   - Checks window.Cookiebot, window.Didomi, etc.
   - Calls __tcfapi, __uspapi with timeouts
   - Requests GPC from page context via postMessage
   - Aggregates signals into structured format
5. content.js returns snapshot to background.js
6. background.js stores in chrome.storage.local
   - Key: consentSnapshot:tab:<uuid>
7. background.js returns to sidepanel.js
8. sidepanel.js renders consent UI
9. Auto-refresh every 2s while tab active
10. Deduping via core signature (required+present+state values)
```

### 3. iQ Profile Fetch Flow

```
1. User enters account, profile, username, API key
2. User clicks "Get Token"
3. sidepanel.js sends POST to:
   https://us-west-2-platform.tealiumiq.com/v3/auth/accounts/<account>/profiles/<profile>
   Body: { username, password: apiKey }
4. Response: { token: "...", refresh_token: "..." }
5. Token stored per-tab in iqTokensByTab Map
6. User selects includes and clicks "Fetch iQ Profile"
7. sidepanel.js sends GET to:
   https://us-west-2-platform.tealiumiq.com/v3/accounts/<account>/profiles/<profile>
   Query: includes=<comma-separated>
   Header: Authorization: Bearer <token>
8. Response: iQ profile JSON
9. Stored in chrome.storage.local
   - Key: iqProfileSnapshot:tab:<uuid>
10. Rendered in preview pane
11. Recent inputs (last 5) stored globally in iqRecentInputs
```

### 4. Export Flow

```
1. User configures include/redact options
2. User clicks "Refresh Preview"
3. sidepanel.js reads from storage:
   - Latest session logs (utagdbLogs:session:<lastSessionId>)
   - Session metadata (utagdbSession:<lastSessionId>)
   - Consent snapshot for current tab
   - iQ snapshot for current tab
4. sidepanel.js builds case file object
5. Applies redactions if enabled (URLs, signal values)
6. Pretty-prints for preview display
7. User clicks "Export Case File"
8. sidepanel.js creates Blob, triggers download
9. Export metadata saved to exportHistory (last 3)
```

## Storage Management

### Chrome Storage Schema

**Global Keys:**
```
enabled: boolean
sessionId: string | null
sessionFilename: string
sessionLogCount: number
lastSessionId: string | null
exportHistory: Array<ExportMetadata>
iqRecentInputs: Array<IqClientInput>
```

**Session Keys:**
```
utagdbLogs:session:<sessionId>: string[]
utagdbSession:<sessionId>: SessionMetadata
```

**Tab Keys:**
```
consentSnapshot:tab:<uuid>: ConsentSnapshot
storageSnapshot:tab:<uuid>: StorageSnapshot
iqProfileSnapshot:tab:<uuid>: IqProfile
```

### Storage Trimming

- Triggered when `chrome.storage.local.getBytesInUse() > 7MB`
- Target: trim down to 6MB
- Strategy:
  1. Get all session keys (utagdbLogs:session:*)
  2. Sort by started_at timestamp (oldest first)
  3. Exclude protected sessions (current session)
  4. Remove oldest sessions until under 6MB
  5. Remove both log and metadata keys

### Tab UUID Management

- Each tab gets a persistent UUID stored in `sessionStorage` under key `tealium_tab_uuid`
- Generated via `crypto.randomUUID()` or fallback
- Used to isolate data by tab (consent, storage, iQ)
- Persists across page reloads within the same tab session

## Message Protocol

### Background ↔ Content Script

**From Background to Content:**
```javascript
{ type: 'set_enabled', enabled: boolean }
{ type: 'get_storage_map' }
{ type: 'get_tab_uuid' }
{ type: 'get_consent_status' }
{ type: 'get_utag' }
{ type: 'get_utagdb_cookie' }
{ type: 'set_utagdb_cookie', enabled: boolean }
```

**From Content to Background:**
```javascript
{ type: 'content_ready', url: string }
{ type: 'console_log', payload: {...} }
{ type: 'bridge_status' }
```

### Content Script ↔ Page Context (via window.postMessage)

**From Console Bridge (MAIN) to Content (ISOLATED):**
```javascript
{
  source: 'tealium-extension',
  type: 'console_log',
  payload: string[],
  timestamp: ISO string,
  sequence: number,
  db_index: number,
  db_generation: number
}
{
  source: 'tealium-extension',
  type: 'gpc_signal',
  value: boolean | undefined
}
{
  source: 'tealium-extension',
  type: 'gpc_response',
  requestId: string,
  value: boolean | undefined
}
```

**From Content (ISOLATED) to Console Bridge (MAIN):**
```javascript
{
  source: 'tealium-extension',
  type: 'set_enabled',
  enabled: boolean,
  initial: boolean
}
{
  source: 'tealium-extension',
  type: 'set_utagdb_enabled',
  enabled: boolean
}
{
  source: 'tealium-extension',
  type: 'get_gpc',
  requestId: string
}
```

### Side Panel ↔ Background

**From Side Panel to Background:**
```javascript
{ type: 'get_enabled' }
{ type: 'set_enabled', enabled: boolean, filename: string }
{ type: 'get_tab_uuid', tabId: number }
{ type: 'get_consent_status', tabId: number }
{ type: 'get_storage_map', tabId: number }
{ type: 'get_utagdb_cookie', tabId: number }
{ type: 'set_utagdb_cookie', tabId: number, enabled: boolean }
```

**Response Format:**
```javascript
{ ok: boolean, ... }  // Success
{ ok: false, error: string }  // Failure
```

## Key Patterns and Conventions

### Naming Conventions

- **Functions:** camelCase (e.g., `getTabUuid`, `collectConsentSnapshot`)
- **Constants:** UPPER_SNAKE_CASE (e.g., `ENABLED_KEY`, `STORAGE_TRIM_THRESHOLD_BYTES`)
- **Variables:** camelCase (e.g., `currentTabId`, `storageData`)
- **DOM Elements:** camelCase with suffix (e.g., `recordButton`, `statusEl`)
- **CSS Classes:** kebab-case (e.g., `feature-nav`, `export-preview`)

### Error Handling

- Most operations use try-catch with silent failure or fallback
- Chrome API errors checked via `chrome.runtime.lastError`
- Async functions return `{ ok: boolean, error?: string }` pattern
- Consent collection uses Promise.race with timeouts (500ms for __tcfapi, __uspapi)

### State Management

- No global state framework (Redux, etc.)
- State stored in:
  1. `chrome.storage.local` for persistence
  2. Module-level variables (e.g., `currentTabId`, `enabled`)
  3. Maps for per-tab data (e.g., `consentSnapshotsByTab`)
- UI updates via direct DOM manipulation

### Async Patterns

- Promises preferred over callbacks where possible
- `chrome.runtime.sendMessage` wrapped in try-catch
- Queue-based serialization for writes (`enqueueLogWrite`, `enqueueConsoleSend`)
- Polling via `setInterval` for log draining and consent updates

### Security Considerations

- Logs stored as strings (not executable code)
- Consent data sanitized via `JSON.parse(JSON.stringify(value))`
- No eval() or innerHTML with user data
- Tab isolation ensures data doesn't leak between tabs

## Development Notes

### Build and Deployment

- No build step required (vanilla JS)
- Load unpacked in `chrome://extensions`
- Enable Developer Mode
- Point to project directory

### Testing Strategy

- Manual testing in Chrome DevTools
- Test with various Tealium implementations
- Test consent vendors on live sites
- Verify storage trimming with large sessions

### Git Conventions

- **NEVER include `Co-Authored-By` lines in commit messages**
- Use clear, descriptive commit messages
- Keep commits focused on single logical changes
- Reference issue numbers when applicable

### Known Limitations

1. Logging requires `utag.DB` to be present and active on the page
2. Long-running sessions can grow `chrome.storage.local` usage (mitigated by trimming)
3. Export uses latest session and active tab snapshot; no historical aggregation
4. Side panel must be manually opened per window
5. Consent detection depends on vendor implementation (may not detect all CMPs)
6. iQ Profile fetch requires valid credentials and network access

### Common Gotchas

1. **Context Confusion:** `console-bridge.js` runs in MAIN world (has access to page globals), `content.js` runs in ISOLATED world (no access to page globals, but has chrome APIs)
2. **Tab UUID vs Tab ID:** Tab ID is Chrome's internal ID (changes on navigation), Tab UUID is persistent per session (stored in sessionStorage)
3. **Session vs Tab:** A "session" is a recording session (start/stop), a "tab" is a browser tab
4. **Storage Keys:** Session logs use `sessionId`, other data uses `tab_uuid`
5. **Consent Deduping:** Uses core signature (required+present+state) to avoid flicker
6. **Side Panel State:** Managed via `enabledSidePanelTabs` Set, closes when switching to non-enabled tabs

### Future Enhancement Areas

1. Historical session browsing/comparison
2. Real-time log streaming (WebSocket)
3. Advanced filtering/search in logs
4. Export to CSV/XLSX formats
5. Diff view for consent changes
6. Network request capture (HAR export)
7. Rule evaluation simulator
8. Tag load timeline visualization

## Debugging Tips

### Enable Console Logging

Add `console.log()` statements in:
- `background.js` - Service worker console (chrome://serviceworker-internals)
- `content.js` - Tab console (DevTools for target page)
- `console-bridge.js` - Tab console (DevTools for target page)
- `sidepanel.js` - Side panel console (DevTools → Inspect side panel)

### Storage Inspection

```javascript
// In any extension context
chrome.storage.local.get(null, (items) => {
  console.log('All storage:', items);
});

// Check size
chrome.storage.local.getBytesInUse(null, (bytes) => {
  console.log('Storage size:', bytes, 'bytes');
});
```

### Message Flow Debugging

Add logging in message handlers:
```javascript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Received message:', message.type, message, sender);
  // ... handler logic
});
```

### Side Panel Debug Mode

Set `SIDE_PANEL_DEBUG = true` in `background.js` to enable verbose logging.

### Common Issues

**Logs not capturing:**
- Check if `utagdb=true` cookie is set
- Verify `utag.DB` exists on page
- Check if recording is enabled
- Inspect `utag.db_log` array in page console

**Consent not detected:**
- Check if CMP is loaded (e.g., `window.Cookiebot`)
- Try manual refresh after banner interaction
- Check console for errors in consent collection

**Export empty:**
- Verify data exists in respective tool previews
- Check include toggles in Export tab
- Inspect storage keys in DevTools

**Side panel won't open:**
- Ensure extension icon is clicked (not right-click menu)
- Check if tab URL is supported (http/https)
- Verify side panel permissions in manifest

## Manifest Configuration

```json
{
  "manifest_version": 3,
  "permissions": [
    "activeTab",      // Access to active tab
    "scripting",      // chrome.scripting API
    "storage",        // chrome.storage.local
    "tabs",           // chrome.tabs API
    "sidePanel",      // Side panel API
    "downloads"       // File download API
  ],
  "host_permissions": [
    "http://localhost:3005/*",  // Optional local server
    "http://*/*",               // All HTTP sites
    "https://*/*"               // All HTTPS sites
  ],
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["console-bridge.js"],
      "run_at": "document_start",
      "world": "MAIN"            // Access to page context
    },
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "run_at": "document_start"  // ISOLATED world (default)
    }
  ]
}
```

## API Endpoints

### iQ Platform (Tealium)

**Base URL:** `https://us-west-2-platform.tealiumiq.com`

**Authentication:**
```
POST /v3/auth/accounts/{account}/profiles/{profile}
Body: { username: string, password: string }
Response: { token: string, refresh_token: string }
```

**Profile Fetch:**
```
GET /v3/accounts/{account}/profiles/{profile}?includes={includes}
Header: Authorization: Bearer {token}
Response: iQ Profile JSON
```

**Includes Options:**
- `audiences`, `audiencestreams`, `audiencestores`, `badges`, `connectors`,
- `datacollection`, `datadiscovery`, `eventspecs`, `eventstore`, `events`,
- `extensions`, `feeds`, `load_rules`, `tags`, `templates`, `variables`,
- `vendorpresets`, `visitoridatadiscovery`, `visitoridlogging`

### Optional Local Server

**Base URL:** `http://localhost:3005`

**Send Payload:**
```
POST /
Body: { source: string, ... }
Response: { ok: true }
```

## Version History

- **0.1.0** - Initial release with side panel UI, consent monitoring, iQ profile fetch, export workflow

---

**Last Updated:** 2026-01-13

**Maintained by:** Claude (AI Assistant) for future reference
