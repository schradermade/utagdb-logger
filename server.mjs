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
const DB_ORDER_MULTIPLIER = 1_000_000_000;

fs.mkdirSync(logsDir, { recursive: true });
fs.mkdirSync(sessionsDir, { recursive: true });

const consoleBuffers = new Map();

const getConsoleBuffer = (key) => {
  if (!consoleBuffers.has(key)) {
    consoleBuffers.set(key, []);
  }
  return consoleBuffers.get(key);
};

const flushConsoleBuffer = (key) => {
  const buffer = consoleBuffers.get(key);
  if (!buffer || buffer.length === 0) {
    consoleBuffers.delete(key);
    return;
  }
  buffer.sort((a, b) => {
    const aHas = typeof a.orderKey === 'number';
    const bHas = typeof b.orderKey === 'number';
    if (aHas && bHas) {
      return a.orderKey - b.orderKey;
    }
    if (aHas) return -1;
    if (bHas) return 1;
    const aSeq = typeof a.sequence === 'number' ? a.sequence : null;
    const bSeq = typeof b.sequence === 'number' ? b.sequence : null;
    if (aSeq !== null && bSeq !== null) {
      return aSeq - bSeq;
    }
    return a.index - b.index;
  });
  buffer.forEach((entry) => {
    writePayload(entry.payload);
    console.log('Console log:', entry.payload);
  });
  consoleBuffers.delete(key);
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
    const rawName = payload.session_id || payload.session_name;
    const safeName = toSafeFilename(rawName);
    const fileStem = safeName;
    return {
      log: path.join(sessionsDir, `${fileStem}.log`),
      pretty: path.join(sessionsDir, `${fileStem}.pretty.log`),
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
  const streamKey = `${payload.session_id || 'no-session'}::${payload.url || consolePayload.url || 'unknown'}`;
  const dbIndex = consolePayload.db_index;
  const dbGeneration = consolePayload.db_generation;
  const dbOrder =
    typeof dbIndex === 'number' && typeof dbGeneration === 'number'
      ? dbGeneration * DB_ORDER_MULTIPLIER + dbIndex
      : null;
  const orderKey = typeof dbOrder === 'number' ? dbOrder : null;
  const buffer = getConsoleBuffer(streamKey);
  buffer.push({
    payload,
    orderKey,
    sequence,
    index: buffer.length,
  });
};

app.post('/', (req, res) => {
  const payload = req.body || {};
  if (payload.source === 'tealium-extension-console') {
    handleConsolePayload(payload);
  } else if (
    payload.source === 'tealium-extension-session' &&
    typeof payload.event === 'string' &&
    payload.event.startsWith('end')
  ) {
    const flushKey = `${payload.session_id || 'no-session'}::unknown`;
    flushConsoleBuffer(flushKey);
    for (const key of consoleBuffers.keys()) {
      if (key.startsWith(`${payload.session_id || 'no-session'}::`)) {
        flushConsoleBuffer(key);
      }
    }
    writePayload(payload);
    console.log('Tealium payload:', payload);
  } else {
    writePayload(payload);
    console.log('Tealium payload:', payload);
  }
  res.status(200).json({ ok: true });
});

app.listen(3005, () => {
  console.log('Listening on http://localhost:3005');
});
