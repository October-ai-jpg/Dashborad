const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'state.json');
const CONFIG_DIR = path.join(__dirname, 'config');

// PostgreSQL til followups — DASHBOARD's EGEN database, IKKE October AI's
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
}) : null;

// Email config — sæt GMAIL_USER og GMAIL_APP_PASSWORD som env vars
const GMAIL_USER = process.env.GMAIL_USER || 'eb-media.dk@eb-media.dk';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || '';
const EMAIL_SIGNATURE = `\n\n--\nBest Regards\nEmil Bloch Thomsen, indehaver\nWebsite: www.eb-media.dk\nT: 22312151\nM: 31213348\nkontakt@eb-media.dk\nMarstalsgade 29, København Ø`;

const transporter = GMAIL_APP_PASSWORD ? nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD.replace(/\s/g, '') },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000
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
   FOLLOWUPS — opfølgning på mails (PostgreSQL)
   ════════════════════════════════════════ */

// Opret tabellen automatisk ved opstart
async function initFollowupsTable() {
  if (!pool) { console.log('⚠️  Ingen DATABASE_URL — followups kører IKKE'); return; }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS followups (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      til TEXT NOT NULL,
      emne TEXT NOT NULL,
      sendt_dato TEXT,
      dage_siden INTEGER DEFAULT 0,
      draft TEXT NOT NULL,
      status TEXT DEFAULT 'afventer',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ,
      sent_at TIMESTAMPTZ
    )
  `);
  console.log('✅ Followups tabel klar (PostgreSQL)');
}

// GET alle afventende opfølgninger
app.get('/api/followups', async (req, res) => {
  if (!pool) return res.json([]);
  const { rows } = await pool.query("SELECT * FROM followups WHERE status = 'afventer' ORDER BY created_at DESC");
  res.json(rows);
});

// GET alle opfølgninger (inkl. sendte/ignorerede)
app.get('/api/followups/all', async (req, res) => {
  if (!pool) return res.json([]);
  const { rows } = await pool.query('SELECT * FROM followups ORDER BY created_at DESC');
  res.json(rows);
});

// POST ny opfølgning
app.post('/api/followups', async (req, res) => {
  if (!pool) return res.status(500).json({ error: 'Database ikke konfigureret' });
  const { til, emne, sendt_dato, dage_siden, draft } = req.body;
  if (!til || !emne || !sendt_dato || !draft) {
    return res.status(400).json({ error: 'Mangler felter: til, emne, sendt_dato, draft' });
  }
  const { rows } = await pool.query(
    `INSERT INTO followups (til, emne, sendt_dato, dage_siden, draft)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [til, emne, sendt_dato, dage_siden || 0, draft]
  );
  const entry = rows[0];
  broadcast({ type: 'followup-new', followup: entry });
  res.status(201).json(entry);
});

// PATCH opdater status (sendt/ignoreret)
app.patch('/api/followups/:id', async (req, res) => {
  if (!pool) return res.status(500).json({ error: 'Database ikke konfigureret' });
  const { status } = req.body;
  if (!['sendt', 'ignoreret'].includes(status)) {
    return res.status(400).json({ error: "Status skal være 'sendt' eller 'ignoreret'" });
  }
  const { rows } = await pool.query(
    `UPDATE followups SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [status, req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Ikke fundet' });
  broadcast({ type: 'followup-update', id: req.params.id, status });
  res.json(rows[0]);
});

// POST send email direkte + marker som sendt
app.post('/api/followups/:id/send', async (req, res) => {
  if (!transporter) {
    return res.status(500).json({ error: 'Email ikke konfigureret. Sæt GMAIL_APP_PASSWORD env var.' });
  }
  if (!pool) return res.status(500).json({ error: 'Database ikke konfigureret' });

  const { rows } = await pool.query('SELECT * FROM followups WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Ikke fundet' });

  const f = rows[0];
  const body = req.body.draft || f.draft;
  const fullBody = body.includes('Best Regards') ? body : body + EMAIL_SIGNATURE;

  try {
    await transporter.sendMail({
      from: `"EB-media" <${GMAIL_USER}>`,
      to: f.til,
      subject: 'Re: ' + f.emne,
      text: fullBody
    });
    await pool.query(
      `UPDATE followups SET status = 'sendt', sent_at = NOW() WHERE id = $1`,
      [f.id]
    );
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

// Start server + init database
initFollowupsTable()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Dashboard running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('DB init fejl (kører uden followups):', err.message);
    server.listen(PORT, () => {
      console.log(`Dashboard running on port ${PORT} (uden database)`);
    });
  });
