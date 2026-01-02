const featureButtons = Array.from(document.querySelectorAll('[data-feature]'));
const topTabButtons = Array.from(document.querySelectorAll('[data-top-tab]'));
const toolsView = document.getElementById('tools-view');
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
  if (feature === 'network') {
    loadNetworkLogs();
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

const isNetworkActive = () => {
  const networkButton = featureButtons.find(
    (button) => button.dataset.feature === 'network'
  );
  return Boolean(networkButton && networkButton.classList.contains('active'));
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
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs && tabs[0] ? tabs[0] : null;
    const tabId = activeTab && activeTab.id ? activeTab.id : null;
    const url = activeTab && typeof activeTab.url === 'string' ? activeTab.url : null;
    callback({ tabId, url });
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
const loggerCopyButton = document.getElementById('logger-copy');
const exportCopyButton = document.getElementById('export-copy');
const networkRefreshButton = document.getElementById('network-refresh');
const networkStatus = document.getElementById('network-status');
const networkList = document.getElementById('network-list');
const networkCount = document.getElementById('network-count');
const networkOnlyErrors = document.getElementById('network-only-errors');
const networkOnlyTealium = document.getElementById('network-only-tealium');
const networkTagFilter = document.getElementById('network-tag-filter');
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
const LOGGER_PREVIEW_LIMIT = 120;
let loggerPreviewRawText = '';
let iqPreviewRawText = '';
const EXPORT_HISTORY_KEY = 'exportHistory';
const EXPORT_HISTORY_LIMIT = 5;
const pendingExportDownloads = new Map();

const getCurrentTabUuid = () =>
  currentTabUuid || (currentTabId ? tabIdToUuid.get(currentTabId) : null);

function getIqTagMap(snapshot) {
  const map = new Map();
  if (!snapshot || !snapshot.response) {
    return map;
  }
  const tags = Array.isArray(snapshot.response.tags)
    ? snapshot.response.tags
    : Array.isArray(snapshot.response.data && snapshot.response.data.tags)
      ? snapshot.response.data.tags
      : [];
  tags.forEach((tag) => {
    if (!tag || typeof tag !== 'object') {
      return;
    }
    const id =
      tag.id ||
      tag.tag_id ||
      tag.tagId ||
      tag.uid ||
      (tag.tag && (tag.tag.id || tag.tag.tag_id));
    const name =
      tag.name || tag.title || tag.label || tag.tag_name || tag.display_name;
    if (id) {
      map.set(String(id), name ? String(name) : `Tag ${id}`);
    }
  });
  return map;
}

function isTealiumUrl(url) {
  if (!url) {
    return false;
  }
  return /tealium|utag|tiq|collect|i\.gif/i.test(url);
}

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
      let rawText = '';
      const formatted = [];
      slice.forEach((entry, index) => {
        const logNumber = String(startIndex + index + 1).padStart(pad, ' ');
        let prettyEntry = '';
        try {
          prettyEntry = JSON.stringify(entry, null, 2);
        } catch (err) {
          prettyEntry = stringifyLogArg(entry);
        }
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
      }
      setIqToken(token);
      if (host) {
        setIqHost(host);
      }
      setIqStatus('Token received.', false);
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
      const iqSnapshotKey = currentUuid
        ? `iqProfileSnapshot:tab:${currentUuid}`
        : null;
      const iqSnapshot = iqSnapshotKey ? items[iqSnapshotKey] : null;
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
    meta.textContent = `${item.timestamp} • ${item.size} bytes`;
    let url = null;
    if (item.sourceUrl) {
      url = document.createElement('div');
      url.className = 'recent-url';
      url.textContent = item.sourceUrl;
    }
    const tags = document.createElement('div');
    tags.className = 'recent-tags';
    (item.sections || []).forEach((section) => {
      const tag = document.createElement('span');
      tag.className = 'recent-tag';
      tag.textContent = section;
      tags.appendChild(tag);
    });
    const actions = document.createElement('div');
    actions.className = 'storage-controls recent-actions';
    const download = document.createElement('button');
    download.className = 'storage-button';
    download.type = 'button';
    download.textContent = 'Download';
    download.addEventListener('click', () => {
      if (!item.payload) {
        return;
      }
      const blob = new Blob([item.payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      chrome.downloads.download(
        {
          url,
          filename: item.filename || 'case-file.json',
          saveAs: true,
        },
        () => {
          URL.revokeObjectURL(url);
        }
      );
    });
    actions.appendChild(download);
    entry.appendChild(title);
    entry.appendChild(meta);
    if (url) {
      entry.appendChild(url);
    }
    entry.appendChild(tags);
    entry.appendChild(actions);
    recentList.appendChild(entry);
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

const saveRecentExport = (payload, filename, size, sections, sourceUrl) => {
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
        payload,
        sourceUrl,
      },
      ...history,
    ].slice(0, EXPORT_HISTORY_LIMIT);
    storageLocal.set({ [EXPORT_HISTORY_KEY]: next });
  });
};

const getSourceUrlFromCaseFile = (caseFile) => {
  if (!caseFile || typeof caseFile !== 'object') {
    return null;
  }
  const consentSnapshots =
    caseFile.consent_monitor && Array.isArray(caseFile.consent_monitor.snapshots)
      ? caseFile.consent_monitor.snapshots
      : [];
  if (consentSnapshots.length > 0 && consentSnapshots[0].url) {
    return consentSnapshots[0].url;
  }
  const iqSnapshot = caseFile.iq_profile && caseFile.iq_profile.snapshot;
  if (iqSnapshot && iqSnapshot.url) {
    return iqSnapshot.url;
  }
  return null;
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
    exportCaseFileObject = caseFile;
    exportCaseFileText = JSON.stringify(caseFile, null, 2);
    const previewCaseFile = transformCaseFileForPreview(caseFile);
    const previewText = JSON.stringify(previewCaseFile, null, 2);
    renderPreviewLines(exportPreview, previewText);
  if (exportCopyButton) {
    exportCopyButton.dataset.raw = exportCaseFileText;
  }
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
  const size = new TextEncoder().encode(exportCaseFileText).length;
  const sourceUrl = getSourceUrlFromCaseFile(exportCaseFileObject);
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
        payload: exportCaseFileText,
        filename,
        size,
        sections,
        sourceUrl,
      });
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
if (exportIncludeIq) {
  exportIncludeIq.addEventListener('change', refreshExportPreview);
}
if (networkRefreshButton) {
  networkRefreshButton.addEventListener('click', loadNetworkLogs);
}
if (networkOnlyErrors) {
  networkOnlyErrors.addEventListener('change', loadNetworkLogs);
}
if (networkOnlyTealium) {
  networkOnlyTealium.addEventListener('change', loadNetworkLogs);
}
if (networkTagFilter) {
  networkTagFilter.addEventListener('input', loadNetworkLogs);
}

