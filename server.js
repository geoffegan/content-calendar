const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_FILE = path.join(__dirname, 'data', 'entries.json');
const CONFIG_FILE = path.join(__dirname, 'data', 'config.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + '-' + file.originalname);
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// Helpers
function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ── Entries ──────────────────────────────────────────────────────────────────

app.get('/api/entries', (req, res) => {
  const entries = readJSON(DATA_FILE);
  res.json(entries);
});

app.post('/api/entries', (req, res) => {
  const entries = readJSON(DATA_FILE);
  const entry = { id: genId(), ...req.body, createdAt: new Date().toISOString() };
  entries.push(entry);
  writeJSON(DATA_FILE, entries);
  res.status(201).json(entry);
});

app.put('/api/entries/:id', (req, res) => {
  const entries = readJSON(DATA_FILE);
  const idx = entries.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  entries[idx] = { ...entries[idx], ...req.body, id: req.params.id };
  writeJSON(DATA_FILE, entries);
  res.json(entries[idx]);
});

app.delete('/api/entries/:id', (req, res) => {
  const entries = readJSON(DATA_FILE);
  const idx = entries.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  entries.splice(idx, 1);
  writeJSON(DATA_FILE, entries);
  res.json({ ok: true });
});

// ── File upload ───────────────────────────────────────────────────────────────

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({
    name: req.file.originalname,
    url: '/uploads/' + req.file.filename
  });
});

app.delete('/api/upload', (req, res) => {
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ error: 'No filename' });
  const filepath = path.join(UPLOADS_DIR, path.basename(filename));
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
  res.json({ ok: true });
});

// ── Import CSV / XLSX ─────────────────────────────────────────────────────────

app.post('/api/import', importUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });

  let workbook;
  try {
    workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
  } catch (e) {
    return res.status(400).json({ error: 'Could not parse file' });
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  function col(row, ...keys) {
    for (const k of keys) {
      const found = Object.keys(row).find(rk => rk.toLowerCase().trim() === k.toLowerCase());
      if (found !== undefined && row[found] !== '') return String(row[found]).trim();
    }
    return '';
  }

  function parseDate(val) {
    if (!val) return '';
    if (val instanceof Date) return val.toISOString().slice(0, 10);
    const s = String(val).trim();
    const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
    return s;
  }

  const entries = readJSON(DATA_FILE);
  const newEntries = [];

  for (const row of rows) {
    const name = col(row, 'name');
    if (!name) continue;
    newEntries.push({
      id: genId(),
      date: parseDate(col(row, 'date')),
      author: col(row, 'author'),
      name,
      portfolio: col(row, 'portfolio'),
      channel: col(row, 'channel'),
      copy: col(row, 'copy'),
      approval: col(row, 'approval', 'approval status'),
      comments: col(row, 'comments'),
      otherAssets: [],
      createdAt: new Date().toISOString(),
    });
  }

  entries.push(...newEntries);
  writeJSON(DATA_FILE, entries);
  res.json({ imported: newEntries.length });
});

// ── Config ────────────────────────────────────────────────────────────────────

app.get('/api/config', (req, res) => {
  res.json(readJSON(CONFIG_FILE));
});

// Generic config list updater
function configListHandler(listKey) {
  return {
    add: (req, res) => {
      const config = readJSON(CONFIG_FILE);
      const value = (req.body.value || '').trim();
      if (!value) return res.status(400).json({ error: 'Value required' });
      if (config[listKey].includes(value)) return res.status(409).json({ error: 'Already exists' });
      config[listKey].push(value);
      writeJSON(CONFIG_FILE, config);
      res.json(config[listKey]);
    },
    remove: (req, res) => {
      const config = readJSON(CONFIG_FILE);
      const value = req.body.value;
      config[listKey] = config[listKey].filter(v => v !== value);
      writeJSON(CONFIG_FILE, config);
      res.json(config[listKey]);
    }
  };
}

const channelHandlers = configListHandler('channels');
const portfolioHandlers = configListHandler('portfolios');
const authorHandlers = configListHandler('authors');
const statusHandlers = configListHandler('approvalStatuses');

app.post('/api/config/channels', channelHandlers.add);
app.delete('/api/config/channels', channelHandlers.remove);
app.post('/api/config/portfolios', portfolioHandlers.add);
app.delete('/api/config/portfolios', portfolioHandlers.remove);
app.post('/api/config/authors', authorHandlers.add);
app.delete('/api/config/authors', authorHandlers.remove);
app.post('/api/config/approval-statuses', statusHandlers.add);
app.delete('/api/config/approval-statuses', statusHandlers.remove);

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Content Calendar running at http://localhost:${PORT}`);
});
