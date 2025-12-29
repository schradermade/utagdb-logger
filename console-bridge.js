(() => {
  if (window.__tealiumConsoleBridgeInstalled) {
    return;
  }
  window.__tealiumConsoleBridgeInstalled = true;

  const safeSerialize = (value) => {
    try {
      if (typeof value === 'string') {
        return value;
      }
      return JSON.stringify(value);
    } catch (err) {
      return String(value);
    }
  };

  let sequence = 0;
  let statusSent = false;
  let enabled = false;
  let lastDbIndex = 0;

  const postLog = (entry) => {
    window.postMessage(
      {
        source: 'tealium-extension',
        type: 'console_log',
        payload: [safeSerialize(entry)],
        timestamp: new Date().toISOString(),
        sequence: sequence++,
      },
      '*'
    );
  };

  const postStatus = (status) => {
    if (statusSent) {
      return;
    }
    statusSent = true;
    window.postMessage(
      {
        source: 'tealium-extension',
        type: 'bridge_status',
        payload: status,
        timestamp: new Date().toISOString(),
      },
      '*'
    );
  };

  const flushDbLog = () => {
    const utag = window.utag;
    if (!utag || !Array.isArray(utag.db_log)) {
      return;
    }
    const total = utag.db_log.length;
    if (total <= lastDbIndex) {
      return;
    }
    for (let i = lastDbIndex; i < total; i += 1) {
      try {
        postLog(utag.db_log[i]);
      } catch (err) {
        // ignore
      }
    }
    lastDbIndex = total;
  };

  const wrapUtagDb = () => {
    if (!enabled) {
      return;
    }
    const utag = window.utag;
    if (!utag || typeof utag.DB !== 'function') {
      postStatus({
        ok: false,
        reason: 'utag.DB not available',
      });
      return;
    }
    if (utag.DB.__tealiumWrapped) {
      postStatus({
        ok: true,
        wrapped: true,
        utagdb: utag.cfg && utag.cfg.utagdb,
        noconsole: utag.cfg && utag.cfg.noconsole,
        dbLogLength: Array.isArray(utag.db_log) ? utag.db_log.length : null,
      });
      flushDbLog();
      return;
    }

    const original = utag.DB;
    utag.DB = function (...args) {
      const before = Array.isArray(utag.db_log) ? utag.db_log.length : 0;
      const result = original.apply(this, args);
      const after = Array.isArray(utag.db_log) ? utag.db_log.length : 0;

      if (after > before) {
        try {
          postLog(utag.db_log[after - 1]);
        } catch (err) {
          // ignore
        }
        lastDbIndex = after;
      } else if (args.length) {
        try {
          postLog(args[0]);
        } catch (err) {
          // ignore
        }
      }

      return result;
    };
    utag.DB.__tealiumWrapped = true;
    postStatus({
      ok: true,
      wrapped: true,
      utagdb: utag.cfg && utag.cfg.utagdb,
      noconsole: utag.cfg && utag.cfg.noconsole,
      dbLogLength: Array.isArray(utag.db_log) ? utag.db_log.length : null,
    });
    flushDbLog();
  };

  const ensureWrapped = () => {
    wrapUtagDb();
  };

  ensureWrapped();
  setInterval(ensureWrapped, 1000);

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) {
      return;
    }
    if (event.data.source !== 'tealium-extension' || event.data.type !== 'set_enabled') {
      return;
    }
    const nextEnabled = Boolean(event.data.enabled);
    if (nextEnabled && !enabled) {
      lastDbIndex = 0;
      enabled = true;
      wrapUtagDb();
      flushDbLog();
      return;
    }
    enabled = nextEnabled;
  });

})();
