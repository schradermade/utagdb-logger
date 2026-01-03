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

let gpcFromPage;
let gpcRequestCounter = 0;
const pendingGpcRequests = new Map();

function normalizeGpcValue(value) {
  if (value === true || value === false) {
    return value;
  }
  if (value === null || value === undefined) {
    return undefined;
  }
  const lowered = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(lowered)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(lowered)) {
    return false;
  }
  return undefined;
}

function requestPageGpc() {
  return new Promise((resolve) => {
    const requestId = `gpc-${Date.now()}-${gpcRequestCounter++}`;
    const timer = setTimeout(() => {
      pendingGpcRequests.delete(requestId);
      resolve(null);
    }, 200);
    pendingGpcRequests.set(requestId, { resolve, timer });
    try {
      window.postMessage(
        {
          source: 'tealium-extension',
          type: 'get_gpc',
          requestId,
        },
        '*'
      );
    } catch (err) {
      clearTimeout(timer);
      pendingGpcRequests.delete(requestId);
      resolve(null);
    }
  });
}

function getTabUuid() {
  try {
    const storage = window.sessionStorage;
    if (!storage) {
      return null;
    }
    const key = 'tealium_tab_uuid';
    let value = storage.getItem(key);
    if (!value) {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        value = window.crypto.randomUUID();
      } else {
        value = `tab-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
      }
      storage.setItem(key, value);
    }
    return value;
  } catch (err) {
    return null;
  }
}

function collectStorageSnapshot() {
  const cookies = [];
  const rawCookies = document.cookie;
  if (rawCookies) {
    rawCookies.split('; ').forEach((pair) => {
      const idx = pair.indexOf('=');
      if (idx === -1) {
        cookies.push({ key: pair, value: '' });
        return;
      }
      const key = pair.slice(0, idx);
      const value = pair.slice(idx + 1);
      cookies.push({ key, value });
    });
  }

  const localStorageItems = [];
  const sessionStorageItems = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key) {
        localStorageItems.push({ key, value: localStorage.getItem(key) });
      }
    }
  } catch (err) {
    // ignore
  }
  try {
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key) {
        sessionStorageItems.push({ key, value: sessionStorage.getItem(key) });
      }
    }
  } catch (err) {
    // ignore
  }

  const utag = readUtagData() || {};
  const utagEntries = Object.keys(utag).map((key) => ({
    key,
    value: utag[key],
  }));

  return {
    url: location.href,
    captured_at: new Date().toISOString(),
    tab_uuid: getTabUuid(),
    cookies,
    localStorage: localStorageItems,
    sessionStorage: sessionStorageItems,
    utag: utagEntries,
  };
}

function parseCookieMap() {
  const map = new Map();
  const rawCookies = document.cookie;
  if (!rawCookies) {
    return map;
  }
  rawCookies.split('; ').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) {
      map.set(pair, '');
      return;
    }
    const key = pair.slice(0, idx);
    const value = pair.slice(idx + 1);
    map.set(key, value);
  });
  return map;
}

function parseOneTrustGroups(groupString) {
  const groups = {};
  if (!groupString) {
    return groups;
  }
  groupString.split(',').forEach((entry) => {
    const [group, flag] = entry.split(':');
    if (group) {
      groups[group.trim()] = flag === '1';
    }
  });
  return groups;
}

function decodeConsentValue(value) {
  if (!value) {
    return '';
  }
  try {
    return decodeURIComponent(value);
  } catch (err) {
    return value;
  }
}

function extractOneTrustGroupString(consentValue) {
  const decoded = decodeConsentValue(consentValue);
  if (!decoded) {
    return '';
  }
  try {
    const params = new URLSearchParams(decoded);
    const groups = params.get('groups');
    if (groups) {
      return groups;
    }
  } catch (err) {
    // ignore
  }
  const match = decoded.match(/(?:^|&)groups=([^&]*)/);
  if (match && match[1]) {
    return match[1];
  }
  return '';
}

function extractOneTrustGpcFlags(consentValue) {
  const decoded = decodeConsentValue(consentValue);
  if (!decoded) {
    return {};
  }
  try {
    const params = new URLSearchParams(decoded);
    const isGpcEnabled = params.get('isGpcEnabled');
    const browserGpcFlag = params.get('browserGpcFlag');
    return {
      isGpcEnabled: isGpcEnabled !== null ? isGpcEnabled : null,
      browserGpcFlag: browserGpcFlag !== null ? browserGpcFlag : null,
    };
  } catch (err) {
    // ignore
  }
  return {};
}

function summarizeOneTrust(groups, activeGroups) {
  const groupKeys = Object.keys(groups);
  if (groupKeys.length === 0 && !activeGroups) {
    return { state: 'unknown', detail: '' };
  }
  const active = (activeGroups || '')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean);
  if (groupKeys.length === 0) {
    if (active.length === 0) {
      return { state: 'unknown', detail: '' };
    }
    const optional = active.filter((g) => g !== 'C0001');
    if (optional.length === 0) {
      return { state: 'rejected', detail: 'Only necessary groups active' };
    }
    return { state: 'partial', detail: 'Some groups active' };
  }
  const values = Object.values(groups);
  if (values.every((v) => v)) {
    return { state: 'accepted', detail: 'All groups accepted' };
  }
  if (values.every((v) => !v)) {
    return { state: 'rejected', detail: 'All groups rejected' };
  }
  return { state: 'partial', detail: 'Mixed group choices' };
}

function getOneTrustConsentedGroups(groups) {
  return Object.entries(groups)
    .filter(([, value]) => value)
    .map(([key]) => key);
}

function extractBooleanFlags(source) {
  const flags = {};
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return flags;
  }
  Object.keys(source).forEach((key) => {
    if (typeof source[key] === 'boolean') {
      flags[key] = source[key];
    }
  });
  return flags;
}

function summarizeBooleanFlags(flags) {
  const values = Object.values(flags);
  if (values.length === 0) {
    return null;
  }
  if (values.every(Boolean)) {
    return { state: 'accepted', detail: 'All categories accepted' };
  }
  if (values.every((value) => !value)) {
    return { state: 'rejected', detail: 'All categories rejected' };
  }
  return { state: 'partial', detail: 'Mixed category choices' };
}

function listAcceptedFlags(flags) {
  return Object.keys(flags).filter((key) => flags[key]);
}

function parseDelimitedList(value) {
  if (!value) {
    return [];
  }
  const decoded = decodeConsentValue(value);
  const trimmed = decoded.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item));
      }
      if (parsed && typeof parsed === 'object') {
        return Object.keys(parsed);
      }
    } catch (err) {
      // ignore
    }
  }
  return trimmed
    .split(/[|,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function collectCookiebotData() {
  const cookiebot = window.Cookiebot;
  if (!cookiebot || typeof cookiebot !== 'object') {
    return null;
  }
  const consent = cookiebot.consent || null;
  const consentFlags = extractBooleanFlags(consent);
  const summary = summarizeBooleanFlags(consentFlags);
  const gdprApplies =
    cookiebot.regulations && cookiebot.regulations.gdprApplies !== undefined
      ? cookiebot.regulations.gdprApplies
      : null;
  return {
    consent,
    consentFlags,
    summary,
    gdprApplies,
    consentedCategories: listAcceptedFlags(consentFlags),
  };
}

function collectCookieYesData(cookies) {
  const cookieKeys = ['cookieyes-consent', 'cky-consent', 'cookieyes'];
  let raw = null;
  for (const key of cookieKeys) {
    if (cookies.has(key)) {
      raw = cookies.get(key);
      break;
    }
  }
  if (!raw) {
    return null;
  }
  const decoded = decodeConsentValue(raw);
  let parsed = null;
  if (decoded) {
    const trimmed = decoded.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        parsed = JSON.parse(trimmed);
      } catch (err) {
        parsed = null;
      }
    } else if (trimmed.includes('=')) {
      try {
        const params = new URLSearchParams(trimmed);
        const accepted = params.get('accepted');
        const rejected = params.get('rejected');
        if (accepted || rejected) {
          parsed = {
            accepted: parseDelimitedList(accepted),
            rejected: parseDelimitedList(rejected),
          };
        }
      } catch (err) {
        // ignore
      }
    } else if (trimmed.includes(':')) {
      const pairs = trimmed.split(',');
      const mapped = {};
      pairs.forEach((pair) => {
        const [rawKey, rawValue] = pair.split(':');
        if (!rawKey) {
          return;
        }
        mapped[rawKey.trim()] = rawValue ? rawValue.trim() : '';
      });
      parsed = mapped;
    }
  }
  const consentFlags = {};
  const categoryKeys = ['necessary', 'functional', 'analytics', 'advertisement', 'other'];
  const setFlag = (key, value) => {
    if (!key) {
      return;
    }
    const normalized = String(key).toLowerCase();
    if (!categoryKeys.includes(normalized)) {
      return;
    }
    if (value === true || value === false) {
      consentFlags[normalized] = value;
      return;
    }
    const lowered = String(value).toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(lowered)) {
      consentFlags[normalized] = true;
    } else if (['false', '0', 'no', 'off'].includes(lowered)) {
      consentFlags[normalized] = false;
    }
  };
  if (Array.isArray(parsed)) {
    parsed.forEach((entry) => setFlag(entry, true));
  } else if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.accepted) || Array.isArray(parsed.rejected)) {
      (parsed.accepted || []).forEach((entry) => setFlag(entry, true));
      (parsed.rejected || []).forEach((entry) => setFlag(entry, false));
    }
    if (parsed.categories && typeof parsed.categories === 'object') {
      Object.entries(parsed.categories).forEach(([key, value]) => {
        setFlag(key, value);
      });
    }
    categoryKeys.forEach((key) => {
      if (key in parsed) {
        setFlag(key, parsed[key]);
      }
    });
  } else if (decoded) {
    parseDelimitedList(decoded).forEach((entry) => setFlag(entry, true));
  }
  return {
    raw,
    parsed,
    consentFlags,
    summary: summarizeBooleanFlags(consentFlags),
    consentedCategories: listAcceptedFlags(consentFlags),
  };
}

function collectDidomiData() {
  const didomi = window.Didomi;
  if (!didomi || typeof didomi !== 'object') {
    return null;
  }
  const status =
    typeof didomi.getUserStatus === 'function'
      ? didomi.getUserStatus()
      : null;
  const config =
    typeof didomi.getConfig === 'function' ? didomi.getConfig() : null;
  const shouldCollect =
    typeof didomi.shouldConsentBeCollected === 'function'
      ? didomi.shouldConsentBeCollected()
      : null;

  const consentedPurposeIds = Array.isArray(status?.consentedPurposeIds)
    ? status.consentedPurposeIds.map((item) => String(item))
    : [];
  const purposeFlags = extractBooleanFlags(status?.purposes);
  const summary = summarizeBooleanFlags(purposeFlags);
  const enabledPurposes = Array.isArray(status?.purposes?.enabled)
    ? status.purposes.enabled.map((item) => String(item))
    : [];
  const disabledPurposes = Array.isArray(status?.purposes?.disabled)
    ? status.purposes.disabled.map((item) => String(item))
    : [];

  let derivedSummary = summary;
  if (!derivedSummary && (enabledPurposes.length || disabledPurposes.length)) {
    if (enabledPurposes.length && !disabledPurposes.length) {
      derivedSummary = { state: 'accepted', detail: 'All purposes enabled' };
    } else if (!enabledPurposes.length && disabledPurposes.length) {
      derivedSummary = { state: 'rejected', detail: 'All purposes disabled' };
    } else {
      derivedSummary = { state: 'partial', detail: 'Mixed purpose choices' };
    }
  }

  return {
    status,
    config,
    shouldCollect,
    consentedCategories: consentedPurposeIds.length
      ? consentedPurposeIds
      : enabledPurposes,
    summary: derivedSummary,
  };
}

function collectDigitalControlRoomData() {
  const dcr = window._cookiereports;
  if (!dcr || typeof dcr !== 'object') {
    return null;
  }
  let consent = null;
  if (typeof dcr.loadConsent === 'function') {
    try {
      consent = dcr.loadConsent();
    } catch (err) {
      consent = null;
    }
  }
  const panels = consent?.panels || dcr.panels || [];
  const panelFlags = {};
  if (Array.isArray(panels)) {
    panels.forEach((panel, index) => {
      const key =
        panel?.name || panel?.label || panel?.id || `panel_${index + 1}`;
      const value =
        panel?.consentExplicit ??
        panel?.consent ??
        panel?.allowed ??
        panel?.enabled;
      if (typeof value === 'boolean') {
        panelFlags[String(key)] = value;
      }
    });
  }
  return {
    consent,
    panels,
    panelFlags,
    summary: summarizeBooleanFlags(panelFlags),
    consentedCategories: listAcceptedFlags(panelFlags),
  };
}

function collectTrustArcData(cookies) {
  const truste = window.truste;
  if (!truste || typeof truste !== 'object') {
    return null;
  }
  const cookieName = truste?.eu?.COOKIE_GDPR_PREF_NAME || null;
  let cookieValue = null;
  if (cookieName && cookies.has(cookieName)) {
    cookieValue = cookies.get(cookieName);
  } else if (truste?.util?.readCookie && cookieName) {
    try {
      cookieValue = truste.util.readCookie(cookieName);
    } catch (err) {
      cookieValue = null;
    }
  }
  const noticeBehavior = truste?.eu?.notice_behavior || null;
  const categories = parseDelimitedList(cookieValue);
  return {
    cookieName,
    cookieValue,
    noticeBehavior,
    consentedCategories: categories,
  };
}

function collectUsercentricsData() {
  const uc = window.UC_UI;
  if (!uc || typeof uc !== 'object') {
    return null;
  }
  const services =
    typeof uc.getServicesBaseInfo === 'function'
      ? uc.getServicesBaseInfo()
      : null;
  const required =
    typeof uc.isConsentRequired === 'function' ? uc.isConsentRequired() : null;
  const consentFlags = {};
  if (Array.isArray(services)) {
    services.forEach((service, index) => {
      const key =
        service?.name || service?.id || service?.category || `service_${index + 1}`;
      const value =
        service?.consent?.status ??
        service?.consent?.given ??
        service?.consent?.granted ??
        service?.consentStatus ??
        service?.status ??
        service?.enabled ??
        service?.consent;
      if (typeof value === 'boolean') {
        consentFlags[String(key)] = value;
      }
    });
  }
  return {
    services,
    required,
    consentFlags,
    summary: summarizeBooleanFlags(consentFlags),
    consentedCategories: listAcceptedFlags(consentFlags),
  };
}

function collectOptOutGpcData(cookies) {
  const gpcRaw = gpcFromPage !== undefined ? gpcFromPage : navigator.globalPrivacyControl;
  const gpc = normalizeGpcValue(gpcRaw);
  const optOutCookie =
    cookies.get('utag_optout') || cookies.get('utag_optout_all') || null;
  return {
    gpc,
    gpcRaw,
    optOutCookie,
  };
}

function sanitizeSignalValue(value) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === 'function') {
    return '[function]';
  }
  if (typeof value !== 'object') {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    return String(value);
  }
}

function getUtagConsentCategories(utagData) {
  const categories = new Set();
  const list = utagData['tci.purposes_with_consent_all'];
  if (Array.isArray(list)) {
    list.forEach((item) => categories.add(String(item)));
  }
  const processed = utagData['tci.purposes_with_consent_processed'];
  if (Array.isArray(processed)) {
    processed.forEach((item) => categories.add(String(item)));
  }
  const unprocessed = utagData['tci.purposes_with_consent_unprocessed'];
  if (Array.isArray(unprocessed)) {
    unprocessed.forEach((item) => categories.add(String(item)));
  }
  return Array.from(categories);
}

function extractTciSignals(utagData) {
  if (!utagData || typeof utagData !== 'object') {
    return [];
  }
  return Object.keys(utagData)
    .filter((key) => key.startsWith('tci.'))
    .map((key) => ({ label: `utag.data ${key}`, value: utagData[key] }));
}

function requestTcfData() {
  if (typeof window.__tcfapi !== 'function') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, 500);
    try {
      window.__tcfapi('getTCData', 2, (data, success) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(success ? data : null);
      });
    } catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(null);
      }
    }
  });
}

function requestUspData() {
  if (typeof window.__uspapi !== 'function') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, 500);
    try {
      window.__uspapi('getUSPData', 1, (data, success) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(success ? data : null);
      });
    } catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(null);
      }
    }
  });
}

async function collectConsentSnapshot() {
  const utagData = readUtagData() || {};
  const utag = window.utag || {};
  const cookies = parseCookieMap();
  await requestPageGpc();
  const signals = [];
  const categoryStatusMap = new Map();

  const addSignal = (label, value, options = {}) => {
    const sanitized = sanitizeSignalValue(value);
    if (sanitized === undefined && !options.allowUndefined) {
      return;
    }
    signals.push({ label, value: sanitized });
  };

  const addCategoryStatus = (name, accepted) => {
    if (!name) {
      return;
    }
    const key = String(name);
    const current = categoryStatusMap.get(key);
    if (!current) {
      categoryStatusMap.set(key, { name: key, accepted: Boolean(accepted) });
      return;
    }
    if (accepted) {
      current.accepted = true;
    }
  };

  const onetrustConsent = cookies.get('OptanonConsent') || '';
  const onetrustGroupString = extractOneTrustGroupString(onetrustConsent);
  const onetrustGroups = parseOneTrustGroups(onetrustGroupString);
  const onetrustActiveGroups = decodeConsentValue(
    cookies.get('OnetrustActiveGroups') || window.OnetrustActiveGroups || ''
  );
  const onetrustGpcFlags = extractOneTrustGpcFlags(onetrustConsent);
  const onetrustSummary = summarizeOneTrust(
    onetrustGroups,
    onetrustActiveGroups
  );
  const onetrustConsentedGroups = getOneTrustConsentedGroups(onetrustGroups);

  addSignal('cookie OptanonConsent', onetrustConsent || null);
  const orderedOneTrustGroups = Object.keys(onetrustGroups)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${key}:${onetrustGroups[key] ? '1' : '0'}`)
    .join(',');
  addSignal('OneTrust groups', orderedOneTrustGroups || onetrustGroupString || null);
  addSignal('cookie OnetrustActiveGroups', onetrustActiveGroups || null);
  addSignal('OneTrust isGpcEnabled', onetrustGpcFlags.isGpcEnabled);
  addSignal('OneTrust browserGpcFlag', onetrustGpcFlags.browserGpcFlag);
  Object.entries(onetrustGroups).forEach(([group, accepted]) => {
    addCategoryStatus(group, accepted);
  });
  if (!Object.keys(onetrustGroups).length && onetrustActiveGroups) {
    onetrustActiveGroups
      .split(',')
      .map((group) => group.trim())
      .filter(Boolean)
      .forEach((group) => addCategoryStatus(group, true));
  }

  const cookiebotData = collectCookiebotData();
  if (cookiebotData) {
    addSignal('Cookiebot consent', cookiebotData.consent || null);
    addSignal(
      'Cookiebot gdprApplies',
      cookiebotData.gdprApplies !== null ? cookiebotData.gdprApplies : null
    );
    Object.entries(cookiebotData.consentFlags || {}).forEach(
      ([category, accepted]) => addCategoryStatus(category, accepted)
    );
  }

  const cookieYesData = collectCookieYesData(cookies);
  if (cookieYesData) {
    addSignal('CookieYes consent', cookieYesData.raw || null);
    if (cookieYesData.parsed) {
      addSignal('CookieYes parsed', cookieYesData.parsed);
    }
    Object.entries(cookieYesData.consentFlags || {}).forEach(
      ([category, accepted]) => addCategoryStatus(category, accepted)
    );
  }

  const didomiData = collectDidomiData();
  if (didomiData) {
    addSignal('Didomi status', didomiData.status || null);
    addSignal('Didomi config', didomiData.config || null);
    addSignal(
      'Didomi shouldCollect',
      didomiData.shouldCollect !== null ? didomiData.shouldCollect : null
    );
    const purposeFlags = extractBooleanFlags(didomiData.status?.purposes);
    Object.entries(purposeFlags).forEach(([purpose, accepted]) => {
      addCategoryStatus(purpose, accepted);
    });
    if (Array.isArray(didomiData.status?.purposes?.enabled)) {
      didomiData.status.purposes.enabled.forEach((purpose) => {
        addCategoryStatus(purpose, true);
      });
    }
    if (Array.isArray(didomiData.status?.purposes?.disabled)) {
      didomiData.status.purposes.disabled.forEach((purpose) => {
        addCategoryStatus(purpose, false);
      });
    }
    if (Array.isArray(didomiData.status?.consentedPurposeIds)) {
      didomiData.status.consentedPurposeIds.forEach((purpose) => {
        addCategoryStatus(purpose, true);
      });
    }
  }

  const dcrData = collectDigitalControlRoomData();
  if (dcrData) {
    addSignal('DCR consent', dcrData.consent || null);
    Object.entries(dcrData.panelFlags || {}).forEach(([panel, accepted]) => {
      addCategoryStatus(panel, accepted);
    });
    (dcrData.panels || []).forEach((panel, index) => {
      const label = panel?.name || panel?.label || panel?.id || `panel_${index + 1}`;
      const value =
        panel?.consentExplicit ??
        panel?.consent ??
        panel?.allowed ??
        panel?.enabled;
      if (typeof value === 'boolean') {
        addCategoryStatus(label, value);
      }
    });
  }

  const trustArcData = collectTrustArcData(cookies);
  if (trustArcData) {
    addSignal('TrustArc cookie', trustArcData.cookieValue || null);
    addSignal('TrustArc notice_behavior', trustArcData.noticeBehavior || null);
    trustArcData.consentedCategories.forEach((category) => {
      addCategoryStatus(category, true);
    });
  }

  const usercentricsData = collectUsercentricsData();
  if (usercentricsData) {
    addSignal('Usercentrics services', usercentricsData.services || null);
    addSignal(
      'Usercentrics consentRequired',
      usercentricsData.required !== null ? usercentricsData.required : null
    );
    Object.entries(usercentricsData.consentFlags || {}).forEach(
      ([service, accepted]) => addCategoryStatus(service, accepted)
    );
    (usercentricsData.services || []).forEach((service, index) => {
      const label =
        service?.name || service?.id || service?.category || `service_${index + 1}`;
      const value =
        service?.consent?.status ??
        service?.consent?.given ??
        service?.consent?.granted ??
        service?.consentStatus ??
        service?.status ??
        service?.enabled ??
        service?.consent;
      if (typeof value === 'boolean') {
        addCategoryStatus(label, value);
      }
    });
  }

  const optOutData = collectOptOutGpcData(cookies);
  const navigatorGpc = navigator.globalPrivacyControl;
  addSignal('GPC signal (page)', gpcFromPage, { allowUndefined: true });
  addSignal('GPC signal (content script)', navigatorGpc, { allowUndefined: true });
  addSignal(
    'Opt-out cookie',
    optOutData.optOutCookie || 'Not set'
  );

  const tciSignals = extractTciSignals(utagData);
  tciSignals.forEach((signal) => signals.push(signal));
  const tciCategories = getUtagConsentCategories(utagData);
  tciCategories.forEach((category) => addCategoryStatus(category, true));

  const tcfData = await requestTcfData();
  if (tcfData) {
    addSignal('tcf tcString', tcfData.tcString);
    addSignal('tcf gdprApplies', tcfData.gdprApplies);
    if (tcfData.purpose && tcfData.purpose.consents) {
      Object.entries(tcfData.purpose.consents).forEach(([purpose, accepted]) => {
        addCategoryStatus(`TCF purpose ${purpose}`, accepted);
      });
    }
  }

  const uspData = await requestUspData();
  if (uspData) {
    addSignal('usp uspString', uspData.uspString);
  }

  const consentRequiredSignals = [];
  let requiredOverride = null;
  const setRequiredOverride = (value) => {
    if (!requiredOverride) {
      requiredOverride = value;
    }
  };
  if (utag && utag.cfg && utag.cfg.consent) {
    consentRequiredSignals.push('utag.cfg.consent');
  }
  if (typeof window.__tcfapi === 'function') {
    consentRequiredSignals.push('__tcfapi');
  }
  if (onetrustConsent || onetrustActiveGroups) {
    consentRequiredSignals.push('OneTrust');
  }
  if (cookiebotData) {
    consentRequiredSignals.push('Cookiebot');
  }
  if (cookieYesData) {
    consentRequiredSignals.push('CookieYes');
  }
  if (didomiData) {
    consentRequiredSignals.push('Didomi');
  }
  if (trustArcData) {
    consentRequiredSignals.push('TrustArc');
  }
  if (usercentricsData) {
    consentRequiredSignals.push('Usercentrics');
  }
  if (dcrData) {
    consentRequiredSignals.push('Digital Control Room');
  }
  if (tciSignals.length > 0) {
    consentRequiredSignals.push('tci.*');
  }
  if (optOutData.gpc === true || optOutData.optOutCookie) {
    consentRequiredSignals.push('GPC/Opt-out');
  }

  if (cookiebotData && cookiebotData.gdprApplies === false) {
    setRequiredOverride('No');
  }
  if (didomiData && didomiData.shouldCollect === false) {
    setRequiredOverride('No');
  }
  if (usercentricsData && usercentricsData.required === false) {
    setRequiredOverride('No');
  }

  const consentPresentSignals = [];
  if (onetrustConsent || onetrustActiveGroups) {
    consentPresentSignals.push('OneTrust cookies');
  }
  if (cookiebotData && cookiebotData.consent) {
    consentPresentSignals.push('Cookiebot consent');
  }
  if (cookieYesData && cookieYesData.raw) {
    consentPresentSignals.push('CookieYes consent');
  }
  if (didomiData && (didomiData.status || didomiData.consentedCategories.length)) {
    consentPresentSignals.push('Didomi status');
  }
  if (trustArcData && trustArcData.cookieValue) {
    consentPresentSignals.push('TrustArc cookie');
  }
  if (usercentricsData && Array.isArray(usercentricsData.services)) {
    consentPresentSignals.push('Usercentrics services');
  }
  if (dcrData && dcrData.consent) {
    consentPresentSignals.push('Digital Control Room consent');
  }
  if (tcfData && tcfData.tcString) {
    consentPresentSignals.push('tcf tcString');
  }
  if (uspData && uspData.uspString) {
    consentPresentSignals.push('usp uspString');
  }
  if (tciSignals.length > 0) {
    consentPresentSignals.push('utag.data tci.*');
  }
  if (optOutData.gpc === true || optOutData.optOutCookie) {
    consentPresentSignals.push('GPC/Opt-out');
  }

  let stateValue = 'Unknown';
  let stateTone = null;

  if (tcfData && tcfData.gdprApplies === false) {
    stateValue = 'Not Required';
    stateTone = 'ok';
    setRequiredOverride('No');
  } else if (requiredOverride === 'No') {
    stateValue = 'Not Required';
    stateTone = 'ok';
  } else if (onetrustSummary.state !== 'unknown') {
    stateValue =
      onetrustSummary.state === 'accepted'
        ? 'Accepted'
        : onetrustSummary.state === 'rejected'
        ? 'Rejected'
        : 'Partial';
    stateTone =
      onetrustSummary.state === 'accepted'
        ? 'ok'
        : onetrustSummary.state === 'rejected'
        ? 'bad'
        : 'warn';
    if (onetrustSummary.detail) {
      addSignal('OneTrust summary', onetrustSummary.detail);
    }
  } else if (cookiebotData && cookiebotData.summary) {
    stateValue =
      cookiebotData.summary.state === 'accepted'
        ? 'Accepted'
        : cookiebotData.summary.state === 'rejected'
        ? 'Rejected'
        : 'Partial';
    stateTone =
      cookiebotData.summary.state === 'accepted'
        ? 'ok'
        : cookiebotData.summary.state === 'rejected'
        ? 'bad'
        : 'warn';
    if (cookiebotData.summary.detail) {
      addSignal('Cookiebot summary', cookiebotData.summary.detail);
    }
  } else if (cookieYesData && cookieYesData.summary) {
    stateValue =
      cookieYesData.summary.state === 'accepted'
        ? 'Accepted'
        : cookieYesData.summary.state === 'rejected'
        ? 'Rejected'
        : 'Partial';
    stateTone =
      cookieYesData.summary.state === 'accepted'
        ? 'ok'
        : cookieYesData.summary.state === 'rejected'
        ? 'bad'
        : 'warn';
    if (cookieYesData.summary.detail) {
      addSignal('CookieYes summary', cookieYesData.summary.detail);
    }
  } else if (didomiData && didomiData.summary) {
    stateValue =
      didomiData.summary.state === 'accepted'
        ? 'Accepted'
        : didomiData.summary.state === 'rejected'
        ? 'Rejected'
        : 'Partial';
    stateTone =
      didomiData.summary.state === 'accepted'
        ? 'ok'
        : didomiData.summary.state === 'rejected'
        ? 'bad'
        : 'warn';
    if (didomiData.summary.detail) {
      addSignal('Didomi summary', didomiData.summary.detail);
    }
  } else if (trustArcData && trustArcData.consentedCategories.length > 0) {
    stateValue = 'Accepted';
    stateTone = 'ok';
  } else if (usercentricsData && usercentricsData.summary) {
    stateValue =
      usercentricsData.summary.state === 'accepted'
        ? 'Accepted'
        : usercentricsData.summary.state === 'rejected'
        ? 'Rejected'
        : 'Partial';
    stateTone =
      usercentricsData.summary.state === 'accepted'
        ? 'ok'
        : usercentricsData.summary.state === 'rejected'
        ? 'bad'
        : 'warn';
  } else if (dcrData && dcrData.summary) {
    stateValue =
      dcrData.summary.state === 'accepted'
        ? 'Accepted'
        : dcrData.summary.state === 'rejected'
        ? 'Rejected'
        : 'Partial';
    stateTone =
      dcrData.summary.state === 'accepted'
        ? 'ok'
        : dcrData.summary.state === 'rejected'
        ? 'bad'
        : 'warn';
  } else if (tcfData && tcfData.purpose && tcfData.purpose.consents) {
    const values = Object.values(tcfData.purpose.consents || {});
    if (values.length) {
      const allTrue = values.every(Boolean);
      const allFalse = values.every((v) => !v);
      if (allTrue) {
        stateValue = 'Accepted';
        stateTone = 'ok';
      } else if (allFalse) {
        stateValue = 'Rejected';
        stateTone = 'bad';
      } else {
        stateValue = 'Partial';
        stateTone = 'warn';
      }
    }
  } else if (tciSignals.length > 0) {
    const consentAll = utagData['tci.purposes_with_consent_all'];
    if (Array.isArray(consentAll) && consentAll.length > 0) {
      stateValue = 'Accepted';
      stateTone = 'ok';
    } else if (Array.isArray(consentAll)) {
      stateValue = 'Rejected';
      stateTone = 'bad';
    } else {
      stateValue = 'Partial';
      stateTone = 'warn';
    }
  } else if (uspData && uspData.uspString) {
    const usp = uspData.uspString;
    if (usp.length >= 3 && usp[2] === 'Y') {
      stateValue = 'Rejected';
      stateTone = 'bad';
    } else if (usp.length >= 3 && usp[2] === 'N') {
      stateValue = 'Accepted';
      stateTone = 'ok';
    }
  } else if (optOutData.gpc === true) {
    stateValue = 'Rejected';
    stateTone = 'bad';
  } else if (optOutData.optOutCookie) {
    const optOutValue = String(optOutData.optOutCookie).toLowerCase();
    if (optOutValue === '1' || optOutValue === 'true') {
      stateValue = 'Rejected';
      stateTone = 'bad';
    } else if (optOutValue === '0' || optOutValue === 'false') {
      stateValue = 'Accepted';
      stateTone = 'ok';
    }
  }

  const requiredValue = requiredOverride
    ? requiredOverride
    : consentRequiredSignals.length > 0
    ? 'Yes'
    : 'Unknown';
  let presentValue = consentPresentSignals.length > 0 ? 'Yes' : 'Unknown';
  if (requiredValue === 'No') {
    presentValue = 'Not Required';
  } else if (requiredValue === 'Yes' && consentPresentSignals.length === 0) {
    presentValue = 'No';
  }

  const acceptedCategories = Array.from(categoryStatusMap.values())
    .filter((entry) => entry.accepted)
    .map((entry) => String(entry.name).trim().toLowerCase())
    .filter(Boolean);
  const isNecessaryCategory = (name) =>
    name === 'c0001' || name === 'necessary' || name === 'strictly necessary';
  if (
    stateValue !== 'Not Required' &&
    acceptedCategories.length > 0 &&
    acceptedCategories.every(isNecessaryCategory)
  ) {
    stateValue = 'Strictly Necessary Only';
    stateTone = 'warn';
  }

  return {
    url: location.href,
    captured_at: new Date().toISOString(),
    tab_uuid: getTabUuid(),
    gpc: (() => {
      const gpcValue = normalizeGpcValue(
        gpcFromPage !== undefined ? gpcFromPage : navigatorGpc
      );
      if (gpcValue === true) {
        return { value: 'On', tone: 'ok' };
      }
      if (gpcValue === false) {
        return { value: 'Off', tone: null };
      }
      return { value: 'Unknown', tone: null };
    })(),
    required: {
      value: requiredValue,
      tone: requiredValue === 'Yes' ? 'ok' : requiredValue === 'No' ? 'ok' : null,
      signals: consentRequiredSignals,
    },
    present: {
      value: presentValue,
      tone: presentValue === 'Yes' || presentValue === 'Not Required'
        ? 'ok'
        : presentValue === 'No'
        ? 'bad'
        : null,
      signals: consentPresentSignals,
    },
    state: {
      value: stateValue,
      tone: stateTone,
    },
    categories: Array.from(categoryStatusMap.values()),
    signals,
  };
}

let extensionValid = true;
const ENABLED_KEY = 'enabled';
let hasSentInitialEnabled = false;
let utagdbOverride = null;

const getUtagdbCookieValues = () => {
  try {
    return document.cookie
      .split(';')
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith('utagdb='))
      .map((entry) => entry.split('=').slice(1).join('='));
  } catch (err) {
    return [];
  }
};

