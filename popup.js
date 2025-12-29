const button = document.getElementById('send');
const statusEl = document.getElementById('status');

function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? '#b00020' : '#006400';
}

button.addEventListener('click', () => {
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
});
