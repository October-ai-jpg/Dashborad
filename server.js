const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'state.json');
const FOLLOWUPS_FILE = path.join(__dirname, 'data', 'followups.json');
const CONFIG_DIR = path.join(__dirname, 'config');

// Email config — sæt GMAIL_USER og GMAIL_APP_PASSWORD som env vars
const GMAIL_USER = process.env.GMAIL_USER || 'eb-media.dk@eb-media.dk';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || '';
const EMAIL_SIGNATURE = `\n\n--\nBest Regards\nEmil Bloch Thomsen, indehaver\nWebsite: www.eb-media.dk\nT: 22312151\nM: 31213348\nkontakt@eb-media.dk\nMarstalsgade 29, København Ø`;

const transporter = GMAIL_APP_PASSWORD ? nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
}) : null;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure data dir exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}

function loadState() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveState(state) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

function loadConfig(month) {
  // month format: "2025-04"
  const file = path.join(CONFIG_DIR, `${month}.json`);
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  // fallback: find latest config
  const files = fs.readdirSync(CONFIG_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse();
  if (files.length > 0) {
    return JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, files[0]), 'utf8'));
  }
  return null;
}

function broadcast(data, excludeWs = null) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

/* ════════════════════════════════════════
   FOLLOWUPS — opfølgning på mails
   ════════════════════════════════════════ */
function loadFollowups() {
  try {
    if (fs.existsSync(FOLLOWUPS_FILE)) {
      return JSON.parse(fs.readFileSync(FOLLOWUPS_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function saveFollowups(followups) {
  fs.writeFileSync(FOLLOWUPS_FILE, JSON.stringify(followups, null, 2));
}

// GET alle afventende opfølgninger
app.get('/api/followups', (req, res) => {
  const followups = loadFollowups().filter(f => f.status === 'afventer');
  res.json(followups);
});

// GET alle opfølgninger (inkl. sendte/ignorerede)
app.get('/api/followups/all', (req, res) => {
  res.json(loadFollowups());
});

// POST ny opfølgning
app.post('/api/followups', (req, res) => {
  const { til, emne, sendt_dato, dage_siden, draft } = req.body;
  if (!til || !emne || !sendt_dato || !draft) {
    return res.status(400).json({ error: 'Mangler felter: til, emne, sendt_dato, draft' });
  }
  const followups = loadFollowups();
  const entry = {
    id: require('crypto').randomUUID(),
    til, emne, sendt_dato,
    dage_siden: dage_siden || 0,
    draft,
    status: 'afventer',
    created_at: new Date().toISOString()
  };
  followups.push(entry);
  saveFollowups(followups);
  broadcast({ type: 'followup-new', followup: entry });
  res.status(201).json(entry);
});

// PATCH opdater status (sendt/ignoreret)
app.patch('/api/followups/:id', (req, res) => {
  const { status } = req.body;
  if (!['sendt', 'ignoreret'].includes(status)) {
    return res.status(400).json({ error: "Status skal være 'sendt' eller 'ignoreret'" });
  }
  const followups = loadFollowups();
  const idx = followups.findIndex(f => f.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Ikke fundet' });
  followups[idx].status = status;
  followups[idx].updated_at = new Date().toISOString();
  saveFollowups(followups);
  broadcast({ type: 'followup-update', id: req.params.id, status });
  res.json(followups[idx]);
});

// POST send email direkte + marker som sendt
app.post('/api/followups/:id/send', async (req, res) => {
  if (!transporter) {
    return res.status(500).json({ error: 'Email ikke konfigureret. Sæt GMAIL_APP_PASSWORD env var.' });
  }
  const followups = loadFollowups();
  const idx = followups.findIndex(f => f.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Ikke fundet' });

  const f = followups[idx];
  // Brug eventuelt redigeret draft fra request body
  const body = req.body.draft || f.draft;
  // Tilføj signatur automatisk hvis den ikke allerede er der
  const fullBody = body.includes('Best Regards') ? body : body + EMAIL_SIGNATURE;

  try {
    await transporter.sendMail({
      from: `"EB-media" <${GMAIL_USER}>`,
      to: f.til,
      subject: 'Re: ' + f.emne,
      text: fullBody
    });
    followups[idx].status = 'sendt';
    followups[idx].sent_at = new Date().toISOString();
    saveFollowups(followups);
    broadcast({ type: 'followup-update', id: f.id, status: 'sendt' });
    res.json({ ok: true, message: 'Email sendt til ' + f.til });
  } catch (e) {
    res.status(500).json({ error: 'Kunne ikke sende: ' + e.message });
  }
});

// GET email config status
app.get('/api/email-status', (req, res) => {
  res.json({
    configured: !!transporter,
    user: GMAIL_USER,
    signature: EMAIL_SIGNATURE
  });
});

// API: get config for a month
app.get('/api/config/:month', (req, res) => {
  const config = loadConfig(req.params.month);
  if (!config) return res.status(404).json({ error: 'No config found' });
  res.json(config);
});

// API: list available months
app.get('/api/months', (req, res) => {
  const files = fs.readdirSync(CONFIG_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .sort()
    .reverse();
  res.json(files);
});

// API: get full state
app.get('/api/state', (req, res) => {
  res.json(loadState());
});

// API: toggle a task
app.post('/api/toggle', (req, res) => {
  const { month, section, id } = req.body;
  if (!month || !section || !id) return res.status(400).json({ error: 'Missing fields' });

  const state = loadState();
  if (!state[month]) state[month] = {};
  if (!state[month][section]) state[month][section] = {};
  state[month][section][id] = !state[month][section][id];

  saveState(state);

  const payload = { type: 'toggle', month, section, id, value: state[month][section][id] };
  broadcast(payload, req.ws);
  res.json({ ok: true, value: state[month][section][id] });
});

// WebSocket
wss.on('connection', (ws) => {
  console.log('Client connected. Total:', wss.clients.size);
  ws.send(JSON.stringify({ type: 'connected', clients: wss.clients.size }));

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      // Forward any message to all other clients
      broadcast(data, ws);
    } catch (e) {}
  });

  ws.on('close', () => {
    console.log('Client disconnected. Total:', wss.clients.size);
    broadcast({ type: 'clients', count: wss.clients.size });
  });
});

server.listen(PORT, () => {
  console.log(`Dashboard running on port ${PORT}`);
});
