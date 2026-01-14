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

if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}
const enabledSidePanelTabs = new Set();
const SIDE_PANEL_DEBUG = true;
const sidePanelDebugLog = (...args) => {
  if (!SIDE_PANEL_DEBUG) {
    return;
  }
  console.log('[Jarvis side panel]', ...args);
};

const setSidePanelForTab = (tabId, enabled) => {
  if (!chrome.sidePanel || typeof chrome.sidePanel.setOptions !== 'function') {
    return;
  }
  sidePanelDebugLog('setOptions(tab)', { tabId, enabled });
  chrome.sidePanel.setOptions(
    {
      tabId,
      enabled: Boolean(enabled),
      path: enabled ? 'sidepanel.html' : undefined,
    },
    () => {}
  );
};

const openSidePanelForTab = (tabId) => {
  if (!tabId) {
    return;
  }
  if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function') {
    sidePanelDebugLog('open(tab)', { tabId });
    chrome.sidePanel.open({ tabId }).catch(() => {});
  } else {
    setSidePanelForTab(tabId, true);
  }
};

const closeSidePanelForTab = (tabId) => {
  if (!tabId) {
    return;
  }
  if (chrome.sidePanel && typeof chrome.sidePanel.close === 'function') {
    sidePanelDebugLog('close(tab)', { tabId });
    chrome.sidePanel.close({ tabId }).catch(() => {});
  } else {
    setSidePanelForTab(tabId, false);
  }
};

const closeSidePanelForWindow = (windowId, fallbackTabId) => {
  if (chrome.sidePanel && typeof chrome.sidePanel.close === 'function') {
    if (windowId) {
      sidePanelDebugLog('close(window)', { windowId });
      chrome.sidePanel.close({ windowId }).catch(() => {});
      return;
    }
    if (fallbackTabId) {
      closeSidePanelForTab(fallbackTabId);
    }
  }
};

const syncSidePanelToTabs = () => {
  if (!chrome.tabs || !chrome.tabs.query) {
    return;
  }
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((entry) => {
      if (!entry || !entry.id) {
        return;
      }
      setSidePanelForTab(entry.id, enabledSidePanelTabs.has(entry.id));
    });
  });
};

if (chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener((tab) => {
    if (!tab || !tab.id) {
      return;
    }
    const activeTabId = tab.id;
    enabledSidePanelTabs.clear();
    enabledSidePanelTabs.add(activeTabId);
    sidePanelDebugLog('action click', {
      tabId: activeTabId,
      windowId: tab.windowId,
      enabledTabs: Array.from(enabledSidePanelTabs),
    });
    setSidePanelForTab(activeTabId, true);
    syncSidePanelToTabs();
    openSidePanelForTab(activeTabId);
  });
}

if (chrome.tabs && chrome.tabs.onActivated) {
  chrome.tabs.onActivated.addListener((info) => {
    if (!info || !info.tabId) {
      return;
    }
    sidePanelDebugLog('tab activated', { tabId: info.tabId, windowId: info.windowId });
    chrome.tabs.get(info.tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        return;
      }
      sidePanelDebugLog('tab details', {
        tabId: tab.id,
        windowId: tab.windowId,
        enabledTabs: Array.from(enabledSidePanelTabs),
      });
      if (enabledSidePanelTabs.has(info.tabId)) {
        openSidePanelForTab(info.tabId);
      } else {
        closeSidePanelForWindow(tab.windowId, info.tabId);
        closeSidePanelForTab(info.tabId);
      }
    });
  });
}

if (chrome.tabs && chrome.tabs.onCreated) {
  chrome.tabs.onCreated.addListener((tab) => {
    if (!tab || !tab.id) {
      return;
    }
    sidePanelDebugLog('tab created', { tabId: tab.id, windowId: tab.windowId });
    setSidePanelForTab(tab.id, enabledSidePanelTabs.has(tab.id));
    if (!enabledSidePanelTabs.has(tab.id)) {
      closeSidePanelForTab(tab.id);
    }
  });
}

if (chrome.tabs && chrome.tabs.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId) => {
    if (!tabId) {
      return;
    }
    sidePanelDebugLog('tab updated', { tabId });
    setSidePanelForTab(tabId, enabledSidePanelTabs.has(tabId));
    if (!enabledSidePanelTabs.has(tabId)) {
      closeSidePanelForTab(tabId);
    }
  });
}

if (chrome.tabs && chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    enabledSidePanelTabs.delete(tabId);
  });
}

syncSidePanelToTabs();

