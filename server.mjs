// server.js
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
app.use(express.json({ limit: '1mb' }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logsDir = path.join(__dirname, 'logs');
const logPath = path.join(logsDir, 'tealium.log');
const prettyLogPath = path.join(logsDir, 'tealium.pretty.log');
const sessionsDir = path.join(logsDir, 'sessions');
const SEQ_GAP_TIMEOUT_MS = 5000;

fs.mkdirSync(logsDir, { recursive: true });
fs.mkdirSync(sessionsDir, { recursive: true });

const consoleStreams = new Map();

const getConsoleState = (key, initialSeq) => {
  if (!consoleStreams.has(key)) {
    consoleStreams.set(key, {
      nextSeq: initialSeq,
      buffer: new Map(),
      gapTimer: null,
    });
  }
  return consoleStreams.get(key);
};

const clearGapTimer = (state) => {
  if (state.gapTimer) {
    clearTimeout(state.gapTimer);
    state.gapTimer = null;
  }
};

const scheduleGapTimer = (state) => {
  if (state.gapTimer) {
    return;
  }
  state.gapTimer = setTimeout(() => {
    state.gapTimer = null;
    if (state.buffer.size === 0) {
      return;
    }
    const sequences = Array.from(state.buffer.keys()).sort((a, b) => a - b);
    state.nextSeq = sequences[0];
    flushConsoleLogs(state, (entry) => {
      writePayload(entry);
      console.log('Console log:', entry);
    });
  }, SEQ_GAP_TIMEOUT_MS);
};

const flushConsoleLogs = (state, logFn) => {
  while (state.buffer.has(state.nextSeq)) {
    const entry = state.buffer.get(state.nextSeq);
    state.buffer.delete(state.nextSeq);
    logFn(entry);
    state.nextSeq += 1;
  }
  if (state.buffer.size === 0) {
    clearGapTimer(state);
  }
};

const tryParseJson = (value) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    return value;
  }
};

const buildPrettyPayload = (payload) => {
  if (
    payload &&
    payload.console &&
    Array.isArray(payload.console.args)
  ) {
    const nextPayload = {
      ...payload,
      console: {
        ...payload.console,
        args: payload.console.args.map(tryParseJson),
      },
    };
    return nextPayload;
  }
  return payload;
};

const toSafeFilename = (value) =>
  String(value).replace(/[^a-zA-Z0-9._-]/g, '_');

const getLogPaths = (payload) => {
  if (payload && (payload.session_name || payload.session_id)) {
    const rawName = payload.session_name || payload.session_id;
    const safeId = toSafeFilename(rawName);
    return {
      log: path.join(sessionsDir, `${safeId}.log`),
      pretty: path.join(sessionsDir, `${safeId}.pretty.log`),
    };
  }
  return { log: logPath, pretty: prettyLogPath };
};

const writePayload = (payload) => {
  try {
    const paths = getLogPaths(payload);
    fs.appendFileSync(paths.log, `${JSON.stringify(payload)}\n`);
    const prettyPayload = buildPrettyPayload(payload);
    fs.appendFileSync(
      paths.pretty,
      `${JSON.stringify(prettyPayload, null, 2)}\n`
    );
  } catch (err) {
    console.error('Failed to write log:', err);
  }
};

const handleConsolePayload = (payload) => {
  const consolePayload = payload.console || {};
  const sequence = consolePayload.sequence;
  const streamKey = payload.url || consolePayload.url || 'unknown';

  if (typeof sequence === 'number') {
    const state = getConsoleState(streamKey, sequence);
    if (sequence < state.nextSeq) {
      writePayload(payload);
      console.log('Console log:', payload);
      return;
    }
    state.buffer.set(sequence, payload);
    flushConsoleLogs(state, (entry) => {
      writePayload(entry);
      console.log('Console log:', entry);
    });
    if (!state.buffer.has(state.nextSeq)) {
      scheduleGapTimer(state);
    }
    return;
  }

  writePayload(payload);
  console.log('Console log:', payload);
};

app.post('/', (req, res) => {
  const payload = req.body || {};
  if (payload.source === 'tealium-extension-console') {
    handleConsolePayload(payload);
  } else {
    writePayload(payload);
    console.log('Tealium payload:', payload);
  }
  res.status(200).json({ ok: true });
});

app.listen(3005, () => {
  console.log('Listening on http://localhost:3005');
});
