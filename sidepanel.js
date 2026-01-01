const featureButtons = Array.from(document.querySelectorAll('[data-feature]'));
const topTabButtons = Array.from(document.querySelectorAll('[data-top-tab]'));
const toolsView = document.getElementById('tools-view');
const exportView = document.getElementById('export-view');
const featureSections = new Map([
  ['logger', document.getElementById('feature-logger')],
  ['session', document.getElementById('feature-session')],
  ['rules', document.getElementById('feature-rules')],
  ['payloads', document.getElementById('feature-payloads')],
  ['consent', document.getElementById('feature-consent')],
  ['network', document.getElementById('feature-network')],
  ['events', document.getElementById('feature-events')],
  ['storage', document.getElementById('feature-storage')],
  ['qa', document.getElementById('feature-qa')],
]);

const setActiveFeature = (feature) => {
  featureButtons.forEach((button) => {
    const isActive = button.dataset.feature === feature;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  });
  featureSections.forEach((section, key) => {
    if (!section) {
      return;
    }
    section.classList.toggle('active', key === feature);
  });
  if (feature === 'consent' && typeof fetchConsentSnapshot === 'function') {
    fetchConsentSnapshot();
  }
  if (feature === 'consent') {
    startConsentPolling();
  } else {
    stopConsentPolling();
  }
};

const setActiveTopTab = (tab) => {
  topTabButtons.forEach((button) => {
    const isActive = button.dataset.topTab === tab;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  });
  if (toolsView) {
    toolsView.style.display = tab === 'tools' ? 'block' : 'none';
  }
  if (exportView) {
    exportView.classList.toggle('active', tab === 'export');
    exportView.setAttribute('aria-hidden', tab === 'export' ? 'false' : 'true');
  }
  if (tab === 'export') {
    stopConsentPolling();
    refreshExportPreview();
  } else {
    const activeButton = featureButtons.find((button) =>
      button.classList.contains('active')
    );
    if (activeButton && activeButton.dataset.feature === 'consent') {
      fetchConsentSnapshot({ silent: true, forceRender: true });
      startConsentPolling();
    }
  }
};

featureButtons.forEach((button) => {
  if (button.disabled) {
    return;
  }
  button.addEventListener('click', () => {
    setActiveFeature(button.dataset.feature);
  });
});

topTabButtons.forEach((button) => {
  button.addEventListener('click', () => {
    setActiveTopTab(button.dataset.topTab);
  });
});

const initialTopTab = topTabButtons.find((button) =>
  button.classList.contains('active')
);
setActiveTopTab(initialTopTab ? initialTopTab.dataset.topTab : 'tools');

const storageSnapshotButton = document.getElementById('storage-snapshot');
const storageSearchInput = document.getElementById('storage-search');
const storageStatus = document.getElementById('storage-status');
const storageCookiesList = document.getElementById('storage-cookies-list');
const storageLocalList = document.getElementById('storage-local-list');
const storageSessionList = document.getElementById('storage-session-list');
const storageUtagList = document.getElementById('storage-utag-list');
const storageCookiesCount = document.getElementById('storage-cookies-count');
const storageLocalCount = document.getElementById('storage-local-count');
const storageSessionCount = document.getElementById('storage-session-count');
const storageUtagCount = document.getElementById('storage-utag-count');

let storageData = null;
let storageFilter = '';
let currentTabId = null;
let currentTabUuid = null;
const tabIdToUuid = new Map();
const storageSnapshotsByTab = new Map();
const consentSnapshotsByTab = new Map();
const consentCoreSignaturesByTab = new Map();
const storageLocal = chrome.storage && chrome.storage.local;
let lastConsentRefreshAt = 0;
const CONSENT_REFRESH_COOLDOWN_MS = 1000;
let consentRefreshInFlight = false;
let consentPollTimer = null;
const CONSENT_POLL_INTERVAL_MS = 2000;

const isConsentActive = () => {
  const consentButton = featureButtons.find(
    (button) => button.dataset.feature === 'consent'
  );
  return Boolean(consentButton && consentButton.classList.contains('active'));
};

const startConsentPolling = () => {
  if (consentPollTimer) {
    return;
  }
  consentPollTimer = setInterval(() => {
    if (document.visibilityState !== 'visible' || !isConsentActive()) {
      return;
    }
    fetchConsentSnapshot({ silent: true });
  }, CONSENT_POLL_INTERVAL_MS);
};

