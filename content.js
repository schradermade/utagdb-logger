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

window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data) {
    return;
  }
  if (event.data.source !== 'tealium-extension' || event.data.type !== 'console_log') {
    return;
  }
  console.log('[tealium-extension] content received console_log', event.data.payload);
  if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
    return;
  }
  chrome.runtime.sendMessage({
    type: 'console_log',
    payload: {
      url: location.href,
      timestamp: event.data.timestamp,
      args: event.data.payload,
    },
  });
});

if (chrome && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.sendMessage({
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

// source: 'tealium-extension',
//   url: 'http://localhost:3000/',
//   captured_at: '2025-12-29T04:30:33.697Z',
//   utag: {}
