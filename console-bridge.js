(() => {
  if (window.__tealiumConsoleBridgeInstalled) {
    return;
  }
  window.__tealiumConsoleBridgeInstalled = true;

  const safeSerialize = (value) => {
    try {
      if (value instanceof Error) {
        const payload = {
          name: value.name,
          message: value.message,
          stack: value.stack,
        };
        if ('cause' in value) {
          try {
            if (value.cause instanceof Error) {
              payload.cause = {
                name: value.cause.name,
                message: value.cause.message,
                stack: value.cause.stack,
              };
            } else if (typeof value.cause === 'string') {
              payload.cause = value.cause;
            } else {
              payload.cause = JSON.parse(JSON.stringify(value.cause));
            }
          } catch (err) {
            payload.cause = String(value.cause);
          }
        }
        return JSON.stringify(payload);
      }
      if (typeof value === 'string') {
        return value;
      }
      return JSON.stringify(value);
    } catch (err) {
      return String(value);
    }
  };

  let sequence = 0;
  let enabled = false;
  let lastDbIndex = 0;
  let dbGeneration = 0;

  const postLog = (entry, meta = {}) => {
    window.postMessage(
      {
        source: 'tealium-extension',
        type: 'console_log',
        payload: [safeSerialize(entry)],
        timestamp: new Date().toISOString(),
        sequence: sequence++,
        db_index:
          typeof meta.dbIndex === 'number' ? meta.dbIndex : undefined,
        db_generation:
          typeof meta.dbGeneration === 'number' ? meta.dbGeneration : undefined,
      },
      '*'
    );
  };

  const drainDbLog = () => {
    const utag = window.utag;
    if (!utag || !Array.isArray(utag.db_log)) {
      return;
    }
    const total = utag.db_log.length;
    if (total < lastDbIndex) {
      lastDbIndex = 0;
      dbGeneration += 1;
    }
    for (let i = lastDbIndex; i < total; i += 1) {
      try {
        postLog(utag.db_log[i], { dbIndex: i, dbGeneration });
      } catch (err) {
        // ignore
      }
    }
    lastDbIndex = total;
  };

  const syncDbIndex = () => {
    const utag = window.utag;
    if (!utag || !Array.isArray(utag.db_log)) {
      return;
    }
    lastDbIndex = utag.db_log.length;
  };

  const wrapUtagDb = () => {
    if (!enabled) {
      return;
    }
    const utag = window.utag;
    if (!utag || typeof utag.DB !== 'function') {
      return;
    }
    if (utag.DB.__tealiumWrapped) {
      return;
    }

    const original = utag.DB;
    utag.DB = function (...args) {
      const result = original.apply(this, args);
      drainDbLog();
      if (args.length && !Array.isArray(utag.db_log)) {
        try {
          postLog(args[0]);
        } catch (err) {
          // ignore
        }
      }

      return result;
    };
    utag.DB.__tealiumWrapped = true;
  };

  const ensureWrapped = () => {
    wrapUtagDb();
  };

  ensureWrapped();
  setInterval(() => {
    ensureWrapped();
    if (enabled) {
      drainDbLog();
    }
  }, 1000);

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) {
      return;
    }
    if (event.data.source !== 'tealium-extension' || event.data.type !== 'set_enabled') {
      return;
    }
    const nextEnabled = Boolean(event.data.enabled);
    if (nextEnabled && !enabled) {
      enabled = true;
      sequence = 0;
      if (event.data.initial) {
        lastDbIndex = 0;
        drainDbLog();
      } else {
        syncDbIndex();
      }
      wrapUtagDb();
      return;
    }
    enabled = nextEnabled;
  });

})();