const stopConsentPolling = () => {
  if (!consentPollTimer) {
    return;
  }
  clearInterval(consentPollTimer);
  consentPollTimer = null;
};

const getSessionKeys = (tabUuid) => ({
  storage: `storageSnapshot:tab:${tabUuid}`,
  consent: `consentSnapshot:tab:${tabUuid}`,
});

const saveSessionSnapshot = (key, payload) => {
  if (!storageLocal) {
    return;
  }
  storageLocal.set({ [key]: payload });
};

const loadSessionSnapshot = (key, callback) => {
  if (!storageLocal) {
    callback(null);
    return;
  }
  storageLocal.get([key], (items) => {
    if (chrome.runtime.lastError) {
      callback(null);
      return;
    }
    callback(items ? items[key] : null);
  });
};

const clearSessionSnapshots = (tabUuid) => {
  if (!storageLocal || !tabUuid) {
    return;
  }
  const keys = getSessionKeys(tabUuid);
  storageLocal.remove([keys.storage, keys.consent]);
};

const getActiveTabInfo = (callback) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs && tabs[0] ? tabs[0] : null;
    const tabId = activeTab && activeTab.id ? activeTab.id : null;
    const url = activeTab && typeof activeTab.url === 'string' ? activeTab.url : null;
    callback({ tabId, url });
  });
};

const resolveTabUuid = (tabId, callback) => {
  if (!tabId) {
    callback(null);
    return;
  }
  if (tabIdToUuid.has(tabId)) {
    callback(tabIdToUuid.get(tabId));
    return;
  }
  chrome.runtime.sendMessage({ type: 'get_tab_uuid', tabId }, (response) => {
    if (chrome.runtime.lastError || !response || !response.ok) {
      callback(null);
      return;
    }
    const tabUuid = response.tab_uuid || null;
    if (tabUuid) {
      tabIdToUuid.set(tabId, tabUuid);
    }
    callback(tabUuid);
  });
};

const clearStorageLists = () => {
  renderList(storageCookiesList, [], '');
  renderList(storageLocalList, [], '');
  renderList(storageSessionList, [], '');
  renderList(storageUtagList, [], '');
  updateCounts({ cookies: 0, local: 0, session: 0, utag: 0 });
};

const setStorageSnapshot = (payload) => {
  const capturedAt = payload.captured_at
    ? new Date(payload.captured_at).toLocaleTimeString()
    : 'just now';
  const url = payload.url || 'current tab';
  storageStatus.textContent = `Snapshot from ${url} at ${capturedAt}`;
  storageData = {
    cookies: payload.cookies || [],
    localStorage: payload.localStorage || [],
    sessionStorage: payload.sessionStorage || [],
    utag: payload.utag || [],
  };
  updateCounts({
    cookies: storageData.cookies.length,
    local: storageData.localStorage.length,
    session: storageData.sessionStorage.length,
    utag: storageData.utag.length,
  });
  applyStorageFilter();
};

const setStorageEmpty = (message) => {
  storageData = null;
  storageStatus.textContent = message;
  clearStorageLists();
};

const consentRefreshButton = document.getElementById('consent-refresh');
const consentStatus = document.getElementById('consent-status');
const consentRequired = document.getElementById('consent-required');
const consentPresent = document.getElementById('consent-present');
const consentState = document.getElementById('consent-state');
const consentGpc = document.getElementById('consent-gpc');
const consentMeta = document.getElementById('consent-meta');
const consentCategories = document.getElementById('consent-categories');
const consentSignalList = document.getElementById('consent-signal-list');
const consentSignalCount = document.getElementById('consent-signal-count');
const exportRefreshButton = document.getElementById('export-refresh');
const exportDownloadButton = document.getElementById('export-download');
const exportStatus = document.getElementById('export-status');
const exportPreview = document.getElementById('export-preview');
const loggerPreview = document.getElementById('logger-preview');
const loggerPreviewCount = document.getElementById('logger-preview-count');
const exportIncludeLogger = document.getElementById('export-include-logger');
const exportIncludeConsent = document.getElementById('export-include-consent');
const exportRedactUrls = document.getElementById('export-redact-urls');
const exportRedactSignals = document.getElementById('export-redact-signals');
const exportSize = document.getElementById('export-size');
let exportCaseFileText = '';
const LOGGER_PREVIEW_LIMIT = 120;

