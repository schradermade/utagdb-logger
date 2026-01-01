const recordButton = document.getElementById('record');
const recordLabel = document.getElementById('record-label');
const filenameField = document.getElementById('filename-field');
const filenameInput = document.getElementById('filename');
const filenameError = document.getElementById('filename-error');
const statusEl = document.getElementById('status');
const destinationEl = document.getElementById('destination');
const destinationValueEl = document.getElementById('destination-value');
const savingEl = document.getElementById('saving');
const savingValueEl = document.getElementById('saving-value');
const countEl = document.getElementById('count');
const countValueEl = document.getElementById('count-value');
const completedEl = document.getElementById('completed');
const completedSentEl = document.getElementById('completed-sent');
const completedSavedEl = document.getElementById('completed-saved');
const completedCountEl = document.getElementById('completed-count');
let isRecording = false;
let wasRecording = false;
const ENDPOINT = 'Extension storage';
let sessionId = null;
let lastLogCount = 0;

function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? '#b00020' : '#006400';
}

function setRecordButton(isOn) {
  recordButton.classList.toggle('recording', isOn);
  recordLabel.textContent = isOn ? 'Recording - Stop' : 'Start recording';
}

function setDestination(isOn) {
  if (isOn) {
    destinationValueEl.textContent = ENDPOINT;
    destinationEl.classList.remove('hidden');
    return;
  }
  destinationValueEl.textContent = '';
  destinationEl.classList.add('hidden');
}

function setSaving(isOn, id) {
  if (isOn && id) {
    savingValueEl.textContent = id;
    savingEl.classList.remove('hidden');
    return;
  }
  savingValueEl.textContent = '';
  savingEl.classList.add('hidden');
}

function setCount(isOn, count) {
  if (isOn) {
    lastLogCount = count || 0;
    countValueEl.textContent = String(lastLogCount);
    countEl.classList.remove('hidden');
    return;
  }
  countValueEl.textContent = '';
  countEl.classList.add('hidden');
}

function setCompleted(isOn, id) {
  if (isOn && id) {
    completedSentEl.textContent = ENDPOINT;
    completedSavedEl.textContent = id;
    completedCountEl.textContent = String(lastLogCount || 0);
    completedEl.classList.remove('hidden');
    return;
  }
  completedSentEl.textContent = '';
  completedSavedEl.textContent = '';
  completedCountEl.textContent = '';
  completedEl.classList.add('hidden');
}

function refreshSessionInfo() {
  chrome.runtime.sendMessage({ type: 'get_enabled' }, (response) => {
    if (chrome.runtime.lastError) {
      return;
    }
    sessionId = response && response.sessionId ? response.sessionId : null;
    const logCount =
      response && typeof response.logCount === 'number' ? response.logCount : 0;
    setSaving(Boolean(response && response.enabled), sessionId);
    setCount(Boolean(response && response.enabled), logCount);
  });
}

if (chrome && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.sessionLogCount) {
      return;
    }
    const nextCount = changes.sessionLogCount.newValue || 0;
    if (isRecording) {
      setCount(true, nextCount);
    }
  });
}

const sendUtag = () => {
  setStatus('Sending...', false);
  chrome.runtime.sendMessage({ type: 'send_utag' }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message, true);
      return;
    }
    if (response && response.ok) {
      return;
    }
    const error =
      response && response.error ? response.error : 'Failed to send';
    setStatus(error, true);
  });
};

function setFilenameLock(isLocked) {
  filenameInput.disabled = isLocked;
  filenameField.classList.toggle('hidden', isLocked);
}

function setFilenameError(isVisible) {
  filenameError.classList.toggle('hidden', !isVisible);
}

const setEnabled = (enabled) => {
  const filename = filenameInput.value.trim();
  if (enabled && !filename) {
    setFilenameError(true);
    setRecordButton(false);
    return;
  }
  setFilenameError(false);
  chrome.runtime.sendMessage(
    {
      type: 'set_enabled',
      enabled,
      filename,
    },
    (response) => {
      if (chrome.runtime.lastError) {
        setStatus(chrome.runtime.lastError.message, true);
        return;
      }
      if (!response || !response.ok) {
        setStatus('Failed to update setting', true);
        return;
      }
      if (enabled) {
        setStatus('', false);
        setFilenameLock(true);
        setRecordButton(true);
        setDestination(true);
        refreshSessionInfo();
        setCompleted(false, null);
        setCount(true, 0);
        isRecording = true;
        wasRecording = true;
      } else {
        setStatus(wasRecording ? '' : 'Ready', false);
        setFilenameLock(false);
        setRecordButton(false);
        setDestination(false);
        setSaving(false, null);
        setCompleted(wasRecording, sessionId);
        setCount(false, 0);
        if (wasRecording) {
          filenameInput.value = '';
        }
        setFilenameError(false);
        isRecording = false;
      }
    }
  );
};

chrome.runtime.sendMessage({ type: 'get_enabled' }, (response) => {
  if (chrome.runtime.lastError) {
    setStatus(chrome.runtime.lastError.message, true);
    return;
  }
  const enabled = response && response.enabled;
  sessionId = response && response.sessionId ? response.sessionId : null;
  const logCount =
    response && typeof response.logCount === 'number' ? response.logCount : 0;
  lastLogCount = logCount;
  setFilenameLock(Boolean(enabled));
  setRecordButton(Boolean(enabled));
  setDestination(Boolean(enabled));
  setSaving(Boolean(enabled), sessionId);
  setCount(Boolean(enabled), logCount);
  setCompleted(false, null);
  isRecording = Boolean(enabled);
  wasRecording = Boolean(enabled);
  if (response && response.filename) {
    filenameInput.value = response.filename;
  }
  setFilenameError(false);
  setStatus(enabled ? '' : 'Ready', false);
});

recordButton.addEventListener('click', () => {
  setEnabled(!isRecording);
});
