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
const COUNT_KEY = 'sessionLogCount';
let currentSessionId = null;
let currentCount = null;
const consoleSendQueues = new Map();

const generateSessionId = (name) => {
  const baseName = name && name.trim() ? name.trim() : 'session';
  return `${baseName}-${new Date().toISOString()}`;
};

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

const enqueueConsoleSend = (key, payload) => {
  const prev = consoleSendQueues.get(key) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => sendPayloadWithRetry(payload, 'console log'));
  consoleSendQueues.set(key, next);
  next.finally(() => {
    if (consoleSendQueues.get(key) === next) {
      consoleSendQueues.delete(key);
    }
  });
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'get_enabled') {
    chrome.storage.local.get(
      {
        [ENABLED_KEY]: false,
        [SESSION_KEY]: null,
        [FILENAME_KEY]: '',
        [COUNT_KEY]: 0,
      },
      (items) => {
        sendResponse({
          enabled: Boolean(items[ENABLED_KEY]),
          sessionId: items[SESSION_KEY],
          filename: items[FILENAME_KEY],
          logCount: items[COUNT_KEY],
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
      const sessionId = generateSessionId(filename);
      currentSessionId = sessionId;
      currentCount = 1;
      chrome.storage.local.set(
        {
          [ENABLED_KEY]: true,
          [SESSION_KEY]: sessionId,
          [FILENAME_KEY]: filename,
          [COUNT_KEY]: 1,
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
        const nextCount = (currentCount || 0) + 1;
        currentCount = nextCount;
        chrome.storage.local.set({ [COUNT_KEY]: nextCount }, () => {});
        const endEntry = {
          source: 'tealium-extension-session',
          event: 'end - turned extension off',
          captured_at: new Date().toISOString(),
          session_id: sessionId,
          session_name: storedFilename || undefined,
        };
        chrome.storage.local.set(
          {
            [ENABLED_KEY]: false,
            [SESSION_KEY]: null,
            [FILENAME_KEY]: '',
          },
          () => {
            currentSessionId = null;
            currentCount = null;
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
      {
        [ENABLED_KEY]: false,
        [SESSION_KEY]: null,
        [FILENAME_KEY]: '',
        [COUNT_KEY]: 0,
      },
      (items) => {
        if (!items[ENABLED_KEY]) {
          return;
        }
      if (currentSessionId !== items[SESSION_KEY]) {
        currentSessionId = items[SESSION_KEY];
        currentCount = items[COUNT_KEY] || 0;
      }
        currentCount = (currentCount || 0) + 1;
        chrome.storage.local.set({ [COUNT_KEY]: currentCount }, () => {});
        const logEntry = {
          source: 'tealium-extension-console',
          url: (sender.tab && sender.tab.url) || '',
          captured_at: new Date().toISOString(),
          session_id: items[SESSION_KEY],
          session_name: items[FILENAME_KEY] || undefined,
          console: message.payload || {},
        };
        const queueKey = `${items[SESSION_KEY] || 'no-session'}::${logEntry.url}`;
        enqueueConsoleSend(queueKey, logEntry);
      }
    );
    return;
  }

  if (message.type === 'bridge_status') {
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