const getCurrentTabUuid = () =>
  currentTabUuid || (currentTabId ? tabIdToUuid.get(currentTabId) : null);

const setConsentPill = (el, value, tone) => {
  if (!el) {
    return;
  }
  el.textContent = value || 'Unknown';
  el.classList.remove('ok', 'warn', 'bad');
  if (tone) {
    el.classList.add(tone);
  }
};

const normalizeValue = (value) => {
  if (value == null) {
    return '';
  }
  if (typeof value !== 'string') {
    try {
      return JSON.stringify(value, null, 2);
    } catch (err) {
      return String(value);
    }
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) {
    return value;
  }
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch (err) {
    return value;
  }
};

const formatCaseFileName = (timestamp) => {
  const safeStamp = timestamp.replace(/[:.]/g, '-');
  return `case-file-${safeStamp}.json`;
};

const stringifyLogArg = (value) => {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
      } catch (err) {
        return value;
      }
    }
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch (err) {
    return String(value);
  }
};

const parseJsonString = (value) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if (
    !(trimmed.startsWith('{') || trimmed.startsWith('[')) ||
    !(trimmed.endsWith('}') || trimmed.endsWith(']'))
  ) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    return value;
  }
};

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const transformLogEntryForPreview = (entry) => {
  if (!entry || typeof entry !== 'object') {
    return entry;
  }
  const next = { ...entry };
  if (next.console && Array.isArray(next.console.args)) {
    next.console = {
      ...next.console,
      args: next.console.args.map(parseJsonString),
    };
  }
  return next;
};

const refreshLoggerPreview = () => {
  if (!loggerPreview) {
    return;
  }
  chrome.runtime.sendMessage({ type: 'get_enabled' }, (response) => {
    if (chrome.runtime.lastError) {
      loggerPreview.textContent = chrome.runtime.lastError.message;
      if (loggerPreviewCount) {
        loggerPreviewCount.textContent = '0';
      }
      return;
    }
    const sessionId =
      (response && response.sessionId) ||
      (response && response.lastSessionId) ||
      null;
    if (!sessionId) {
      loggerPreview.textContent = 'No session yet.';
      if (loggerPreviewCount) {
        loggerPreviewCount.textContent = '0';
      }
      return;
    }
    const logsKey = `utagdbLogs:session:${sessionId}`;
    chrome.storage.local.get([logsKey], (items) => {
      if (chrome.runtime.lastError) {
        loggerPreview.textContent = chrome.runtime.lastError.message;
        if (loggerPreviewCount) {
          loggerPreviewCount.textContent = '0';
        }
        return;
      }
      const logs = Array.isArray(items[logsKey]) ? items[logsKey] : [];
      if (loggerPreviewCount) {
        loggerPreviewCount.textContent = String(logs.length);
      }
      if (logs.length === 0) {
        loggerPreview.textContent = 'No logs yet.';
        return;
      }
      const startIndex = Math.max(0, logs.length - LOGGER_PREVIEW_LIMIT);
      const slice = logs
        .slice(startIndex)
        .map((entry) => transformLogEntryForPreview(entry));
      const pad = String(logs.length).length;
      const formatted = [];
      slice.forEach((entry, index) => {
        const logNumber = String(startIndex + index + 1).padStart(pad, ' ');
        let prettyEntry = '';
        try {
          prettyEntry = JSON.stringify(entry, null, 2);
        } catch (err) {
          prettyEntry = stringifyLogArg(entry);
        }
        const entryLines = prettyEntry.split('\n');
        entryLines.forEach((line, lineIndex) => {
          const prefix = lineIndex === 0 ? logNumber : ' '.repeat(pad);
          formatted.push(
            `<span class="logger-line">` +
              `<span class="logger-line-number" aria-hidden="true">${escapeHtml(
                prefix
              )}</span>` +
              `<span class="logger-line-sep" aria-hidden="true"> | </span>` +
              `<span class="logger-line-text">${escapeHtml(line)}</span>` +
              `</span>`
          );
        });
      });
      loggerPreview.innerHTML = formatted.join('');
    });
  });
};

