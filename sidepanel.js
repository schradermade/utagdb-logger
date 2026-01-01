const featureButtons = Array.from(document.querySelectorAll('[data-feature]'));
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
  ['export', document.getElementById('feature-export')],
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
};

featureButtons.forEach((button) => {
  if (button.disabled) {
    return;
  }
  button.addEventListener('click', () => {
    setActiveFeature(button.dataset.feature);
  });
});

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

const consentRefreshButton = document.getElementById('consent-refresh');
const consentStatus = document.getElementById('consent-status');
const consentRequired = document.getElementById('consent-required');
const consentPresent = document.getElementById('consent-present');
const consentState = document.getElementById('consent-state');
const consentMeta = document.getElementById('consent-meta');
const consentCategories = document.getElementById('consent-categories');
const consentSignalList = document.getElementById('consent-signal-list');
const consentSignalCount = document.getElementById('consent-signal-count');

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
  chrome.runtime.sendMessage({ type: 'get_storage_map' }, (response) => {
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
        displayLabel = `${trimmed.toUpperCase()}: ${categoryNameMap[lower]}`;
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
  setConsentPill(consentRequired, required.value || 'Unknown', required.tone);
  setConsentPill(consentPresent, present.value || 'Unknown', present.tone);
  setConsentPill(consentState, state.value || 'Unknown', state.tone);
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

const fetchConsentSnapshot = () => {
  if (!consentStatus) {
    return;
  }
  consentStatus.textContent = 'Collecting snapshot...';
  chrome.runtime.sendMessage({ type: 'get_consent_status' }, (response) => {
    if (chrome.runtime.lastError) {
      consentStatus.textContent = chrome.runtime.lastError.message;
      return;
    }
    if (!response || !response.ok) {
      consentStatus.textContent = response && response.error
        ? response.error
        : 'Failed to collect consent.';
      return;
    }
    consentStatus.textContent = '';
    applyConsentSnapshot(response.data || {});
  });
};

if (consentRefreshButton) {
  consentRefreshButton.addEventListener('click', fetchConsentSnapshot);
}
