function readUtagData() {
  const win = window;
  if (win.utag_data && typeof win.utag_data === 'object') {
    return win.utag_data;
  }
  if (
    win.utag &&
    typeof win.utag === 'object' &&
    win.utag.data &&
    typeof win.utag.data === 'object'
  ) {
    return win.utag.data;
  }
  return null;
}

let extensionValid = true;
const ENABLED_KEY = 'enabled';
let hasSentInitialEnabled = false;

const postEnabledState = (enabled) => {
  window.postMessage(
    {
      source: 'tealium-extension',
      type: 'set_enabled',
      enabled: Boolean(enabled),
      initial: !hasSentInitialEnabled,
    },
    '*'
  );
  hasSentInitialEnabled = true;
};

const syncEnabledState = () => {
  try {
    if (!chrome || !chrome.storage || !chrome.storage.local) {
      return;
    }
    chrome.storage.local.get({ [ENABLED_KEY]: false }, (items) => {
      postEnabledState(items[ENABLED_KEY]);
    });
  } catch (err) {
    extensionValid = false;
  }
};

const safeSendMessage = (message) => {
  if (!extensionValid) {
    return;
  }
  try {
    if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
      return;
    }
    chrome.runtime.sendMessage(message);
  } catch (err) {
    extensionValid = false;
  }
};

window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data) {
    return;
  }
  if (event.data.source !== 'tealium-extension') {
    return;
  }
  if (event.data.type === 'console_log') {
    const message = {
      type: 'console_log',
      payload: {
        url: location.href,
        timestamp: event.data.timestamp,
        args: event.data.payload,
        sequence: event.data.sequence,
        db_index: event.data.db_index,
        db_generation: event.data.db_generation,
      },
    };
    safeSendMessage(message);
    return;
  }
  if (event.data.type === 'bridge_status') {
    return;
  }
});

syncEnabledState();
if (chrome && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[ENABLED_KEY]) {
      return;
    }
    postEnabledState(changes[ENABLED_KEY].newValue);
  });
}

try {
  if (chrome && chrome.runtime && chrome.runtime.onMessage) {
    safeSendMessage({
      type: 'content_ready',
      url: location.href,
    });

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'set_enabled') {
        postEnabledState(Boolean(message.enabled));
        return;
      }
      if (message.type !== 'get_utag') {
        return;
      }

      const utag = readUtagData();
      sendResponse({
        utag: utag || {},
        found: Boolean(utag),
      });
    });
  }
} catch (err) {
  extensionValid = false;
}

// source: 'tealium-extension',
//   url: 'http://localhost:3000/',
//   captured_at: '2025-12-29T04:30:33.697Z',
//   utag: {}