const buildCaseFile = (callback) => {
  const generatedAt = new Date().toISOString();
  const manifest = chrome.runtime && chrome.runtime.getManifest
    ? chrome.runtime.getManifest()
    : {};
  const redactUrls = Boolean(exportRedactUrls && exportRedactUrls.checked);
  const redactSignals = Boolean(exportRedactSignals && exportRedactSignals.checked);
  const includeLogger = !exportIncludeLogger || exportIncludeLogger.checked;
  const includeConsent = !exportIncludeConsent || exportIncludeConsent.checked;
  const currentUuid = getCurrentTabUuid();

  chrome.runtime.sendMessage({ type: 'get_enabled' }, (response) => {
    const logger = response || {};
    const sessionId = logger.sessionId || logger.lastSessionId || null;
    const logsKey = `utagdbLogs:session:${sessionId || 'no-session'}`;
    const metaKey = `utagdbSession:${sessionId || 'no-session'}`;

    chrome.storage.local.get(null, (items) => {
      if (chrome.runtime.lastError) {
        callback(null, chrome.runtime.lastError.message);
        return;
      }
      const consentSnapshots = Object.keys(items || {})
        .filter((key) => key.startsWith('consentSnapshot:tab:'))
        .map((key) => items[key])
        .filter(Boolean)
        .filter((snapshot) => (currentUuid ? snapshot.tab_uuid === currentUuid : true))
        .map((snapshot) => {
          const next = { ...snapshot };
          if (redactUrls) {
            next.url = '[redacted]';
          }
          if (redactSignals && Array.isArray(next.signals)) {
            next.signals = next.signals.map((signal) => ({
              label: signal.label,
              value: 'redacted',
            }));
          }
          return next;
        })
        .sort((left, right) => {
          const leftTime = left && left.captured_at ? left.captured_at : '';
          const rightTime = right && right.captured_at ? right.captured_at : '';
          return leftTime.localeCompare(rightTime);
        });
      const sessionMeta = items[metaKey] || null;
      const sessionLogs = Array.isArray(items[logsKey]) ? items[logsKey] : [];
      const redactedLogs = redactUrls
        ? sessionLogs.map((entry) => ({
            ...entry,
            url: entry.url ? '[redacted]' : entry.url,
            console:
              entry.console && entry.console.url
                ? { ...entry.console, url: '[redacted]' }
                : entry.console,
          }))
        : sessionLogs;
      const caseFile = {
        generated_at: generatedAt,
        app: {
          name: manifest.name || 'Tealium Debug Logger',
          version: manifest.version || 'unknown',
        },
        utagdb_logger: includeLogger
          ? {
              enabled: Boolean(logger.enabled),
              session_id: sessionId,
              session_name: logger.filename || null,
              log_count: Number.isFinite(logger.logCount)
                ? logger.logCount
                : redactedLogs.length,
              session: sessionMeta,
              logs: redactedLogs,
            }
          : null,
        consent_monitor: includeConsent
          ? {
              snapshot_count: consentSnapshots.length,
              snapshots: consentSnapshots,
            }
          : null,
      };
      callback(caseFile, null);
    });
  });
};

const transformCaseFileForPreview = (caseFile) => {
  if (!caseFile || typeof caseFile !== 'object') {
    return caseFile;
  }
  const logger = caseFile.utagdb_logger;
  if (!logger || !Array.isArray(logger.logs)) {
    return caseFile;
  }
  const previewLogs = logger.logs.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      return entry;
    }
    const nextEntry = { ...entry };
    if (nextEntry.console && Array.isArray(nextEntry.console.args)) {
      nextEntry.console = {
        ...nextEntry.console,
        args: nextEntry.console.args.map(parseJsonString),
      };
    }
    return nextEntry;
  });
  return {
    ...caseFile,
    utagdb_logger: {
      ...logger,
      logs: previewLogs,
    },
  };
};

function refreshExportPreview() {
  if (!exportStatus || !exportPreview) {
    return;
  }
  exportStatus.textContent = 'Building case file...';
  buildCaseFile((caseFile, error) => {
    if (error) {
      exportStatus.textContent = error;
      exportPreview.textContent = '';
      exportCaseFileText = '';
      if (exportSize) {
        exportSize.textContent = '';
      }
      return;
    }
    exportCaseFileText = JSON.stringify(caseFile, null, 2);
    const previewCaseFile = transformCaseFileForPreview(caseFile);
    const previewText = JSON.stringify(previewCaseFile, null, 2);
    const lines = previewText.split('\n');
    const padded = String(lines.length).length;
    const numbered = lines
      .map((line, index) => `${String(index + 1).padStart(padded, ' ')} | ${line}`)
      .join('\n');
    exportPreview.textContent = numbered;
    exportStatus.textContent = `Preview updated at ${new Date().toLocaleTimeString()}`;
    if (exportSize) {
      const bytes = new TextEncoder().encode(exportCaseFileText).length;
      exportSize.textContent = `Estimated size: ${bytes} bytes`;
    }
  });
}