const RETRY_DELAYS_MS = [250, 500, 1000];
const ENABLED_KEY = 'enabled';
const SESSION_KEY = 'sessionId';
const FILENAME_KEY = 'sessionFilename';
const COUNT_KEY = 'sessionLogCount';
const LAST_SESSION_KEY = 'lastSessionId';
const LOGS_KEY_PREFIX = 'utagdbLogs:session:';
const SESSION_META_PREFIX = 'utagdbSession:';
const STORAGE_TRIM_THRESHOLD_BYTES = 7 * 1024 * 1024;
const STORAGE_TRIM_TARGET_BYTES = 6 * 1024 * 1024;
let currentSessionId = null;
let currentCount = null;
const consoleSendQueues = new Map();
const logWriteQueues = new Map();

const getSessionLogKey = (sessionId) =>
  `${LOGS_KEY_PREFIX}${sessionId || 'no-session'}`;

const getSessionMetaKey = (sessionId) =>
  `${SESSION_META_PREFIX}${sessionId || 'no-session'}`;

const ensureStorageUnderLimit = (protectedSessionIds = []) =>
  new Promise((resolve) => {
    chrome.storage.local.getBytesInUse(null, (bytes) => {
      if (bytes <= STORAGE_TRIM_THRESHOLD_BYTES) {
        resolve();
        return;
      }
      chrome.storage.local.get(null, (items) => {
        const protectedIds = new Set(
          protectedSessionIds.filter((id) => typeof id === 'string' && id)
        );
        const sessions = Object.keys(items || {})
          .filter((key) => key.startsWith(LOGS_KEY_PREFIX))
          .map((key) => {
            const sessionId = key.slice(LOGS_KEY_PREFIX.length) || 'no-session';
            const metaKey = getSessionMetaKey(sessionId);
            const meta = items[metaKey] || {};
            const startedAt = meta.started_at || meta.ended_at || '';
            return {
              sessionId,
              logKey: key,
              metaKey,
              startedAt,
              hasMeta: Boolean(items[metaKey]),
            };
          })
          .filter((entry) => !protectedIds.has(entry.sessionId))
          .sort((left, right) =>
            String(left.startedAt).localeCompare(String(right.startedAt))
          );

        if (sessions.length === 0) {
          resolve();
          return;
        }

        const removeNext = () => {
          chrome.storage.local.getBytesInUse(null, (nextBytes) => {
            if (nextBytes <= STORAGE_TRIM_TARGET_BYTES) {
              resolve();
              return;
            }
            const next = sessions.shift();
            if (!next) {
              resolve();
              return;
            }
            const keys = [next.logKey];
            if (next.hasMeta) {
              keys.push(next.metaKey);
            }
            chrome.storage.local.remove(keys, () => {
              removeNext();
            });
          });
        };

        removeNext();
      });
    });
  });

const enqueueLogWrite = (sessionId, entry) => {
  const key = getSessionLogKey(sessionId);
  const prev = logWriteQueues.get(key) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() =>
      ensureStorageUnderLimit([sessionId, currentSessionId])
    )
    .then(
      () =>
        new Promise((resolve) => {
          chrome.storage.local.get({ [key]: [] }, (items) => {
            const logs = Array.isArray(items[key]) ? items[key] : [];
            logs.push(entry);
            chrome.storage.local.set({ [key]: logs }, () => resolve());
          });
        })
    );
  logWriteQueues.set(key, next);
  next.finally(() => {
    if (logWriteQueues.get(key) === next) {
      logWriteQueues.delete(key);
    }
  });
};

