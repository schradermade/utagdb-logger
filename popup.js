const toggle = document.getElementById('enabled');
const statusEl = document.getElementById('status');

function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? '#b00020' : '#006400';
}

const sendUtag = () => {
  setStatus('Sending...', false);
  chrome.runtime.sendMessage({ type: 'send_utag' }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message, true);
      return;
    }
    if (response && response.ok) {
      setStatus('Sent to localhost:3005', false);
      return;
    }
    const error =
      response && response.error ? response.error : 'Failed to send';
    setStatus(error, true);
  });
};

const setEnabled = (enabled) => {
  chrome.runtime.sendMessage({ type: 'set_enabled', enabled }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message, true);
      return;
    }
    if (!response || !response.ok) {
      setStatus('Failed to update setting', true);
      return;
    }
    if (enabled) {
      sendUtag();
    } else {
      setStatus('Sending disabled', false);
    }
  });
};

chrome.runtime.sendMessage({ type: 'get_enabled' }, (response) => {
  if (chrome.runtime.lastError) {
    setStatus(chrome.runtime.lastError.message, true);
    return;
  }
  const enabled = response && response.enabled;
  toggle.checked = Boolean(enabled);
  setStatus(enabled ? 'Sending enabled' : 'Sending disabled', false);
});

toggle.addEventListener('change', () => {
  setEnabled(toggle.checked);
});
