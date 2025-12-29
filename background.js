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

const getEnabled = () =>
  new Promise((resolve) => {
    chrome.storage.local.get({ [ENABLED_KEY]: false }, (items) => {
      resolve(Boolean(items[ENABLED_KEY]));
    });
  });

const setEnabled = (value) =>
  new Promise((resolve) => {
    chrome.storage.local.set({ [ENABLED_KEY]: value }, () => {
      resolve();
    });
  });

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
    getEnabled().then((enabled) => {
      sendResponse({ enabled });
    });
    return true;
  }

  if (message.type === 'set_enabled') {
    const enabled = Boolean(message.enabled);
    setEnabled(enabled).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === 'content_ready') {
    return;
  }

  if (message.type === 'console_log') {
    getEnabled().then((enabled) => {
      if (!enabled) {
        return;
      }
      const logEntry = {
        source: 'tealium-extension-console',
        url: (sender.tab && sender.tab.url) || '',
        captured_at: new Date().toISOString(),
        console: message.payload || {},
      };
      sendPayloadWithRetry(logEntry, 'console log');
    });
    return;
  }

  if (message.type === 'bridge_status') {
    getEnabled().then((enabled) => {
      if (!enabled) {
        return;
      }
      const statusEntry = {
        source: 'tealium-extension-status',
        url: (sender.tab && sender.tab.url) || '',
        captured_at: new Date().toISOString(),
        status: message.payload || {},
      };
      sendPayloadWithRetry(statusEntry, 'bridge status');
    });
    return;
  }

  if (message.type !== 'send_utag') {
    return;
  }
  getEnabled().then((enabled) => {
    if (!enabled) {
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
  });

  return true;
});