const notifyActiveTabEnabled = (enabled) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    if (!activeTab || !activeTab.id) {
      return;
    }
    chrome.tabs.sendMessage(activeTab.id, { type: 'set_enabled', enabled }, () => {
      // ignore errors when content script isn't injected yet
    });
  });
};

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
        [LAST_SESSION_KEY]: null,
      },
      (items) => {
        sendResponse({
          enabled: Boolean(items[ENABLED_KEY]),
          sessionId: items[SESSION_KEY],
          filename: items[FILENAME_KEY],
          logCount: items[COUNT_KEY],
          lastSessionId: items[LAST_SESSION_KEY] || null,
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
      notifyActiveTabEnabled(true);
      const sessionId = generateSessionId(filename);
      currentSessionId = sessionId;
      currentCount = 0;
      chrome.storage.local.set(
        {
          [ENABLED_KEY]: true,
          [SESSION_KEY]: sessionId,
          [FILENAME_KEY]: filename,
          [COUNT_KEY]: 0,
          [LAST_SESSION_KEY]: sessionId,
        },
        () => {
          const startedAt = new Date().toISOString();
          const sessionMetaKey = getSessionMetaKey(sessionId);
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const activeTab = tabs && tabs[0] ? tabs[0] : null;
            const observedUrl =
              activeTab && activeTab.url && activeTab.url.startsWith('http')
                ? activeTab.url
                : null;
            chrome.storage.local.set(
              {
                [sessionMetaKey]: {
                  session_id: sessionId,
                  session_name: filename || null,
                  started_at: startedAt,
                  ended_at: null,
                  observed_url: observedUrl,
                },
              },
              () => {
                sendResponse({ ok: true });
              }
            );
          });
        }
      );
      return true;
    }

    notifyActiveTabEnabled(false);
    chrome.storage.local.get(
      { [SESSION_KEY]: null, [FILENAME_KEY]: '' },
      (items) => {
        const sessionId = items[SESSION_KEY];
        const storedFilename = items[FILENAME_KEY];
        const endedAt = new Date().toISOString();
        chrome.storage.local.set(
          {
            [ENABLED_KEY]: false,
            [SESSION_KEY]: null,
            [FILENAME_KEY]: '',
          },
          () => {
            currentSessionId = null;
            currentCount = null;
            const sessionMetaKey = getSessionMetaKey(sessionId);
            chrome.storage.local.get({ [sessionMetaKey]: {} }, (items) => {
              const meta = items[sessionMetaKey] || {};
              chrome.storage.local.set(
                {
                  [sessionMetaKey]: {
                    ...meta,
                    session_id: sessionId || meta.session_id,
                    session_name: storedFilename || meta.session_name || null,
                    ended_at: endedAt,
                  },
                },
                () => {
                  sendResponse({ ok: true });
                }
              );
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

  if (message.type === 'get_storage_map') {
    const targetTabId = Number.isInteger(message.tabId) ? message.tabId : null;
    const withTab = (tab) => {
      if (!tab || !tab.id) {
        sendResponse({ ok: false, error: 'No active tab' });
        return;
      }
      if (!tab.url || !tab.url.startsWith('http')) {
        sendResponse({ ok: false, error: 'Unsupported tab URL' });
        return;
      }
      const requestSnapshot = () => {
        chrome.tabs.sendMessage(tab.id, { type: 'get_storage_map' }, (response) => {
          if (chrome.runtime.lastError) {
            sendResponse({
              ok: false,
              error: chrome.runtime.lastError.message,
            });
            return;
          }
          sendResponse(response || { ok: false, error: 'No response' });
        });
      };

      chrome.tabs.sendMessage(tab.id, { type: 'get_storage_map' }, () => {
        if (chrome.runtime.lastError) {
          chrome.scripting.executeScript(
            { target: { tabId: tab.id }, files: ['content.js'] },
            () => {
              if (chrome.runtime.lastError) {
                sendResponse({
                  ok: false,
                  error: chrome.runtime.lastError.message,
                });
                return;
              }
              requestSnapshot();
            }
          );
          return;
        }
        requestSnapshot();
      });
    };

    if (targetTabId) {
      chrome.tabs.get(targetTabId, (tab) => {
        if (chrome.runtime.lastError) {
          sendResponse({
            ok: false,
            error: chrome.runtime.lastError.message,
          });
          return;
        }
        withTab(tab);
      });
      return true;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      withTab(tabs[0]);
    });
    return true;
  }

  if (message.type === 'get_tab_uuid') {
    const targetTabId = Number.isInteger(message.tabId) ? message.tabId : null;
    const withTab = (tab) => {
      if (!tab || !tab.id) {
        sendResponse({ ok: false, error: 'No active tab' });
        return;
      }
      if (!tab.url || !tab.url.startsWith('http')) {
        sendResponse({ ok: false, error: 'Unsupported tab URL' });
        return;
      }
      const requestUuid = () => {
        chrome.tabs.sendMessage(tab.id, { type: 'get_tab_uuid' }, (response) => {
          if (chrome.runtime.lastError) {
            sendResponse({
              ok: false,
              error: chrome.runtime.lastError.message,
            });
            return;
          }
          sendResponse(response || { ok: false, error: 'No response' });
        });
      };

      chrome.tabs.sendMessage(tab.id, { type: 'get_tab_uuid' }, () => {
        if (chrome.runtime.lastError) {
          chrome.scripting.executeScript(
            { target: { tabId: tab.id }, files: ['content.js'] },
            () => {
              if (chrome.runtime.lastError) {
                sendResponse({
                  ok: false,
                  error: chrome.runtime.lastError.message,
                });
                return;
              }
              requestUuid();
            }
          );
          return;
        }
        requestUuid();
      });
    };

    if (targetTabId) {
      chrome.tabs.get(targetTabId, (tab) => {
        if (chrome.runtime.lastError) {
          sendResponse({
            ok: false,
            error: chrome.runtime.lastError.message,
          });
          return;
        }
        withTab(tab);
      });
      return true;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      withTab(tabs[0]);
    });
    return true;
  }

  if (message.type === 'get_utagdb_cookie' || message.type === 'set_utagdb_cookie') {
    const targetTabId = Number.isInteger(message.tabId) ? message.tabId : null;
    const payload =
      message.type === 'set_utagdb_cookie'
        ? { type: 'set_utagdb_cookie', enabled: message.enabled !== false }
        : { type: 'get_utagdb_cookie' };
    const withTab = (tab) => {
      if (!tab || !tab.id) {
        sendResponse({ ok: false, error: 'No active tab' });
        return;
      }
      if (!tab.url || !tab.url.startsWith('http')) {
        sendResponse({ ok: false, error: 'Unsupported tab URL' });
        return;
      }
      const requestCookie = () => {
        chrome.tabs.sendMessage(tab.id, payload, (response) => {
          if (chrome.runtime.lastError) {
            sendResponse({
              ok: false,
              error: chrome.runtime.lastError.message,
            });
            return;
          }
          sendResponse(response || { ok: false, error: 'No response' });
        });
      };

      chrome.tabs.sendMessage(tab.id, payload, () => {
        if (chrome.runtime.lastError) {
          chrome.scripting.executeScript(
            { target: { tabId: tab.id }, files: ['content.js'] },
            () => {
              if (chrome.runtime.lastError) {
                sendResponse({
                  ok: false,
                  error: chrome.runtime.lastError.message,
                });
                return;
              }
              requestCookie();
            }
          );
          return;
        }
        requestCookie();
      });
    };

    if (targetTabId) {
      chrome.tabs.get(targetTabId, (tab) => {
        if (chrome.runtime.lastError) {
          sendResponse({
            ok: false,
            error: chrome.runtime.lastError.message,
          });
          return;
        }
        withTab(tab);
      });
      return true;
    }

    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (tabs && tabs.length) {
        withTab(tabs[0]);
        return;
      }
      chrome.tabs.query({ active: true, currentWindow: true }, (fallbackTabs) => {
        if (fallbackTabs && fallbackTabs.length) {
          withTab(fallbackTabs[0]);
          return;
        }
        chrome.tabs.query({ active: true }, (anyTabs) => {
          withTab(anyTabs[0]);
        });
      });
    });
    return true;
  }

  if (message.type === 'get_consent_status') {
    const targetTabId = Number.isInteger(message.tabId) ? message.tabId : null;
    const withTab = (tab) => {
      if (!tab || !tab.id) {
        sendResponse({ ok: false, error: 'No active tab' });
        return;
      }
      if (!tab.url || !tab.url.startsWith('http')) {
        sendResponse({ ok: false, error: 'Unsupported tab URL' });
        return;
      }
      const requestSnapshot = () => {
        chrome.tabs.sendMessage(tab.id, { type: 'get_consent_status' }, (response) => {
          if (chrome.runtime.lastError) {
            sendResponse({
              ok: false,
              error: chrome.runtime.lastError.message,
            });
            return;
          }
          sendResponse(response || { ok: false, error: 'No response' });
        });
      };

      chrome.tabs.sendMessage(tab.id, { type: 'get_consent_status' }, () => {
        if (chrome.runtime.lastError) {
          chrome.scripting.executeScript(
            { target: { tabId: tab.id }, files: ['content.js'] },
            () => {
              if (chrome.runtime.lastError) {
                sendResponse({
                  ok: false,
                  error: chrome.runtime.lastError.message,
                });
                return;
              }
              requestSnapshot();
            }
          );
          return;
        }
        requestSnapshot();
      });
    };

    if (targetTabId) {
      chrome.tabs.get(targetTabId, (tab) => {
        if (chrome.runtime.lastError) {
          sendResponse({
            ok: false,
            error: chrome.runtime.lastError.message,
          });
          return;
        }
        withTab(tab);
      });
      return true;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      withTab(tabs[0]);
    });
    return true;
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
        const logEntry = (() => {
          const args =
            message.payload && Array.isArray(message.payload.args)
              ? message.payload.args
              : [];
          if (args.length === 0) {
            return '';
          }
          if (args.length === 1) {
            return String(args[0]);
          }
          return args.map((arg) => String(arg)).join(' ');
        })();
        enqueueLogWrite(items[SESSION_KEY], logEntry);
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
