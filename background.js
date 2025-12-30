async function sendPayload(payload) {
  const response = await fetch('http://localhost:3005/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  return response.ok;
}

const RETRY_DELAYS_MS = [250, 500, 1000];
const ENABLED_KEY = 'enabled';
const SESSION_KEY = 'sessionId';
const FILENAME_KEY = 'sessionFilename';

const generateSessionId = () =>
  `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

async function sendPayloadWithRetry(payload, label) {
  let lastError = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const ok = await sendPayload(payload);
      if (ok) {
        return true;
      }
      lastError = new Error('Non-OK response');
    } catch (err) {
      lastError = err;
    }

    if (attempt < RETRY_DELAYS_MS.length) {
      await new Promise((resolve) => {
        setTimeout(resolve, RETRY_DELAYS_MS[attempt]);
      });
    }
  }

  return false;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'get_enabled') {
    chrome.storage.local.get(
      { [ENABLED_KEY]: false, [SESSION_KEY]: null, [FILENAME_KEY]: '' },
      (items) => {
        sendResponse({
          enabled: Boolean(items[ENABLED_KEY]),
          sessionId: items[SESSION_KEY],
          filename: items[FILENAME_KEY],
        });
      }
    );
    return true;
  }

  if (message.type === 'set_enabled') {
    const enabled = Boolean(message.enabled);
    const filename =
      typeof message.filename === 'string' ? message.filename.trim() : '';
    if (enabled) {
      const sessionId = generateSessionId();
      chrome.storage.local.set(
        {
          [ENABLED_KEY]: true,
          [SESSION_KEY]: sessionId,
          [FILENAME_KEY]: filename,
        },
        () => {
          const startEntry = {
            source: 'tealium-extension-session',
            event: 'start - turned extension on',
            captured_at: new Date().toISOString(),
            session_id: sessionId,
            session_name: filename || undefined,
          };
          sendPayloadWithRetry(startEntry, 'session start').then(() => {
            sendResponse({ ok: true });
          });
        }
      );
      return true;
    }

    chrome.storage.local.get(
      { [SESSION_KEY]: null, [FILENAME_KEY]: '' },
      (items) => {
        const sessionId = items[SESSION_KEY];
        const storedFilename = items[FILENAME_KEY];
        const endEntry = {
          source: 'tealium-extension-session',
          event: 'end - turned extension off',
          captured_at: new Date().toISOString(),
          session_id: sessionId,
          session_name: storedFilename || undefined,
        };
        chrome.storage.local.set(
          { [ENABLED_KEY]: false, [SESSION_KEY]: null },
          () => {
            sendPayloadWithRetry(endEntry, 'session end').then(() => {
              sendResponse({ ok: true });
            });
          }
        );
      }
    );
    return true;
  }

  if (message.type === 'content_ready') {
    return;
  }

  if (message.type === 'console_log') {
    chrome.storage.local.get(
      { [ENABLED_KEY]: false, [SESSION_KEY]: null, [FILENAME_KEY]: '' },
      (items) => {
        if (!items[ENABLED_KEY]) {
          return;
        }
        const logEntry = {
          source: 'tealium-extension-console',
          url: (sender.tab && sender.tab.url) || '',
          captured_at: new Date().toISOString(),
          session_id: items[SESSION_KEY],
          session_name: items[FILENAME_KEY] || undefined,
          console: message.payload || {},
        };
        sendPayloadWithRetry(logEntry, 'console log');
      }
    );
    return;
  }

  if (message.type === 'bridge_status') {
    chrome.storage.local.get(
      { [ENABLED_KEY]: false, [SESSION_KEY]: null, [FILENAME_KEY]: '' },
      (items) => {
        if (!items[ENABLED_KEY]) {
          return;
        }
        const statusEntry = {
          source: 'tealium-extension-status',
          url: (sender.tab && sender.tab.url) || '',
          captured_at: new Date().toISOString(),
          session_id: items[SESSION_KEY],
          session_name: items[FILENAME_KEY] || undefined,
          status: message.payload || {},
        };
        sendPayloadWithRetry(statusEntry, 'bridge status');
      }
    );
    return;
  }

  if (message.type !== 'send_utag') {
    return;
  }
  chrome.storage.local.get(
    { [ENABLED_KEY]: false, [SESSION_KEY]: null, [FILENAME_KEY]: '' },
    (items) => {
      if (!items[ENABLED_KEY]) {
        sendResponse({ ok: false, error: 'Sending is disabled' });
        return;
      }

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        if (!activeTab || !activeTab.id) {
          sendResponse({ ok: false, error: 'No active tab' });
          return;
        }

        if (!activeTab.url || !activeTab.url.startsWith('http')) {
          sendResponse({ ok: false, error: 'Unsupported tab URL' });
          return;
        }

        const requestUtag = () => {
          chrome.tabs.sendMessage(
            activeTab.id,
            { type: 'get_utag' },
            async (result) => {
              if (chrome.runtime.lastError) {
                sendResponse({
                  ok: false,
                  error: chrome.runtime.lastError.message,
                });
                return;
              }

              const payload = {
                source: 'tealium-extension',
                url: activeTab.url || '',
                captured_at: new Date().toISOString(),
                session_id: items[SESSION_KEY],
                session_name: items[FILENAME_KEY] || undefined,
                utag: result && result.utag ? result.utag : {},
              };

              const ok = await sendPayloadWithRetry(payload, 'utag payload');
              if (ok) {
                sendResponse({ ok: true });
                return;
              }
              sendResponse({
                ok: false,
                error: 'Failed to send payload after retries',
              });
            }
          );
        };

        chrome.tabs.sendMessage(activeTab.id, { type: 'get_utag' }, () => {
          if (chrome.runtime.lastError) {
            chrome.scripting.executeScript(
              { target: { tabId: activeTab.id }, files: ['content.js'] },
              () => {
                if (chrome.runtime.lastError) {
                  sendResponse({
                    ok: false,
                    error: chrome.runtime.lastError.message,
                  });
                  return;
                }
                requestUtag();
              }
            );
            return;
          }
          requestUtag();
        });
      });
    }
  );

  return true;
});