const exportCaseFile = () => {
  if (!exportCaseFileText) {
    refreshExportPreview();
    return;
  }
  const timestamp = new Date().toISOString();
  const blob = new Blob([exportCaseFileText], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download(
    {
      url,
      filename: formatCaseFileName(timestamp),
      saveAs: true,
    },
    () => {
      URL.revokeObjectURL(url);
    }
  );
};

if (exportRefreshButton) {
  exportRefreshButton.addEventListener('click', refreshExportPreview);
}
if (exportDownloadButton) {
  exportDownloadButton.addEventListener('click', exportCaseFile);
}
if (exportRedactUrls) {
  exportRedactUrls.addEventListener('change', refreshExportPreview);
}
if (exportRedactSignals) {
  exportRedactSignals.addEventListener('change', refreshExportPreview);
}
if (exportIncludeLogger) {
  exportIncludeLogger.addEventListener('change', refreshExportPreview);
}
if (exportIncludeConsent) {
  exportIncludeConsent.addEventListener('change', refreshExportPreview);
}

refreshLoggerPreview();

if (chrome && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }
    const keys = Object.keys(changes || {});
    const hasLoggerUpdate = keys.some(
      (key) =>
        key === 'sessionLogCount' ||
        key === 'sessionId' ||
        key === 'lastSessionId' ||
        key.startsWith('utagdbLogs:session:')
    );
    if (hasLoggerUpdate) {
      refreshLoggerPreview();
    }
  });
}

const normalizeConsentCategory = (category) => {
  if (!category) {
    return { name: '', accepted: false };
  }
  if (typeof category === 'string') {
    return { name: category.trim(), accepted: false };
  }
  if (typeof category === 'object') {
    return {
      name: String(category.name || category.label || '').trim(),
      accepted: Boolean(category.accepted),
    };
  }
  return { name: String(category).trim(), accepted: false };
};

const buildConsentCoreSignature = (payload) => {
  if (!payload) {
    return '';
  }
  const normalizedCategories = Array.isArray(payload.categories)
    ? payload.categories.map(normalizeConsentCategory)
    : [];
  normalizedCategories.sort((left, right) => {
    const nameCompare = left.name.localeCompare(right.name);
    if (nameCompare !== 0) {
      return nameCompare;
    }
    if (left.accepted === right.accepted) {
      return 0;
    }
    return left.accepted ? -1 : 1;
  });
  const signaturePayload = {
    required: payload.required ? payload.required.value : '',
    present: payload.present ? payload.present.value : '',
    state: payload.state ? payload.state.value : '',
    gpc: payload.gpc ? payload.gpc.value : '',
    categories: normalizedCategories,
  };
  try {
    return JSON.stringify(signaturePayload);
  } catch (err) {
    return String(signaturePayload);
  }
};

const renderList = (container, entries, filter) => {
  if (!container) {
    return;
  }
  container.innerHTML = '';
  const match = (entry) => {
    if (!filter) {
      return true;
    }
    const haystack = `${entry.key} ${entry.value}`.toLowerCase();
    return haystack.includes(filter);
  };
  const filtered = entries.filter(match);
  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'storage-empty';
    empty.textContent = 'No matches.';
    container.appendChild(empty);
    return;
  }
  filtered.forEach((entry) => {
    const item = document.createElement('div');
    item.className = 'storage-item';
    const key = document.createElement('div');
    key.className = 'storage-key';
    key.textContent = entry.key;
    const value = document.createElement('div');
    value.className = 'storage-value';
    value.textContent = normalizeValue(entry.value);
    item.appendChild(key);
    item.appendChild(value);
    container.appendChild(item);
  });
};

const updateCounts = (counts) => {
  if (storageCookiesCount) storageCookiesCount.textContent = String(counts.cookies);
  if (storageLocalCount) storageLocalCount.textContent = String(counts.local);
  if (storageSessionCount) storageSessionCount.textContent = String(counts.session);
  if (storageUtagCount) storageUtagCount.textContent = String(counts.utag);
};

