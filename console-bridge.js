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

  const postLog = (entry) => {
    window.postMessage(
      {
        source: 'tealium-extension',
        type: 'console_log',
        payload: [safeSerialize(entry)],
        timestamp: new Date().toISOString(),
      },
      '*'
    );
  };

  const wrapUtagDb = () => {
    const utag = window.utag;
    if (!utag || typeof utag.DB !== 'function') {
      return false;
    }
    if (utag.DB.__tealiumWrapped) {
      return true;
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
    return true;
  };

  const tryInstall = () => {
    if (wrapUtagDb()) {
      clearInterval(installTimer);
    }
  };

  const installTimer = setInterval(tryInstall, 1000);
  tryInstall();

})();