if (iqAuthButton) {
  iqAuthButton.addEventListener('click', fetchIqToken);
}
if (iqFetchButton) {
  iqFetchButton.addEventListener('click', fetchIqProfile);
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
if (iqTokenInput) {
  iqTokenInput.addEventListener('input', (event) => {
    const tabUuid = getCurrentTabUuid();
    if (!tabUuid) {
      return;
    }
    iqTokensByTab.set(tabUuid, event.target.value || '');
  });
}
if (iqHostInput) {
  iqHostInput.addEventListener('input', (event) => {
    const tabUuid = getCurrentTabUuid();
    if (!tabUuid) {
      return;
    }
    iqHostsByTab.set(tabUuid, event.target.value || '');
  });
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
    const hasNetworkUpdate = keys.some((key) => key.startsWith('networkLogs:tab:'));
    if (hasNetworkUpdate) {
      const activeButton = featureButtons.find((button) =>
        button.classList.contains('active')
      );
      if (activeButton && activeButton.dataset.feature === 'network') {
        loadNetworkLogs();
      }
    }
  });
}

function normalizeConsentCategory(category) {
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
}

function buildConsentCoreSignature(payload) {
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
}

function renderList(container, entries, filter) {
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
}

function renderNetworkLogs(logs, tagMap) {
  if (!networkList || !networkStatus) {
    return;
  }
  networkList.innerHTML = '';
  if (!Array.isArray(logs) || logs.length === 0) {
    networkStatus.textContent = 'No network logs yet.';
    if (networkCount) {
      networkCount.textContent = '0';
    }
    return;
  }
  const onlyErrors = Boolean(networkOnlyErrors && networkOnlyErrors.checked);
  const onlyTealium = Boolean(networkOnlyTealium && networkOnlyTealium.checked);
  const tagFilter = networkTagFilter ? networkTagFilter.value.trim().toLowerCase() : '';
  const filtered = logs.filter((entry) => {
    if (!entry) {
      return false;
    }
    if (onlyTealium && !isTealiumUrl(entry.url)) {
      return false;
    }
    if (onlyErrors) {
      const hasError = entry.error || (entry.status && entry.status >= 400);
      if (!hasError) {
        return false;
      }
    }
    if (tagFilter) {
      const tagId = entry.tagId ? String(entry.tagId).toLowerCase() : '';
      const tagName = entry.tagId
        ? (tagMap.get(String(entry.tagId)) || '').toLowerCase()
        : '';
      const url = entry.url ? String(entry.url).toLowerCase() : '';
      if (
        !tagId.includes(tagFilter) &&
        !tagName.includes(tagFilter) &&
        !url.includes(tagFilter)
      ) {
        return false;
      }
    }
    return true;
  });
  if (networkCount) {
    networkCount.textContent = String(filtered.length);
  }
  if (filtered.length === 0) {
    networkStatus.textContent = 'No matching requests.';
    return;
  }
  networkStatus.textContent = '';
  const sorted = [...filtered].sort((a, b) => (b.timeStamp || 0) - (a.timeStamp || 0));
  sorted.forEach((entry) => {
    const item = document.createElement('div');
    item.className = 'storage-item';
    const key = document.createElement('div');
    key.className = 'storage-key';
    const timeLabel = entry.timeStamp
      ? new Date(entry.timeStamp).toLocaleTimeString()
      : 'Unknown';
    const statusLabel = entry.error
      ? `Error: ${entry.error}`
      : entry.status
        ? `Status: ${entry.status}`
        : 'Status: Unknown';
    key.textContent = `${timeLabel} • ${entry.method || 'GET'} • ${statusLabel}`;
    const value = document.createElement('div');
    value.className = 'storage-value';
    const tagLabel = entry.tagId
      ? tagMap.get(String(entry.tagId)) || `Tag ${entry.tagId}`
      : null;
    const lines = [entry.url];
    if (tagLabel) {
      lines.push(tagLabel);
    }
    if (entry.initiator) {
      lines.push(`Initiator: ${entry.initiator}`);
    }
    value.textContent = lines.join('\n');
    item.appendChild(key);
    item.appendChild(value);
    networkList.appendChild(item);
  });
}

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