const hasUtagdbCookieEnabled = () =>
  getUtagdbCookieValues().some(
    (value) => value && value.toLowerCase() === 'true'
  );

const clearUtagdbCookie = () => {
  try {
    const paths = new Set(['/']);
    const pathname =
      typeof location === 'object' && typeof location.pathname === 'string'
        ? location.pathname
        : '/';
    const segments = pathname.split('/').filter(Boolean);
    let current = '';
    segments.forEach((segment) => {
      current += `/${segment}`;
      paths.add(current);
    });

    const domains = [];
    if (typeof location === 'object' && typeof location.hostname === 'string') {
      domains.push(location.hostname);
      if (location.hostname.includes('.')) {
        domains.push(`.${location.hostname}`);
      }
    }

    paths.forEach((path) => {
      document.cookie = `utagdb=; Max-Age=0; path=${path}`;
      domains.forEach((domain) => {
        document.cookie = `utagdb=; Max-Age=0; path=${path}; domain=${domain}`;
      });
    });
  } catch (err) {
    // ignore cookie clearing failures
  }
};

const isUtagdbEnabled = () => {
  if (utagdbOverride === true) {
    return true;
  }
  if (utagdbOverride === false) {
    return false;
  }
  try {
    const cookieEnabled = hasUtagdbCookieEnabled();
    const cfgEnabled =
      window.utag && window.utag.cfg && window.utag.cfg.utagdb === true;
    return Boolean(cookieEnabled || cfgEnabled);
  } catch (err) {
    return false;
  }
};

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
    if (!isUtagdbEnabled()) {
      return;
    }
    const message = {
      type: 'console_log',
      payload: {
        url: location.href,
        timestamp: event.data.timestamp,
        args: event.data.payload,
        sequence: event.data.sequence,
        db_index: event.data.db_index,
        db_generation: event.data.db_generation,
        tab_uuid: getTabUuid(),
      },
    };
    safeSendMessage(message);
    return;
  }
  if (event.data.type === 'bridge_status') {
    return;
  }
  if (event.data.type === 'gpc_signal') {
    gpcFromPage = event.data.value;
    return;
  }
  if (event.data.type === 'gpc_response') {
    const requestId = event.data.requestId;
    if (requestId && pendingGpcRequests.has(requestId)) {
      const pending = pendingGpcRequests.get(requestId);
      pendingGpcRequests.delete(requestId);
      clearTimeout(pending.timer);
      pending.resolve(event.data.value);
    }
    if (event.data.value !== undefined) {
      gpcFromPage = event.data.value;
    }
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
      if (message.type === 'set_utagdb_cookie') {
        try {
          const enabled = message.enabled !== false;
          utagdbOverride = enabled;
          window.postMessage(
            {
              source: 'tealium-extension',
              type: 'set_utagdb_enabled',
              enabled,
            },
            '*'
          );
          if (enabled) {
            document.cookie = 'utagdb=true; path=/';
            if (window.utag && window.utag.cfg) {
              window.utag.cfg.utagdb = true;
            }
            try {
              window.localStorage.setItem('utagdb', 'true');
            } catch (err) {
              // ignore localStorage failures
            }
          } else {
            clearUtagdbCookie();
            if (window.utag && window.utag.cfg) {
              window.utag.cfg.utagdb = false;
            }
            try {
              window.localStorage.removeItem('utagdb');
            } catch (err) {
              // ignore localStorage failures
            }
          }
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: 'Failed to set utagdb cookie.' });
        }
        return;
      }
      if (message.type === 'get_utagdb_cookie') {
        try {
          sendResponse({ ok: true, enabled: isUtagdbEnabled() });
        } catch (err) {
          sendResponse({ ok: false, enabled: false });
        }
        return;
      }
      if (message.type === 'get_storage_map') {
        try {
          sendResponse({ ok: true, data: collectStorageSnapshot() });
        } catch (err) {
          sendResponse({ ok: false, error: 'Failed to read storage.' });
        }
        return;
      }
      if (message.type === 'get_tab_uuid') {
        sendResponse({ ok: true, tab_uuid: getTabUuid(), url: location.href });
        return;
      }
      if (message.type === 'get_consent_status') {
        collectConsentSnapshot()
          .then((snapshot) => {
            sendResponse({ ok: true, data: snapshot });
          })
          .catch(() => {
            sendResponse({ ok: false, error: 'Failed to read consent.' });
          });
        return true;
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