const applyStorageFilter = () => {
  if (!storageData) {
    return;
  }
  const filter = storageFilter.toLowerCase();
  renderList(storageCookiesList, storageData.cookies, filter);
  renderList(storageLocalList, storageData.localStorage, filter);
  renderList(storageSessionList, storageData.sessionStorage, filter);
  renderList(storageUtagList, storageData.utag, filter);
};

const collectStorage = () => {
  if (!storageStatus) {
    return;
  }
  storageStatus.textContent = 'Collecting snapshot...';
  getActiveTabInfo(({ tabId }) => {
    if (!tabId) {
      setStorageEmpty('No active tab.');
      return;
    }
    chrome.runtime.sendMessage({ type: 'get_storage_map', tabId }, (response) => {
      if (chrome.runtime.lastError) {
        storageStatus.textContent = chrome.runtime.lastError.message;
        return;
      }
      if (!response || !response.ok) {
        storageStatus.textContent = response && response.error
          ? response.error
          : 'Failed to collect snapshot.';
        return;
      }
      const payload = response.data || {};
      const tabUuid = payload.tab_uuid || tabIdToUuid.get(tabId) || `tab-${tabId}`;
      tabIdToUuid.set(tabId, tabUuid);
      storageSnapshotsByTab.set(tabUuid, payload);
      saveSessionSnapshot(getSessionKeys(tabUuid).storage, payload);
      if (tabId === currentTabId) {
        setStorageSnapshot(payload);
      }
    });
  });
};

if (storageSnapshotButton) {
  storageSnapshotButton.addEventListener('click', collectStorage);
}

if (storageSearchInput) {
  storageSearchInput.addEventListener('input', (event) => {
    storageFilter = event.target.value || '';
    applyStorageFilter();
  });
}

const renderConsentSignals = (signals) => {
  if (!consentSignalList) {
    return;
  }
  consentSignalList.innerHTML = '';
  if (!signals || signals.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'storage-empty';
    empty.textContent = 'No consent signals found.';
    consentSignalList.appendChild(empty);
    return;
  }
  signals.forEach((signal) => {
    const item = document.createElement('div');
    item.className = 'storage-item';
    const key = document.createElement('div');
    key.className = 'storage-key';
    key.textContent = signal.label;
    const value = document.createElement('div');
    value.className = 'storage-value';
    value.textContent = normalizeValue(signal.value);
    item.appendChild(key);
    item.appendChild(value);
    consentSignalList.appendChild(item);
  });
  if (consentSignalCount) {
    consentSignalCount.textContent = String(signals.length);
  }
};

const setConsentEmpty = (message) => {
  if (consentStatus) {
    consentStatus.textContent = message;
  }
  setConsentPill(consentRequired, 'Unknown', null);
  setConsentPill(consentPresent, 'Unknown', null);
  setConsentPill(consentState, 'Unknown', null);
  setConsentPill(consentGpc, 'Unknown', null);
  renderConsentCategories([]);
  renderConsentSignals([]);
  if (consentMeta) {
    consentMeta.textContent = '';
  }
};

const renderConsentCategories = (categories) => {
  if (!consentCategories) {
    return;
  }
  consentCategories.innerHTML = '';
  const categoryNameMap = {
    c0001: 'Strictly Necessary',
    c0002: 'Performance',
    c0003: 'Functional',
    c0004: 'Targeting / Advertising',
    c0005: 'Social Media',
    necessary: 'Strictly Necessary',
    functional: 'Functional',
    analytics: 'Analytics',
    advertisement: 'Advertising',
    other: 'Other',
  };
  const categoryOrder = ['c0001', 'c0002', 'c0003', 'c0004', 'c0005'];
  const getCategoryKey = (category) => {
    if (!category) {
      return '';
    }
    if (typeof category === 'string') {
      return category.trim().toLowerCase();
    }
    if (typeof category === 'object') {
      const raw = category.name || category.label || '';
      return String(raw).trim().toLowerCase();
    }
    return String(category).trim().toLowerCase();
  };
  const list = Array.isArray(categories) ? categories : [];
  if (list.length === 0) {
    const pill = document.createElement('span');
    pill.className = 'consent-pill dim consent-pill-plain';
    pill.textContent = 'Unknown';
    consentCategories.appendChild(pill);
    return;
  }
  const ordered = [...list].sort((left, right) => {
    const leftKey = getCategoryKey(left);
    const rightKey = getCategoryKey(right);
    const leftIsC = leftKey.startsWith('c');
    const rightIsC = rightKey.startsWith('c');
    if (leftIsC !== rightIsC) {
      return leftIsC ? -1 : 1;
    }
    const leftIndex = categoryOrder.indexOf(leftKey);
    const rightIndex = categoryOrder.indexOf(rightKey);
    const leftRank = leftIndex === -1 ? categoryOrder.length : leftIndex;
    const rightRank = rightIndex === -1 ? categoryOrder.length : rightIndex;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return leftKey.localeCompare(rightKey);
  });
  ordered.forEach((category) => {
    const pill = document.createElement('span');
    let label = category;
    let accepted = false;
    if (category && typeof category === 'object') {
      label = category.name || category.label || '';
      accepted = Boolean(category.accepted);
    }
    let displayLabel = label;
    if (typeof label === 'string') {
      const trimmed = label.trim();
      const lower = trimmed.toLowerCase();
      if (categoryNameMap[lower]) {
        if (lower.startsWith('c')) {
          displayLabel = `${trimmed.toUpperCase()}: ${categoryNameMap[lower]}`;
        } else {
          displayLabel = categoryNameMap[lower];
        }
      }
    }
    pill.className = accepted
      ? 'consent-pill category-ok'
      : 'consent-pill dim';
    pill.textContent = String(displayLabel || 'Unknown');
    consentCategories.appendChild(pill);
  });
};

