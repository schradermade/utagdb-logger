# Jarvis Operator Guide

## Purpose
Use Jarvis to capture Tealium debug data and export a single case file. All tools are optional; collect only what you need.

## Workflow Overview
1. Open the target site and keep that tab active.
2. Generate the data you want (logs, consent snapshots, iQ profile).
3. Confirm contents in Export Preview.
4. Export the case file.

## Tool Guides

### utag.DB Logs
1. Open the target site tab.
2. Enable the utagdb cookie if your site requires it.
3. Click Start Recording Logs.
4. Run your test flow.
5. Click Stop, then review Logs Preview.

Notes:
- If logs are empty, verify utagdb is enabled and utag.DB is firing.
- Logs are stored as strings to reduce export size.

### Consent Monitor
1. Open the target page and interact with the consent banner.
2. Click Refresh to capture a snapshot.
3. Verify consent state, GPC, and signals in the summary.

Notes:
- Consent data is scoped to the active tab.
- Refresh only after the banner interaction completes.

### iQ Profile
1. Enter account, profile, username, and API key.
2. Click Get Token.
3. Choose include options and click Fetch iQ Profile.
4. Review the Profile Preview.

Notes:
- Use exact account/profile values that match the site under test.
- Custom includes are supported for advanced snapshots.

### Export
1. Choose Include and Redact options.
2. Click Refresh Preview to verify content and size.
3. Click Export Case File to download.

Notes:
- Estimated size reflects the final download size.
- Recent Exports stores metadata only.

## Indicators
- Green dots under feature cards mean data from that section is present in the export.
- Hollow dots mean no data yet.

## Tab Behavior
- Data is isolated per browser tab.
- Keep the target tab active while collecting data.

## Troubleshooting
- No logs: ensure utagdb is enabled and utag.DB is firing.
- Consent empty: refresh after banner interaction completes.
- Export empty: confirm data exists in the relevant tool previews.
