const featureButtons = Array.from(document.querySelectorAll('[data-feature]'));
const topTabButtons = Array.from(document.querySelectorAll('[data-top-tab]'));
const toolsView = document.getElementById('tools-view');
const guideView = document.getElementById('guide-view');
const exportView = document.getElementById('export-view');
const recentView = document.getElementById('recent-view');
const recentList = document.getElementById('recent-list');
const recentStatus = document.getElementById('recent-status');
const featureNav = document.querySelector('.feature-nav');
const featureScrollButtons = Array.from(
  document.querySelectorAll('.feature-scroll')
);
const featureSections = new Map([
  ['logger', document.getElementById('feature-logger')],
  ['session', document.getElementById('feature-session')],
  ['rules', document.getElementById('feature-rules')],
  ['payloads', document.getElementById('feature-payloads')],
  ['iq', document.getElementById('feature-iq')],
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
  if (guideView) {
    guideView.classList.toggle('active', tab === 'guide');
    guideView.setAttribute('aria-hidden', tab === 'guide' ? 'false' : 'true');
  }
  if (exportView) {
    exportView.classList.toggle('active', tab === 'export');
    exportView.setAttribute('aria-hidden', tab === 'export' ? 'false' : 'true');
  }
  if (recentView) {
    recentView.classList.toggle('active', tab === 'recent');
    recentView.setAttribute('aria-hidden', tab === 'recent' ? 'false' : 'true');
  }
  if (tab === 'export') {
    stopConsentPolling();
    refreshExportPreview();
  } else if (tab === 'recent') {
    stopConsentPolling();
    loadRecentExports();
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

const updateFeatureScrollButtons = () => {
  if (!featureNav || featureScrollButtons.length === 0) {
    return;
  }
  const maxScroll = featureNav.scrollWidth - featureNav.clientWidth;
  featureScrollButtons.forEach((button) => {
    const direction = button.dataset.scroll;
    if (direction === 'left') {
      button.disabled = featureNav.scrollLeft <= 0;
    } else {
      button.disabled = featureNav.scrollLeft >= maxScroll - 1;
    }
  });
};

if (featureNav && featureScrollButtons.length) {
  featureScrollButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const direction = button.dataset.scroll === 'left' ? -1 : 1;
      const delta = Math.round(featureNav.clientWidth * 0.7) * direction;
      featureNav.scrollBy({ left: delta, behavior: 'smooth' });
    });
  });
  featureNav.addEventListener('scroll', () => {
    updateFeatureScrollButtons();
  });
  window.addEventListener('resize', updateFeatureScrollButtons);
  requestAnimationFrame(updateFeatureScrollButtons);
}

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
const utagdbCookieButton = document.getElementById('utagdb-cookie');
const utagdbCookieStatus = document.getElementById('utagdb-cookie-status');
const utagdbCookieIndicator = document.getElementById('utagdb-cookie-indicator');

let storageData = null;
let storageFilter = '';
let currentTabId = null;
let currentTabUuid = null;
const tabIdToUuid = new Map();
const storageSnapshotsByTab = new Map();
const consentSnapshotsByTab = new Map();
const consentCoreSignaturesByTab = new Map();
const iqSnapshotsByTab = new Map();
const iqTokensByTab = new Map();
const iqHostsByTab = new Map();
const iqAccountsByTab = new Map();
const iqProfilesByTab = new Map();
const iqUsernamesByTab = new Map();
const iqKeysByTab = new Map();
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
  iqProfile: `iqProfileSnapshot:tab:${tabUuid}`,
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
  storageLocal.remove([keys.storage, keys.consent, keys.iqProfile]);
};

const getActiveTabInfo = (callback) => {
  const pickTab = (tabs) => {
    const activeTab = tabs && tabs[0] ? tabs[0] : null;
    const tabId = activeTab && activeTab.id ? activeTab.id : null;
    const url = activeTab && typeof activeTab.url === 'string' ? activeTab.url : null;
    callback({ tabId, url });
  };
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    if (tabs && tabs.length) {
      pickTab(tabs);
      return;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, (fallbackTabs) => {
      if (fallbackTabs && fallbackTabs.length) {
        pickTab(fallbackTabs);
        return;
      }
      chrome.tabs.query({ active: true }, (anyTabs) => {
        pickTab(anyTabs);
      });
    });
  });
};