const applyConsentSnapshot = (payload) => {
  const required = payload.required || {};
  const present = payload.present || {};
  const state = payload.state || {};
  const gpc = payload.gpc || {};
  setConsentPill(consentRequired, required.value || 'Unknown', required.tone);
  setConsentPill(consentPresent, present.value || 'Unknown', present.tone);
  setConsentPill(consentState, state.value || 'Unknown', state.tone);
  setConsentPill(consentGpc, gpc.value || 'Unknown', gpc.tone);
  renderConsentCategories(payload.categories || []);
  if (consentMeta) {
    const capturedAt = payload.captured_at
      ? new Date(payload.captured_at).toLocaleTimeString()
      : 'just now';
    const url = payload.url || 'current tab';
    consentMeta.textContent = `Snapshot from ${url} at ${capturedAt}`;
  }
  renderConsentSignals(payload.signals || []);
};

function fetchConsentSnapshot(options = {}) {
  if (!consentStatus) {
    return;
  }
  const silent = Boolean(options.silent);
  const forceRender = Boolean(options.forceRender);
  const now = Date.now();
  if (consentRefreshInFlight) {
    return;
  }
  if (now - lastConsentRefreshAt < CONSENT_REFRESH_COOLDOWN_MS) {
    return;
  }
  consentRefreshInFlight = true;
  if (!silent) {
    consentStatus.textContent = 'Collecting snapshot...';
  }
  getActiveTabInfo(({ tabId }) => {
    if (!tabId) {
      setConsentEmpty('No active tab.');
      consentRefreshInFlight = false;
      return;
    }
    chrome.runtime.sendMessage({ type: 'get_consent_status', tabId }, (response) => {
      if (chrome.runtime.lastError) {
        if (!silent) {
          consentStatus.textContent = chrome.runtime.lastError.message;
        }
        consentRefreshInFlight = false;
        return;
      }
      if (!response || !response.ok) {
        if (!silent) {
          consentStatus.textContent = response && response.error
            ? response.error
            : 'Failed to collect consent.';
        }
        consentRefreshInFlight = false;
        return;
      }
      lastConsentRefreshAt = Date.now();
      consentRefreshInFlight = false;
      const payload = response.data || {};
      const tabUuid = payload.tab_uuid || tabIdToUuid.get(tabId) || `tab-${tabId}`;
      tabIdToUuid.set(tabId, tabUuid);
      const coreSignature = buildConsentCoreSignature(payload);
      const prevCoreSignature = consentCoreSignaturesByTab.get(tabUuid);
      if (
        silent &&
        !forceRender &&
        prevCoreSignature &&
        coreSignature === prevCoreSignature
      ) {
        if (consentStatus && consentStatus.textContent) {
          consentStatus.textContent = '';
        }
        consentSnapshotsByTab.set(tabUuid, payload);
        saveSessionSnapshot(getSessionKeys(tabUuid).consent, payload);
        return;
      }
      consentCoreSignaturesByTab.set(tabUuid, coreSignature);
      consentStatus.textContent = '';
      consentSnapshotsByTab.set(tabUuid, payload);
      saveSessionSnapshot(getSessionKeys(tabUuid).consent, payload);
      if (tabId === currentTabId) {
        applyConsentSnapshot(payload);
      }
    });
  });
}

