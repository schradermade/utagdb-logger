// server.js
import express from 'express';

const app = express();
app.use(express.json());

app.post('/', (req, res) => {
  const payload = req.body || {};
  if (payload.source === 'tealium-extension-console') {
    console.log('Console log:', payload);
  } else {
    console.log('Tealium payload:', payload);
  }
  res.status(200).json({ ok: true });
});

app.listen(3005, () => {
  console.log('Listening on http://localhost:3005');
});