const requestConsentSnapshotDirect = (tabId, callback) => {
  if (!tabId) {
    callback({ ok: false, error: 'No active tab' });
    return;
  }
  const requestSnapshot = () => {
    chrome.tabs.sendMessage(tabId, { type: 'get_consent_status' }, (response) => {
      if (chrome.runtime.lastError) {
        callback({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      callback(response || { ok: false, error: 'No response' });
    });
  };
  chrome.tabs.sendMessage(tabId, { type: 'get_consent_status' }, () => {
    if (chrome.runtime.lastError) {
      chrome.scripting.executeScript(
        { target: { tabId }, files: ['content.js'] },
        () => {
          if (chrome.runtime.lastError) {
            callback({ ok: false, error: chrome.runtime.lastError.message });
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

const sendMessageWithInjection = (tabId, message, callback) => {
  if (!tabId) {
    callback({ ok: false, error: 'No active tab' });
    return;
  }
  const send = () => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        callback({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      callback(response || { ok: false, error: 'No response' });
    });
  };
  chrome.tabs.sendMessage(tabId, message, () => {
    if (chrome.runtime.lastError) {
      chrome.scripting.executeScript(
        { target: { tabId }, files: ['content.js'] },
        () => {
          if (chrome.runtime.lastError) {
            callback({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          send();
        }
      );
      return;
    }
    send();
  });
};

const getActiveTabUrl = () => {
  try {
    if (window && window.lastActiveTabUrl) {
      return window.lastActiveTabUrl;
    }
  } catch (err) {
    return null;
  }
  return null;
};

const setUtagdbCookieStatus = (message, isError) => {
  if (!utagdbCookieStatus) {
    return;
  }
  utagdbCookieStatus.textContent = message;
  utagdbCookieStatus.style.color = isError ? '#ff6b6b' : '';
};

const setUtagdbCookieIndicator = (isOn) => {
  if (!utagdbCookieIndicator) {
    return;
  }
  utagdbCookieIndicator.classList.toggle('is-on', Boolean(isOn));
};

const setUtagdbCookieButtonLabel = (isOn) => {
  if (!utagdbCookieButton) {
    return;
  }
  utagdbCookieButton.textContent = isOn
    ? 'Disable utagdb Cookie'
    : 'Enable utagdb Cookie';
};

const refreshUtagdbCookieIndicator = () => {
  if (!utagdbCookieIndicator) {
    return;
  }
  chrome.runtime.sendMessage({ type: 'get_utagdb_cookie' }, (response) => {
    if (chrome.runtime.lastError || !response || !response.ok) {
      setUtagdbCookieIndicator(false);
      setUtagdbCookieButtonLabel(false);
      return;
    }
    const enabled = Boolean(response && response.enabled);
    setUtagdbCookieIndicator(enabled);
    setUtagdbCookieButtonLabel(enabled);
  });
};

const toggleUtagdbCookie = () => {
  if (!utagdbCookieButton) {
    return;
  }
  chrome.runtime.sendMessage({ type: 'get_utagdb_cookie' }, (status) => {
    if (chrome.runtime.lastError || !status || !status.ok) {
      setUtagdbCookieStatus(
        status && status.error ? status.error : 'Failed to read cookie.',
        true
      );
      return;
    }
    const isEnabled = Boolean(status && status.enabled);
    const nextEnabled = !isEnabled;
    setUtagdbCookieStatus(
      nextEnabled ? 'Setting utagdb cookie...' : 'Clearing utagdb cookie...',
      false
    );
    chrome.runtime.sendMessage(
      { type: 'set_utagdb_cookie', enabled: nextEnabled },
      (response) => {
        if (chrome.runtime.lastError || !response || !response.ok) {
          setUtagdbCookieStatus(
            response && response.error ? response.error : 'Failed to set cookie.',
            true
          );
          return;
        }
        setUtagdbCookieStatus(
          nextEnabled ? 'utagdb cookie enabled.' : 'utagdb cookie disabled.',
          false
        );
        setUtagdbCookieIndicator(nextEnabled);
        setUtagdbCookieButtonLabel(nextEnabled);
      }
    );
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
const consentCmps = document.getElementById('consent-cmps');
const consentPresent = document.getElementById('consent-present');
const consentSources = document.getElementById('consent-sources');
const consentState = document.getElementById('consent-state');
const consentGpc = document.getElementById('consent-gpc');
const consentRegulatory = document.getElementById('consent-regulatory');
const consentRegulatorySources = document.getElementById('consent-regulatory-sources');
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
const loggerToggleButton = document.getElementById('logger-toggle');
const loggerClearButton = document.getElementById('logger-clear');
const loggerCopyButton = document.getElementById('logger-copy');
const exportCopyButton = document.getElementById('export-copy');
const iqAccountInput = document.getElementById('iq-account');
const iqProfileInput = document.getElementById('iq-profile');
const iqUsernameInput = document.getElementById('iq-username');
const iqKeyInput = document.getElementById('iq-key');
const iqTokenInput = document.getElementById('iq-token');
const iqHostInput = document.getElementById('iq-host');
const iqAuthButton = document.getElementById('iq-auth');
const iqFetchButton = document.getElementById('iq-fetch');
const iqStatus = document.getElementById('iq-status');
const iqPreview = document.getElementById('iq-preview');
const iqPreviewCount = document.getElementById('iq-preview-count');
const iqCopyButton = document.getElementById('iq-copy');
const iqMeta = document.getElementById('iq-meta');
const iqMetaSection = document.getElementById('iq-meta-section');
const iqMetaUrl = document.getElementById('iq-meta-url');
const iqMetaTime = document.getElementById('iq-meta-time');
const iqRecentList = document.getElementById('iq-recent-list');
const iqRecentCount = document.getElementById('iq-recent-count');
const iqIncludeInputs = Array.from(document.querySelectorAll('.iq-include'));
const iqIncludesCustom = document.getElementById('iq-includes-custom');
const exportIncludeLogger = document.getElementById('export-include-logger');
const exportIncludeConsent = document.getElementById('export-include-consent');
const exportIncludeIq = document.getElementById('export-include-iq');
const exportRedactUrls = document.getElementById('export-redact-urls');
const exportRedactSignals = document.getElementById('export-redact-signals');
const exportSize = document.getElementById('export-size');
let exportCaseFileText = '';
let exportCaseFileObject = null;
const LOGGER_PREVIEW_LIMIT = 200;
let loggerPreviewRawText = '';
let iqPreviewRawText = '';
const EXPORT_HISTORY_KEY = 'exportHistory';
const EXPORT_HISTORY_LIMIT = 3;
const IQ_RECENT_KEY = 'iqRecentInputs';
const IQ_RECENT_LIMIT = 5;
const pendingExportDownloads = new Map();
let loggerShowAll = false;
const sectionToggles = Array.from(document.querySelectorAll('.section-toggle'));
const PERSISTENT_KEYS = new Set([EXPORT_HISTORY_KEY, IQ_RECENT_KEY]);

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

const resetEphemeralState = () => {
  tabIdToUuid.clear();
  storageSnapshotsByTab.clear();
  consentSnapshotsByTab.clear();
  consentCoreSignaturesByTab.clear();
  iqSnapshotsByTab.clear();
  iqTokensByTab.clear();
  iqHostsByTab.clear();
  iqAccountsByTab.clear();
  iqProfilesByTab.clear();
  iqUsernamesByTab.clear();
  iqKeysByTab.clear();
  storageData = null;
  storageFilter = '';
  currentTabId = null;
  currentTabUuid = null;
  loggerShowAll = false;
};

const clearEphemeralStorage = () => {
  if (!storageLocal) {
    return;
  }
  storageLocal.get(null, (items) => {
    if (chrome.runtime.lastError) {
      return;
    }
    const keysToRemove = Object.keys(items || {}).filter(
      (key) => !PERSISTENT_KEYS.has(key)
    );
    if (keysToRemove.length === 0) {
      return;
    }
    storageLocal.remove(keysToRemove, () => {
      resetEphemeralState();
      refreshLoggerPreview();
      if (exportStatus) {
        exportStatus.textContent = 'No preview yet.';
      }
      if (exportPreview) {
        exportPreview.textContent = '';
      }
      exportCaseFileText = '';
      exportCaseFileObject = null;
      if (exportSize) {
        exportSize.textContent = '';
      }
    });
  });
};

const setSectionCollapsed = (button, collapsed) => {
  const sectionId = button.dataset.section;
  if (!sectionId) {
    return;
  }
  const body = document.querySelector(`[data-section-body="${sectionId}"]`);
  if (!body) {
    return;
  }
  body.classList.toggle('is-collapsed', collapsed);
  button.setAttribute('aria-expanded', String(!collapsed));
};

sectionToggles.forEach((button) => {
  setSectionCollapsed(button, button.getAttribute('aria-expanded') === 'false');
  button.addEventListener('click', () => {
    const isExpanded = button.getAttribute('aria-expanded') !== 'false';
    setSectionCollapsed(button, isExpanded);
  });
});

if (storageLocal) {
  storageLocal.get([EXPORT_HISTORY_KEY], (items) => {
    const history = Array.isArray(items[EXPORT_HISTORY_KEY])
      ? items[EXPORT_HISTORY_KEY]
      : [];
    if (history.length <= EXPORT_HISTORY_LIMIT) {
      return;
    }
    storageLocal.set(
      { [EXPORT_HISTORY_KEY]: history.slice(0, EXPORT_HISTORY_LIMIT) },
      () => {
        loadRecentExports();
      }
    );
  });
}


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

const renderPreviewLines = (previewEl, text) => {
  if (!previewEl) {
    return 0;
  }
  const lines = String(text || '').split('\n');
  const padded = String(lines.length).length;
  const numbered = lines
    .map(
      (line, index) =>
        `<span class="preview-line">` +
        `<span class="preview-line-number" aria-hidden="true">${String(
          index + 1
        ).padStart(padded, ' ')}</span>` +
        `<span class="preview-line-sep" aria-hidden="true"> | </span>` +
        `<span class="preview-line-text">${escapeHtml(line)}</span>` +
        `</span>`
    )
    .join('');
  previewEl.innerHTML = numbered;
  return lines.length;
};

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes)) {
    return '';
  }
  if (bytes < 1024) {
    return `${bytes} bytes`;
  }
  const units = ['KB', 'MB', 'GB'];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(2)} ${units[unitIndex]}`;
};

const getSecondLevelDomain = (rawUrl) => {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return '';
  }
  try {
    const url = new URL(rawUrl);
    const host = url.hostname || '';
    const parts = host.split('.').filter(Boolean);
    if (parts.length >= 2) {
      return parts.slice(-2).join('.');
    }
    return host;
  } catch (err) {
    return '';
  }
};

const renderCaseFilePreviewWithLogNumbers = (previewEl, caseFile) => {
  if (!previewEl) {
    return;
  }
  const previewText = JSON.stringify(caseFile || {}, null, 2);
  const lines = previewText.split('\n');
  const totalLogs =
    caseFile &&
    caseFile.utagdb_logger &&
    Array.isArray(caseFile.utagdb_logger.logs)
      ? caseFile.utagdb_logger.logs.length
      : 0;
  const padWidth = Math.max(1, String(totalLogs || 0).length);
  let inLogs = false;
  let logsIndent = 0;
  let entryDepth = 0;
  let entryIndex = 0;

  const countBrackets = (line) => {
    let delta = 0;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) {
        continue;
      }
      if (ch === '{' || ch === '[') {
        delta += 1;
      } else if (ch === '}' || ch === ']') {
        delta -= 1;
      }
    }
    return delta;
  };

  const getIndent = (line) => {
    const match = line.match(/^\s*/);
    return match ? match[0].length : 0;
  };

  const formatted = lines.map((line) => {
    const trimmed = line.trim();
    const indent = getIndent(line);
    let prefix = '';

    if (!inLogs && trimmed.startsWith('"logs": [')) {
      inLogs = true;
      logsIndent = indent;
      entryDepth = 0;
    } else if (inLogs && trimmed === ']' && indent === logsIndent) {
      inLogs = false;
      entryDepth = 0;
    } else if (inLogs) {
      const isEntryStart = entryDepth === 0 && trimmed !== '';
      if (isEntryStart) {
        entryIndex += 1;
        prefix = String(entryIndex);
      }
      entryDepth += countBrackets(line);
      if (entryDepth < 0) {
        entryDepth = 0;
      }
    }

    const paddedPrefix = prefix
      ? prefix.padStart(padWidth, ' ')
      : ' '.repeat(padWidth);

    return (
      `<span class="preview-line">` +
      `<span class="preview-line-number" aria-hidden="true">${escapeHtml(
        paddedPrefix
      )}</span>` +
      `<span class="preview-line-sep" aria-hidden="true"> | </span>` +
      `<span class="preview-line-text">${escapeHtml(line)}</span>` +
      `</span>`
    );
  });

  previewEl.innerHTML = formatted.join('');
};

const formatLogEntryForPreview = (entry) => {
  if (entry == null) {
    return '';
  }
  if (typeof entry === 'string') {
    return stringifyLogArg(entry);
  }
  if (typeof entry !== 'object') {
    return String(entry);
  }
  const next = { ...entry };
  if (next.console && Array.isArray(next.console.args)) {
    next.console = {
      ...next.console,
      args: next.console.args.map(parseJsonString),
    };
  }
  try {
    return JSON.stringify(next, null, 2);
  } catch (err) {
    return stringifyLogArg(next);
  }
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
      if (loggerToggleButton) {
        const hasOverflow = logs.length > LOGGER_PREVIEW_LIMIT;
        loggerToggleButton.disabled = !hasOverflow;
        if (!hasOverflow) {
          loggerShowAll = false;
        }
        loggerToggleButton.textContent = loggerShowAll
          ? `Show first ${LOGGER_PREVIEW_LIMIT}`
          : 'Show all';
      }
      if (logs.length === 0) {
        loggerPreview.textContent = 'No logs yet.';
        return;
      }
      const startIndex = 0;
      const slice = loggerShowAll ? logs : logs.slice(0, LOGGER_PREVIEW_LIMIT);
      const pad = String(logs.length).length;
      let rawText = '';
      const formatted = [];
      slice.forEach((entry, index) => {
        const logNumber = String(startIndex + index + 1).padStart(pad, ' ');
        const prettyEntry = formatLogEntryForPreview(entry);
        if (rawText) {
          rawText += '\n\n';
        }
        rawText += prettyEntry;
        const entryLines = prettyEntry.split('\n');
        entryLines.forEach((line, lineIndex) => {
          const prefix = lineIndex === 0 ? logNumber : ' '.repeat(pad);
          formatted.push(
            `<span class="preview-line">` +
              `<span class="preview-line-number" aria-hidden="true">${escapeHtml(
                prefix
              )}</span>` +
              `<span class="preview-line-sep" aria-hidden="true"> | </span>` +
              `<span class="preview-line-text">${escapeHtml(line)}</span>` +
              `</span>`
          );
        });
      });
      loggerPreview.innerHTML = formatted.join('');
      loggerPreviewRawText = rawText;
    });
  });
};

const setIqStatus = (message, isError) => {
  if (!iqStatus) {
    return;
  }
  iqStatus.textContent = message;
  iqStatus.style.color = isError ? '#ff6b6b' : '';
  if (iqMetaSection) {
    iqMetaSection.hidden = Boolean(message);
  }
};

const setIqToken = (token) => {
  if (iqTokenInput) {
    iqTokenInput.value = token || '';
  }
};

const setIqHost = (host) => {
  if (iqHostInput) {
    iqHostInput.value = host || '';
  }
};

const setCopyState = (button, isCopied) => {
  if (!button) {
    return;
  }
  const label = button.querySelector('.iq-copy-text');
  if (isCopied) {
    button.classList.add('copied');
    if (label) {
      label.textContent = 'Copied';
    }
    window.setTimeout(() => {
      button.classList.remove('copied');
      if (label) {
        label.textContent = 'Copy';
      }
    }, 1400);
    return;
  }
  button.classList.remove('copied');
  if (label) {
    label.textContent = 'Copy';
  }
};

const setButtonLoading = (button, isLoading) => {
  if (!button) {
    return;
  }
  button.classList.toggle('is-loading', isLoading);
  button.disabled = Boolean(isLoading);
};

const getIqFormValues = () => ({
  account: iqAccountInput ? iqAccountInput.value.trim() : '',
  profile: iqProfileInput ? iqProfileInput.value.trim() : '',
  username: iqUsernameInput ? iqUsernameInput.value.trim() : '',
  key: iqKeyInput ? iqKeyInput.value.trim() : '',
  host: iqHostInput ? iqHostInput.value.trim() : '',
});

const applyIqFormForTab = (tabUuid) => {
  if (iqAccountInput) {
    iqAccountInput.value = tabUuid ? iqAccountsByTab.get(tabUuid) || '' : '';
  }
  if (iqProfileInput) {
    iqProfileInput.value = tabUuid ? iqProfilesByTab.get(tabUuid) || '' : '';
  }
  if (iqUsernameInput) {
    iqUsernameInput.value = tabUuid ? iqUsernamesByTab.get(tabUuid) || '' : '';
  }
  if (iqKeyInput) {
    iqKeyInput.value = tabUuid ? iqKeysByTab.get(tabUuid) || '' : '';
  }
  if (iqTokenInput) {
    const token = tabUuid ? iqTokensByTab.get(tabUuid) || '' : '';
    iqTokenInput.value = token;
  }
  if (iqHostInput) {
    const host = tabUuid ? iqHostsByTab.get(tabUuid) || '' : '';
    iqHostInput.value = host;
  }
};

const updateIqMap = (map, value) => {
  const tabUuid = getCurrentTabUuid();
  if (!tabUuid) {
    return;
  }
  map.set(tabUuid, value || '');
};

const getIqRecentSignature = (entry) =>
  [
    entry.account || '',
    entry.profile || '',
    entry.username || '',
    entry.host || '',
  ].join('::');

const renderIqRecents = (items) => {
  if (!iqRecentList) {
    return;
  }
  iqRecentList.innerHTML = '';
  const list = Array.isArray(items) ? items : [];
  if (iqRecentCount) {
    iqRecentCount.textContent = String(list.length);
  }
  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'iq-recent-empty';
    empty.textContent = 'No recent clients yet.';
    iqRecentList.appendChild(empty);
    return;
  }
  list.forEach((entry) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'iq-recent-item';
    const title = document.createElement('div');
    title.className = 'iq-recent-title';
    title.textContent = `${entry.account || 'account'} / ${entry.profile || 'profile'}`;
    const meta = document.createElement('div');
    meta.className = 'iq-recent-meta';
    const hostLabel = entry.host ? ` • ${entry.host}` : '';
    meta.textContent = `${entry.username || 'username'}${hostLabel}`;
    item.appendChild(title);
    item.appendChild(meta);
    item.addEventListener('click', () => {
      if (iqAccountInput) {
        iqAccountInput.value = entry.account || '';
      }
      if (iqProfileInput) {
        iqProfileInput.value = entry.profile || '';
      }
      if (iqUsernameInput) {
        iqUsernameInput.value = entry.username || '';
      }
      if (iqKeyInput) {
        iqKeyInput.value = entry.key || '';
      }
      if (iqHostInput) {
        iqHostInput.value = '';
      }
      if (iqTokenInput) {
        iqTokenInput.value = '';
      }
      const tabUuid = getCurrentTabUuid();
      if (tabUuid) {
        iqAccountsByTab.set(tabUuid, entry.account || '');
        iqProfilesByTab.set(tabUuid, entry.profile || '');
        iqUsernamesByTab.set(tabUuid, entry.username || '');
        iqKeysByTab.set(tabUuid, entry.key || '');
        iqHostsByTab.set(tabUuid, '');
        iqTokensByTab.set(tabUuid, '');
      }
      saveIqRecentInputs(entry);
    });
    iqRecentList.appendChild(item);
  });
};

const loadIqRecents = () => {
  if (!storageLocal) {
    return;
  }
  storageLocal.get({ [IQ_RECENT_KEY]: [] }, (items) => {
    const list = Array.isArray(items[IQ_RECENT_KEY]) ? items[IQ_RECENT_KEY] : [];
    renderIqRecents(list);
  });
};

const saveIqRecentInputs = (entry) => {
  if (!storageLocal) {
    return;
  }
  const nextEntry = {
    account: entry.account || '',
    profile: entry.profile || '',
    username: entry.username || '',
    key: entry.key || '',
    host: entry.host || '',
    savedAt: new Date().toISOString(),
  };
  const signature = getIqRecentSignature(nextEntry);
  storageLocal.get({ [IQ_RECENT_KEY]: [] }, (items) => {
    const current = Array.isArray(items[IQ_RECENT_KEY]) ? items[IQ_RECENT_KEY] : [];
    const deduped = current.filter(
      (item) => getIqRecentSignature(item) !== signature
    );
    const nextList = [nextEntry, ...deduped].slice(0, IQ_RECENT_LIMIT);
    storageLocal.set({ [IQ_RECENT_KEY]: nextList }, () => {
      renderIqRecents(nextList);
    });
  });
};

const getIqIncludes = () => {
  const includes = new Set();
  iqIncludeInputs.forEach((input) => {
    if (input.checked && input.value) {
      includes.add(input.value.trim());
    }
  });
  if (iqIncludesCustom && iqIncludesCustom.value) {
    iqIncludesCustom.value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((value) => includes.add(value));
  }
  return Array.from(includes);
};

const applyIqSnapshot = (payload) => {
  if (!payload) {
    setIqStatus('No profile fetched yet.', false);
    if (iqMetaSection) {
      iqMetaSection.hidden = true;
    }
    if (iqPreview) {
      iqPreview.textContent = '';
    }
    if (iqPreviewCount) {
      iqPreviewCount.textContent = '0';
    }
    return;
  }
  const capturedAt = payload.captured_at
    ? new Date(payload.captured_at).toLocaleTimeString()
    : 'just now';
  const url = payload.url || 'profile';
  setIqStatus('', false);
  if (iqMetaUrl) {
    iqMetaUrl.textContent = url;
  }
  if (iqMetaTime) {
    iqMetaTime.textContent = `Snapshot at ${capturedAt}`;
  }
  if (iqMetaSection) {
    iqMetaSection.hidden = false;
  }
  let previewText = '';
  try {
    previewText = JSON.stringify(payload.response || {}, null, 2);
  } catch (err) {
    previewText = stringifyLogArg(payload.response || {});
  }
  iqPreviewRawText = previewText;
  const lineCount = renderPreviewLines(iqPreview, previewText);
  if (iqPreviewCount) {
    iqPreviewCount.textContent = String(lineCount || 0);
  }
};

const fetchIqToken = () => {
  const { account, profile, username, key } = getIqFormValues();
  if (!account || !profile) {
    setIqStatus('Account and profile are required.', true);
    return;
  }
  if (!username || !key) {
    setIqStatus('Username and API key are required.', true);
    return;
  }
  setButtonLoading(iqAuthButton, true);
  setIqStatus('Requesting token...', false);
  const url = `https://platform.tealiumapis.com/v3/auth/accounts/${encodeURIComponent(
    account
  )}/profiles/${encodeURIComponent(profile)}`;
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, key }).toString(),
  })
    .then((response) =>
      response.json().then((data) => ({ ok: response.ok, data }))
    )
    .then(({ ok, data }) => {
      if (!ok) {
        setIqStatus(data && data.message ? data.message : 'Failed to fetch token.', true);
        return;
      }
      const token =
        data.token ||
        data.accessToken ||
        data.access_token ||
        data.id_token ||
        data.session_token;
      const host = data.host || data.api_host || '';
      if (!token) {
        setIqStatus('Token missing from response.', true);
        setButtonLoading(iqAuthButton, false);
        return;
      }
      const tabUuid = getCurrentTabUuid();
      if (tabUuid) {
        iqTokensByTab.set(tabUuid, token);
        if (host) {
          iqHostsByTab.set(tabUuid, host);
        }
        iqAccountsByTab.set(tabUuid, account);
        iqProfilesByTab.set(tabUuid, profile);
        iqUsernamesByTab.set(tabUuid, username);
        iqKeysByTab.set(tabUuid, key);
      }
      setIqToken(token);
      if (host) {
        setIqHost(host);
      }
      setIqStatus('Token received.', false);
      saveIqRecentInputs({
        account,
        profile,
        username,
        key,
        host: host || getIqFormValues().host,
      });
      setButtonLoading(iqAuthButton, false);
    })
    .catch((err) => {
      setIqStatus(err.message || 'Failed to fetch token.', true);
      setButtonLoading(iqAuthButton, false);
    });
};

const fetchIqProfile = () => {
  const { account, profile, host } = getIqFormValues();
  const token = iqTokenInput ? iqTokenInput.value.trim() : '';
  if (!account || !profile) {
    setIqStatus('Account and profile are required.', true);
    return;
  }
  if (!token) {
    setIqStatus('Token is required.', true);
    return;
  }
  if (!host) {
    setIqStatus('Host is required.', true);
    return;
  }
  setButtonLoading(iqFetchButton, true);
  const includes = getIqIncludes();
  const params = new URLSearchParams();
  includes.forEach((value) => params.append('includes', value));
  const urlBase = `https://${host}/v3/tiq/accounts/${encodeURIComponent(
    account
  )}/profiles/${encodeURIComponent(profile)}`;
  const url = params.toString() ? `${urlBase}?${params}` : urlBase;
  setIqStatus('Fetching profile...', false);
  fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
    .then((response) =>
      response.json().then((data) => ({ ok: response.ok, data }))
    )
    .then(({ ok, data }) => {
      if (!ok) {
        setIqStatus(data && data.message ? data.message : 'Failed to fetch profile.', true);
        setButtonLoading(iqFetchButton, false);
        return;
      }
      const snapshot = {
        captured_at: new Date().toISOString(),
        url,
        account,
        profile,
        host,
        includes,
        response: data,
        tab_uuid: getCurrentTabUuid(),
      };
      const tabUuid = snapshot.tab_uuid;
      if (tabUuid) {
        iqSnapshotsByTab.set(tabUuid, snapshot);
        saveSessionSnapshot(getSessionKeys(tabUuid).iqProfile, snapshot);
      }
      applyIqSnapshot(snapshot);
      setButtonLoading(iqFetchButton, false);
    })
    .catch((err) => {
      setIqStatus(err.message || 'Failed to fetch profile.', true);
      setButtonLoading(iqFetchButton, false);
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
  const includeIq = !exportIncludeIq || exportIncludeIq.checked;
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
          if ('url' in next) {
            next.observed_url = next.url;
            delete next.url;
          }
          if (redactUrls) {
            next.observed_url = '[redacted]';
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
      const iqSnapshotKey = currentUuid
        ? `iqProfileSnapshot:tab:${currentUuid}`
        : null;
      let iqSnapshot = iqSnapshotKey ? items[iqSnapshotKey] : null;
      if (iqSnapshot && typeof iqSnapshot === 'object') {
        iqSnapshot = { ...iqSnapshot };
        if ('url' in iqSnapshot) {
          iqSnapshot.observed_url = iqSnapshot.url;
          delete iqSnapshot.url;
        }
        if (redactUrls && iqSnapshot.observed_url) {
          iqSnapshot.observed_url = '[redacted]';
        }
      }
      const sessionMeta = items[metaKey] || null;
      const sessionLogs = Array.isArray(items[logsKey]) ? items[logsKey] : [];
      const redactedLogs = redactUrls
        ? sessionLogs.map((entry) => {
            if (!entry || typeof entry !== 'object') {
              return entry;
            }
            return {
              ...entry,
              url: entry.url ? '[redacted]' : entry.url,
              console:
                entry.console && entry.console.url
                  ? { ...entry.console, url: '[redacted]' }
                  : entry.console,
            };
          })
        : sessionLogs;
      const caseFile = {
        generated_at: generatedAt,
        app: {
          name: manifest.name || 'Jarvis',
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
              session: sessionMeta
                ? {
                    ...sessionMeta,
                    observed_url: sessionMeta.observed_url || null,
                  }
                : null,
              logs: redactedLogs,
            }
          : null,
        consent_monitor: includeConsent
          ? {
              snapshot_count: consentSnapshots.length,
              snapshots: consentSnapshots,
            }
          : null,
        iq_profile: includeIq
          ? {
              snapshot: iqSnapshot || null,
            }
          : null,
      };
      callback(caseFile, null);
    });
  });
};

const renderRecentExports = (items) => {
  if (!recentList || !recentStatus) {
    return;
  }
  recentList.innerHTML = '';
  if (!items || items.length === 0) {
    recentStatus.textContent = 'No exports yet.';
    return;
  }
  recentStatus.textContent = '';
  items.forEach((item) => {
    const entry = document.createElement('div');
    entry.className = 'recent-item';
    const title = document.createElement('div');
    title.className = 'recent-title';
    title.textContent = item.filename || 'case-file.json';
    const meta = document.createElement('div');
    meta.className = 'recent-meta';
    const sizeText = formatBytes(item.size);
    meta.textContent = `${item.timestamp} • ${sizeText}`;
    let url = null;
    const sourceUrls = Array.isArray(item.sourceUrls)
      ? item.sourceUrls
      : item.sourceUrl
      ? [{ label: 'Source', url: item.sourceUrl }]
      : [];
    if (sourceUrls.length > 0) {
      sourceUrls.forEach((entry) => {
        const box = document.createElement('div');
        box.className = 'recent-url';
        const line = document.createElement('div');
        line.className = 'recent-url-line';
        line.textContent = `${entry.label}: ${entry.url}`;
        box.appendChild(line);
        if (!url) {
          url = document.createElement('div');
          url.className = 'recent-url-list';
          const title = document.createElement('div');
          title.className = 'recent-url-title';
          title.textContent = 'Observed URLs';
          url.appendChild(title);
        }
        url.appendChild(box);
      });
    }
    const tags = document.createElement('div');
    tags.className = 'recent-tags';
    (item.sections || []).forEach((section) => {
      const tag = document.createElement('span');
      tag.className = 'recent-tag';
      tag.textContent = section;
      tags.appendChild(tag);
    });
    entry.appendChild(title);
    entry.appendChild(meta);
    if (url) {
      entry.appendChild(url);
    }
    entry.appendChild(tags);
    recentList.appendChild(entry);
  });
};

const setFeatureExportIndicator = (feature, isOn) => {
  const card = document.querySelector(`.feature-card[data-feature="${feature}"]`);
  if (!card) {
    return;
  }
  const indicator = card.querySelector('.feature-indicator');
  if (!indicator) {
    return;
  }
  indicator.classList.toggle('is-on', Boolean(isOn));
};

const updateExportFeatureIndicators = (caseFile) => {
  const includeLogger = !exportIncludeLogger || exportIncludeLogger.checked;
  const includeConsent = !exportIncludeConsent || exportIncludeConsent.checked;
  const includeIq = !exportIncludeIq || exportIncludeIq.checked;
  const loggerReady =
    includeLogger &&
    caseFile &&
    caseFile.utagdb_logger &&
    Array.isArray(caseFile.utagdb_logger.logs) &&
    caseFile.utagdb_logger.logs.length > 0;
  const consentReady =
    includeConsent &&
    caseFile &&
    caseFile.consent_monitor &&
    Number.isFinite(caseFile.consent_monitor.snapshot_count) &&
    caseFile.consent_monitor.snapshot_count > 0;
  const iqReady =
    includeIq && caseFile && caseFile.iq_profile && caseFile.iq_profile.snapshot;

  setFeatureExportIndicator('logger', loggerReady);
  setFeatureExportIndicator('consent', consentReady);
  setFeatureExportIndicator('iq', Boolean(iqReady));
  setFeatureExportIndicator('session', false);
  setFeatureExportIndicator('rules', false);
  setFeatureExportIndicator('payloads', false);
  setFeatureExportIndicator('network', false);
  setFeatureExportIndicator('events', false);
  setFeatureExportIndicator('storage', false);
  setFeatureExportIndicator('qa', false);
};

const refreshExportIndicators = () => {
  buildCaseFile((caseFile, error) => {
    if (error || !caseFile) {
      updateExportFeatureIndicators(null);
      return;
    }
    updateExportFeatureIndicators(caseFile);
  });
};

const loadRecentExports = () => {
  if (!storageLocal) {
    renderRecentExports([]);
    return;
  }
  storageLocal.get([EXPORT_HISTORY_KEY], (items) => {
    if (chrome.runtime.lastError) {
      if (recentStatus) {
        recentStatus.textContent = chrome.runtime.lastError.message;
      }
      return;
    }
    const history = Array.isArray(items[EXPORT_HISTORY_KEY])
      ? items[EXPORT_HISTORY_KEY]
      : [];
    renderRecentExports(history);
  });
};

const saveRecentExport = (filename, size, sections, sourceUrls) => {
  if (!storageLocal) {
    return;
  }
  storageLocal.get([EXPORT_HISTORY_KEY], (items) => {
    const history = Array.isArray(items[EXPORT_HISTORY_KEY])
      ? items[EXPORT_HISTORY_KEY]
      : [];
    const next = [
      {
        filename,
        size,
        sections,
        timestamp: new Date().toLocaleString(),
        sourceUrls,
      },
      ...history,
    ].slice(0, EXPORT_HISTORY_LIMIT);
    storageLocal.set({ [EXPORT_HISTORY_KEY]: next });
  });
};

const getSourceUrlsFromCaseFile = (caseFile) => {
  const urls = [];
  if (!caseFile || typeof caseFile !== 'object') {
    return urls;
  }
  const loggerUrl =
    caseFile.utagdb_logger &&
    caseFile.utagdb_logger.session &&
    caseFile.utagdb_logger.session.observed_url
      ? caseFile.utagdb_logger.session.observed_url
      : null;
  if (loggerUrl) {
    urls.push({ label: 'utag.DB', url: loggerUrl });
  }
  const consentSnapshots =
    caseFile.consent_monitor && Array.isArray(caseFile.consent_monitor.snapshots)
      ? caseFile.consent_monitor.snapshots
      : [];
  if (consentSnapshots.length > 0 && consentSnapshots[0].observed_url) {
    urls.push({ label: 'Consent', url: consentSnapshots[0].observed_url });
  }
  const iqSnapshot = caseFile.iq_profile && caseFile.iq_profile.snapshot;
  if (iqSnapshot && iqSnapshot.observed_url) {
    urls.push({ label: 'iQ', url: iqSnapshot.observed_url });
  }
  return urls;
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
    if (typeof entry === 'string') {
      return parseJsonString(entry);
    }
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
  const exportStatusInline = document.getElementById('export-status-inline');
  if (!exportPreview) {
    return;
  }
  if (exportStatusInline) {
    exportStatusInline.textContent = 'Building case file...';
  } else if (exportStatus) {
    exportStatus.textContent = 'Building case file...';
  }
  buildCaseFile((caseFile, error) => {
    if (error) {
      if (exportStatusInline) {
        exportStatusInline.textContent = error;
      } else if (exportStatus) {
        exportStatus.textContent = error;
      }
      exportPreview.textContent = '';
      exportCaseFileText = '';
      if (exportSize) {
        exportSize.textContent = '';
      }
      updateExportFeatureIndicators(null);
      return;
    }
    exportCaseFileObject = caseFile;
    exportCaseFileText = JSON.stringify(caseFile, null, 2);
    const previewCaseFile = transformCaseFileForPreview(caseFile);
    renderCaseFilePreviewWithLogNumbers(exportPreview, previewCaseFile);
  if (exportCopyButton) {
    exportCopyButton.dataset.raw = exportCaseFileText;
  }
    const previewText = `Preview updated at ${new Date().toLocaleTimeString()}`;
    if (exportStatusInline) {
      exportStatusInline.textContent = previewText;
    } else if (exportStatus) {
      exportStatus.textContent = previewText;
    }
    if (exportSize) {
      const blob = new Blob([exportCaseFileText], { type: 'application/json' });
      exportSize.textContent = `Estimated size: ${formatBytes(blob.size)}`;
    }
    updateExportFeatureIndicators(caseFile);
  });
}

const exportCaseFile = () => {
  buildCaseFile((caseFile, error) => {
    if (error || !caseFile) {
      if (exportStatus) {
        exportStatus.textContent = error || 'Failed to build case file.';
      }
      updateExportFeatureIndicators(null);
      return;
    }
    exportCaseFileObject = caseFile;
    exportCaseFileText = JSON.stringify(caseFile, null, 2);
    updateExportFeatureIndicators(caseFile);
    const timestamp = new Date().toISOString();
    const blob = new Blob([exportCaseFileText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const filename = formatCaseFileName(timestamp);
    const sections = [];
    if (!exportIncludeLogger || exportIncludeLogger.checked) {
      sections.push('utag.DB');
    }
    if (!exportIncludeConsent || exportIncludeConsent.checked) {
      sections.push('Consent');
    }
    if (!exportIncludeIq || exportIncludeIq.checked) {
      sections.push('iQ Profile');
    }
    const size = blob.size;
    const sourceUrls = getSourceUrlsFromCaseFile(exportCaseFileObject);
    if (exportSize) {
      exportSize.textContent = `Estimated size: ${formatBytes(size)}`;
    }
    chrome.downloads.download(
      {
        url,
        filename,
        saveAs: true,
      },
      (downloadId) => {
        URL.revokeObjectURL(url);
        if (!downloadId) {
          return;
        }
        pendingExportDownloads.set(downloadId, {
          filename,
          size,
          sections,
          sourceUrls,
          saved: true,
        });
        saveRecentExport(filename, size, sections, sourceUrls);
        loadRecentExports();
      }
    );
  });
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
if (exportIncludeIq) {
  exportIncludeIq.addEventListener('change', refreshExportPreview);
}

if (iqRecentList) {
  loadIqRecents();
}
if (iqAuthButton) {
  iqAuthButton.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fetchIqToken();
  });
}
if (iqFetchButton) {
  iqFetchButton.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fetchIqProfile();
  });
}
if (iqCopyButton) {
  iqCopyButton.addEventListener('click', () => {
    if (!iqPreviewRawText) {
      setIqStatus('No preview to copy yet.', true);
      return;
    }
    navigator.clipboard
      .writeText(iqPreviewRawText)
      .then(() => {
        setIqStatus('Preview copied to clipboard.', false);
        setCopyState(iqCopyButton, true);
      })
      .catch(() => {
        setIqStatus('Clipboard copy failed.', true);
      });
  });
}
if (iqAccountInput) {
  iqAccountInput.addEventListener('input', (event) => {
    updateIqMap(iqAccountsByTab, event.target.value);
  });
}
if (iqProfileInput) {
  iqProfileInput.addEventListener('input', (event) => {
    updateIqMap(iqProfilesByTab, event.target.value);
  });
}
if (iqUsernameInput) {
  iqUsernameInput.addEventListener('input', (event) => {
    updateIqMap(iqUsernamesByTab, event.target.value);
  });
}
if (iqKeyInput) {
  iqKeyInput.addEventListener('input', (event) => {
    updateIqMap(iqKeysByTab, event.target.value);
  });
}
if (iqTokenInput) {
  iqTokenInput.addEventListener('input', (event) => {
    updateIqMap(iqTokensByTab, event.target.value);
  });
}
if (iqHostInput) {
  iqHostInput.addEventListener('input', (event) => {
    updateIqMap(iqHostsByTab, event.target.value);
  });
}

refreshLoggerPreview();
refreshExportIndicators();

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
    const hasExportIndicatorUpdate = keys.some(
      (key) =>
        key.startsWith('utagdbLogs:session:') ||
        key.startsWith('consentSnapshot:tab:') ||
        key.startsWith('iqProfileSnapshot:tab:')
    );
    if (hasExportIndicatorUpdate) {
      refreshExportIndicators();
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

if (utagdbCookieButton) {
  utagdbCookieButton.addEventListener('click', toggleUtagdbCookie);
}

const renderConsentSignals = (signals) => {
  if (!consentSignalList) {
    return;
  }
  const signalHelp = {
    'OneTrust isGpcEnabled':
      'OneTrust CMP decision about whether GPC is enabled for this user/session (can differ from the raw browser signal).',
    'OneTrust browserGpcFlag':
      'Raw browser signal captured by OneTrust from navigator.globalPrivacyControl (0/1).',
    'GPC signal (page)':
      'Page context navigator.globalPrivacyControl (what DevTools console shows in the page).',
    'GPC signal (content script)':
      'Extension content-script context navigator.globalPrivacyControl (isolated from page overrides).',
  };
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
    const normalizedValue =
      signal.label === 'GPC signal (content script)' && signal.value === undefined
        ? 'Unavailable in extension context'
        : normalizeValue(signal.value);
    value.textContent = normalizedValue;
    const helpText = signalHelp[signal.label];
    const helper = helpText ? document.createElement('div') : null;
    if (helper) {
      helper.className = 'signal-helper';
      helper.textContent = helpText;
    }
    item.appendChild(key);
    if (helper) {
      item.appendChild(helper);
    }
    item.appendChild(value);
    consentSignalList.appendChild(item);
  });
  if (consentSignalCount) {
    consentSignalCount.textContent = String(signals.length);
  }
};

const renderConsentState = (value, tone) => {
  if (!consentState) {
    return;
  }
  consentState.innerHTML = '';

  const multiPartStates = ['Rejected', 'Strictly Necessary Only', 'Partial', 'Accepted'];

  if (multiPartStates.includes(value)) {
    // Render multi-part pill
    const multiPill = document.createElement('div');
    multiPill.className = 'consent-pill-multi';

    // Map values to normalized display
    const normalizedValue =
      value === 'Rejected' || value === 'Strictly Necessary Only' ? 'No Consent' :
      value === 'Accepted' ? 'Full Consent' :
      value;

    const states = [
      { label: 'No Consent', tone: 'bad' },
      { label: 'Partial', tone: 'warn' },
      { label: 'Full Consent', tone: 'ok' }
    ];

    states.forEach((state) => {
      const segment = document.createElement('div');
      segment.className = 'consent-segment';
      segment.textContent = state.label;

      if (state.label === normalizedValue) {
        segment.classList.add('active', state.tone);
      } else {
        segment.classList.add('inactive');
      }

      multiPill.appendChild(segment);
    });

    consentState.appendChild(multiPill);
  } else {
    // Render regular pill for Unknown, Not Required, etc.
    const pill = document.createElement('span');
    pill.className = 'consent-pill';
    pill.textContent = value || 'Unknown';
    if (tone) {
      pill.classList.add(tone);
    }
    consentState.appendChild(pill);
  }
};

const setConsentEmpty = (message) => {
  if (consentStatus) {
    consentStatus.textContent = message;
  }
  setConsentPill(consentRequired, 'Unknown', null);
  setConsentPill(consentPresent, 'Unknown', null);
  renderConsentState('Unknown', null);
  setConsentPill(consentGpc, 'Unknown', null);
  setConsentPill(consentRegulatory, 'Unknown', null);
  renderRegulatorySourcesList([]);
  renderCmpsList([]);
  renderConsentSourcesList([]);
  renderConsentCategories([]);
  renderConsentSignals([]);
  if (consentMeta) {
    consentMeta.textContent = '';
  }
};

const renderRegulatorySourcesList = (sources) => {
  if (!consentRegulatorySources) {
    return;
  }
  consentRegulatorySources.innerHTML = '';
  if (!Array.isArray(sources) || sources.length === 0) {
    return;
  }
  const header = document.createElement('div');
  header.className = 'storage-key';
  header.style.fontWeight = '500';
  header.style.color = '#888';
  header.style.fontSize = '0.85em';
  header.style.marginTop = '8px';
  header.style.marginBottom = '4px';
  header.textContent = 'Detection Sources:';
  consentRegulatorySources.appendChild(header);
  sources.forEach((source) => {
    const item = document.createElement('div');
    item.className = 'storage-item';
    const value = document.createElement('div');
    value.className = 'storage-value';
    value.textContent = source;
    item.appendChild(value);
    consentRegulatorySources.appendChild(item);
  });
};

const renderCmpsList = (cmps) => {
  if (!consentCmps) {
    return;
  }
  consentCmps.innerHTML = '';
  if (!Array.isArray(cmps) || cmps.length === 0) {
    return;
  }
  cmps.forEach((cmp) => {
    const item = document.createElement('div');
    item.className = 'storage-item';
    const value = document.createElement('div');
    value.className = 'storage-value';
    value.textContent = cmp;
    item.appendChild(value);
    consentCmps.appendChild(item);
  });
};

const renderConsentSourcesList = (sources) => {
  if (!consentSources) {
    return;
  }
  consentSources.innerHTML = '';
  if (!Array.isArray(sources) || sources.length === 0) {
    return;
  }
  const header = document.createElement('div');
  header.className = 'storage-item';
  header.style.fontWeight = '500';
  header.style.color = '#888';
  header.style.fontSize = '0.85em';
  header.textContent = 'Detection Sources:';
  consentSources.appendChild(header);
  sources.forEach((source) => {
    const item = document.createElement('div');
    item.className = 'storage-item';
    const value = document.createElement('div');
    value.className = 'storage-value';
    value.textContent = source;
    item.appendChild(value);
    consentSources.appendChild(item);
  });
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
  const regulatory = payload.regulatory_model || {};
  setConsentPill(consentRequired, required.value || 'Unknown', required.tone);
  setConsentPill(consentPresent, present.value || 'Unknown', present.tone);
  renderConsentState(state.value || 'Unknown', state.tone);
  setConsentPill(consentGpc, gpc.value || 'Unknown', gpc.tone);
  setConsentPill(consentRegulatory, regulatory.value || 'Unknown', null);
  renderRegulatorySourcesList(regulatory.sources || []);
  renderCmpsList(required.detected_cmps || []);
  renderConsentSourcesList(present.signals || []);
  renderConsentCategories(payload.categories || []);
  if (consentMeta) {
    const capturedAt = payload.captured_at
      ? new Date(payload.captured_at).toLocaleTimeString()
      : 'just now';
    const url = payload.url || 'current tab';
    consentMeta.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'consent-meta-header';
    const label = document.createElement('span');
    label.className = 'consent-meta-label';
    label.textContent = 'Snapshot from';
    const timeLine = document.createElement('span');
    timeLine.className = 'consent-meta-time';
    timeLine.textContent = capturedAt;
    header.appendChild(label);
    header.appendChild(timeLine);
    const urlLine = document.createElement('div');
    urlLine.className = 'consent-meta-url';
    urlLine.textContent = url;
    consentMeta.appendChild(header);
    consentMeta.appendChild(urlLine);
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
        requestConsentSnapshotDirect(tabId, (directResponse) => {
          if (!directResponse || !directResponse.ok) {
            if (!silent) {
              consentStatus.textContent = directResponse && directResponse.error
                ? directResponse.error
                : chrome.runtime.lastError.message;
            }
            consentRefreshInFlight = false;
            return;
          }
          lastConsentRefreshAt = Date.now();
          consentRefreshInFlight = false;
          const payload = directResponse.data || {};
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
if (loggerCopyButton) {
  loggerCopyButton.addEventListener('click', () => {
    if (!loggerPreviewRawText) {
      return;
    }
    navigator.clipboard
      .writeText(loggerPreviewRawText)
      .then(() => {
        setCopyState(loggerCopyButton, true);
      })
      .catch(() => {
        setCopyState(loggerCopyButton, false);
      });
  });
}
if (loggerToggleButton) {
  loggerToggleButton.addEventListener('click', () => {
    loggerShowAll = !loggerShowAll;
    refreshLoggerPreview();
  });
}
if (loggerClearButton) {
  loggerClearButton.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    chrome.runtime.sendMessage({ type: 'get_enabled' }, (response) => {
      if (chrome.runtime.lastError) {
        return;
      }
      if (!response) {
        return;
      }
      const sessionId = response.sessionId || response.lastSessionId || null;
      if (!sessionId) {
        refreshLoggerPreview();
        return;
      }

      const logsKey = `utagdbLogs:session:${sessionId}`;
      const metaKey = `utagdbSession:${sessionId}`;

      chrome.storage.local.remove([logsKey], () => {
        chrome.storage.local.set({ sessionLogCount: 0 }, () => {
          loggerShowAll = false;
          refreshLoggerPreview();
        });
      });
    });
  });
}
if (exportCopyButton) {
  exportCopyButton.addEventListener('click', () => {
    const raw = exportCopyButton.dataset.raw || '';
    if (!raw) {
      return;
    }
    navigator.clipboard
      .writeText(raw)
      .then(() => {
        setCopyState(exportCopyButton, true);
      })
      .catch(() => {
        setCopyState(exportCopyButton, false);
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
    applyIqSnapshot(null);
    applyIqFormForTab(null);
    refreshLoggerPreview();
    return;
  }
  resolveTabUuid(tabId, (tabUuid) => {
    if (!tabUuid) {
      setStorageEmpty('No snapshot yet for this tab.');
      setConsentEmpty('No snapshot yet for this tab.');
      applyIqSnapshot(null);
      applyIqFormForTab(null);
      refreshLoggerPreview();
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
    const iqSnapshot = iqSnapshotsByTab.get(tabUuid);
    if (iqSnapshot) {
      applyIqSnapshot(iqSnapshot);
    } else {
      const iqKey = getSessionKeys(tabUuid).iqProfile;
      loadSessionSnapshot(iqKey, (payload) => {
        if (payload) {
          iqSnapshotsByTab.set(tabUuid, payload);
          applyIqSnapshot(payload);
        } else {
          applyIqSnapshot(null);
        }
      });
    }
    applyIqFormForTab(tabUuid);
    refreshLoggerPreview();
  });
  if (url) {
    window.lastActiveTabUrl = url;
  }
};

getActiveTabInfo((info) => {
  applySnapshotsForTab(info);
  if (isConsentActive()) {
    fetchConsentSnapshot({ silent: true, forceRender: true });
    startConsentPolling();
  } else {
    stopConsentPolling();
  }
  refreshUtagdbCookieIndicator();
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
        refreshUtagdbCookieIndicator();
        return;
      }
      applySnapshotsForTab({ tabId: info.tabId, url: tab.url || null });
      refreshUtagdbCookieIndicator();
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
      iqSnapshotsByTab.delete(tabUuid);
      iqTokensByTab.delete(tabUuid);
      iqHostsByTab.delete(tabUuid);
      iqAccountsByTab.delete(tabUuid);
      iqProfilesByTab.delete(tabUuid);
      iqUsernamesByTab.delete(tabUuid);
      iqKeysByTab.delete(tabUuid);
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
      refreshUtagdbCookieIndicator();
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
      iqSnapshotsByTab.delete(tabUuid);
      iqTokensByTab.delete(tabUuid);
      iqHostsByTab.delete(tabUuid);
      iqAccountsByTab.delete(tabUuid);
      iqProfilesByTab.delete(tabUuid);
      iqUsernamesByTab.delete(tabUuid);
      iqKeysByTab.delete(tabUuid);
    }
    tabIdToUuid.delete(tabId);
    clearSessionSnapshots(tabUuid);
  });
}

if (chrome.downloads && chrome.downloads.onChanged) {
  chrome.downloads.onChanged.addListener((delta) => {
    if (!delta || !delta.id || !delta.state || !delta.state.current) {
      return;
    }
    if (delta.state.current !== 'complete') {
      if (delta.state.current === 'interrupted') {
        pendingExportDownloads.delete(delta.id);
      }
      return;
    }
    const pending = pendingExportDownloads.get(delta.id);
    if (!pending) {
      return;
    }
    pendingExportDownloads.delete(delta.id);
    if (pending.saved) {
      return;
    }
    saveRecentExport(
      pending.filename,
      pending.size,
      pending.sections,
      pending.sourceUrls
    );
    loadRecentExports();
  });
}