if (consentRefreshButton) {
  consentRefreshButton.addEventListener('click', fetchConsentSnapshot);
}

const applySnapshotsForTab = ({ tabId, url }) => {
  currentTabId = tabId;
  currentTabUuid = null;
  if (!tabId) {
    setStorageEmpty('No active tab.');
    setConsentEmpty('No active tab.');
    return;
  }
  resolveTabUuid(tabId, (tabUuid) => {
    if (!tabUuid) {
      setStorageEmpty('No snapshot yet for this tab.');
      setConsentEmpty('No snapshot yet for this tab.');
      return;
    }
    currentTabUuid = tabUuid;
    const storageSnapshot = storageSnapshotsByTab.get(tabUuid);
    if (storageSnapshot) {
      setStorageSnapshot(storageSnapshot);
    } else {
      const storageKey = getSessionKeys(tabUuid).storage;
      loadSessionSnapshot(storageKey, (payload) => {
        if (payload) {
          storageSnapshotsByTab.set(tabUuid, payload);
          setStorageSnapshot(payload);
        } else {
          setStorageEmpty('No snapshot yet for this tab.');
        }
      });
    }
    const consentSnapshot = consentSnapshotsByTab.get(tabUuid);
    if (consentSnapshot) {
      applyConsentSnapshot(consentSnapshot);
    } else {
      const consentKey = getSessionKeys(tabUuid).consent;
      loadSessionSnapshot(consentKey, (payload) => {
        if (payload) {
          consentSnapshotsByTab.set(tabUuid, payload);
          applyConsentSnapshot(payload);
        } else {
          setConsentEmpty('No snapshot yet for this tab.');
        }
      });
    }
  });
};

getActiveTabInfo((info) => {
  applySnapshotsForTab(info);
  if (isConsentActive()) {
    fetchConsentSnapshot({ silent: true, forceRender: true });
    startConsentPolling();
  } else {
    stopConsentPolling();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') {
    stopConsentPolling();
    return;
  }
  if (isConsentActive()) {
    fetchConsentSnapshot({ silent: true, forceRender: true });
    startConsentPolling();
  } else {
    stopConsentPolling();
  }
});
if (chrome.tabs && chrome.tabs.onActivated) {
  chrome.tabs.onActivated.addListener((info) => {
    chrome.tabs.get(info.tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        applySnapshotsForTab({ tabId: info.tabId, url: null });
        return;
      }
      applySnapshotsForTab({ tabId: info.tabId, url: tab.url || null });
      if (isConsentActive()) {
        fetchConsentSnapshot({ silent: true, forceRender: true });
        startConsentPolling();
      } else {
        stopConsentPolling();
      }
    });
  });
}
if (chrome.tabs && chrome.tabs.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) {
      const tabUuid = tabIdToUuid.get(tabId);
    if (tabUuid) {
      storageSnapshotsByTab.delete(tabUuid);
      consentSnapshotsByTab.delete(tabUuid);
      consentCoreSignaturesByTab.delete(tabUuid);
    }
    tabIdToUuid.delete(tabId);
    clearSessionSnapshots(tabUuid);
    if (tabId === currentTabId) {
        setStorageEmpty('No snapshot yet for this tab.');
        setConsentEmpty('No snapshot yet for this tab.');
        if (isConsentActive()) {
          fetchConsentSnapshot({ silent: true, forceRender: true });
          startConsentPolling();
        } else {
          stopConsentPolling();
        }
      }
    }
    if (changeInfo.status === 'complete' && tabId === currentTabId) {
      if (isConsentActive()) {
        fetchConsentSnapshot({ silent: true, forceRender: true });
        startConsentPolling();
      } else {
        stopConsentPolling();
      }
    }
  });
}

if (chrome.tabs && chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    const tabUuid = tabIdToUuid.get(tabId);
    if (tabUuid) {
      storageSnapshotsByTab.delete(tabUuid);
      consentSnapshotsByTab.delete(tabUuid);
      consentCoreSignaturesByTab.delete(tabUuid);
    }
    tabIdToUuid.delete(tabId);
    clearSessionSnapshots(tabUuid);
  });
}