function loadNetworkLogs() {
  if (!storageLocal || !networkStatus) {
    return;
  }
  getActiveTabInfo(({ tabId }) => {
    if (!tabId) {
      networkStatus.textContent = 'No active tab.';
      if (networkCount) {
        networkCount.textContent = '0';
      }
      return;
    }
    const key = `networkLogs:tab:${tabId}`;
    storageLocal.get([key], (items) => {
      if (chrome.runtime.lastError) {
        networkStatus.textContent = chrome.runtime.lastError.message;
        return;
      }
      const logs = Array.isArray(items[key]) ? items[key] : [];
      const tabUuid = getCurrentTabUuid();
      if (!tabUuid) {
        renderNetworkLogs(logs, new Map());
        return;
      }
      const existing = iqSnapshotsByTab.get(tabUuid);
      if (existing) {
        renderNetworkLogs(logs, getIqTagMap(existing));
        return;
      }
      const iqKey = getSessionKeys(tabUuid).iqProfile;
      loadSessionSnapshot(iqKey, (payload) => {
        if (payload) {
          iqSnapshotsByTab.set(tabUuid, payload);
        }
        renderNetworkLogs(logs, getIqTagMap(payload));
      });
    });
  });
}

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
    return;
  }
  resolveTabUuid(tabId, (tabUuid) => {
    if (!tabUuid) {
      setStorageEmpty('No snapshot yet for this tab.');
      setConsentEmpty('No snapshot yet for this tab.');
      applyIqSnapshot(null);
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
    if (iqTokenInput) {
      const token = iqTokensByTab.get(tabUuid) || '';
      iqTokenInput.value = token;
    }
    if (iqHostInput) {
      const host = iqHostsByTab.get(tabUuid) || '';
      iqHostInput.value = host;
    }
    if (isNetworkActive()) {
      loadNetworkLogs();
    }
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
        iqSnapshotsByTab.delete(tabUuid);
        iqTokensByTab.delete(tabUuid);
        iqHostsByTab.delete(tabUuid);
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
        loadNetworkLogs();
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
      iqSnapshotsByTab.delete(tabUuid);
      iqTokensByTab.delete(tabUuid);
      iqHostsByTab.delete(tabUuid);
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
    saveRecentExport(
      pending.payload,
      pending.filename,
      pending.size,
      pending.sections,
      pending.sourceUrl
    );
    loadRecentExports();
  });
}
