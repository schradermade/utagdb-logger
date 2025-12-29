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

  const methods = ['log', 'info', 'warn', 'error', 'debug'];
  const originals = {};

  const wrapMethod = (method) => {
    const current = console[method];
    if (current && current.__tealiumWrapped) {
      return;
    }
    originals[method] = current;
    const wrapped = function (...args) {
      try {
        window.postMessage(
          {
            source: 'tealium-extension',
            type: 'console_log',
            payload: args.map(safeSerialize),
            timestamp: new Date().toISOString(),
            level: method,
          },
          '*'
        );
      } catch (err) {
        // ignore
      }
      if (typeof originals[method] === 'function') {
        return originals[method].apply(console, args);
      }
      return undefined;
    };
    wrapped.__tealiumWrapped = true;
    console[method] = wrapped;
  };

  const ensureWrapped = () => {
    methods.forEach((method) => wrapMethod(method));
  };

  ensureWrapped();
  setInterval(ensureWrapped, 1000);

  try {
    window.postMessage(
      {
        source: 'tealium-extension',
        type: 'console_log',
        payload: ['[tealium-extension] console bridge ready'],
        timestamp: new Date().toISOString(),
      },
      '*'
    );
  } catch (err) {
    // ignore
  }
})();
