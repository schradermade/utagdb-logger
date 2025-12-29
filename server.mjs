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

fs.mkdirSync(logsDir, { recursive: true });

const consoleStreams = new Map();

const getConsoleState = (key, initialSeq) => {
  if (!consoleStreams.has(key)) {
    consoleStreams.set(key, {
      nextSeq: initialSeq,
      buffer: new Map(),
    });
  }
  return consoleStreams.get(key);
};

const flushConsoleLogs = (state, logFn) => {
  while (state.buffer.has(state.nextSeq)) {
    const entry = state.buffer.get(state.nextSeq);
    state.buffer.delete(state.nextSeq);
    logFn(entry);
    state.nextSeq += 1;
  }
};

app.post('/', (req, res) => {
  const payload = req.body || {};
  try {
    fs.appendFileSync(logPath, `${JSON.stringify(payload)}\n`);
    fs.appendFileSync(prettyLogPath, `${JSON.stringify(payload, null, 2)}\n`);
  } catch (err) {
    console.error('Failed to write log:', err);
  }
  if (payload.source === 'tealium-extension-console') {
    const consolePayload = payload.console || {};
    const sequence = consolePayload.sequence;
    const streamKey = payload.url || consolePayload.url || 'unknown';

    if (typeof sequence === 'number') {
      const state = getConsoleState(streamKey, sequence);
      if (sequence < state.nextSeq) {
        console.log('Console log:', payload);
      } else {
        state.buffer.set(sequence, payload);
        flushConsoleLogs(state, (entry) => {
          console.log('Console log:', entry);
        });
      }
    } else {
      console.log('Console log:', payload);
    }
  } else {
    console.log('Tealium payload:', payload);
  }
  res.status(200).json({ ok: true });
});

app.listen(3005, () => {
  console.log('Listening on http://localhost:3005');
});
