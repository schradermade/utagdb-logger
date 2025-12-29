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
  if (event.data.source !== 'tealium-extension' || event.data.type !== 'console_log') {
    return;
  }
  safeSendMessage({
    type: 'console_log',
    payload: {
      url: location.href,
      timestamp: event.data.timestamp,
      args: event.data.payload,
    },
  });
});

try {
  if (chrome && chrome.runtime && chrome.runtime.onMessage) {
    safeSendMessage({
      type: 'content_ready',
      url: location.href,
    });

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
