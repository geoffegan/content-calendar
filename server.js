const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Data directory ────────────────────────────────────────────────────────────
// Use DATA_DIR env var if set, otherwise use local data/ if writable, else /tmp
function resolveDataDir() {
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);
  const local = path.join(__dirname, 'data');
  try { fs.accessSync(local, fs.constants.W_OK); return local; } catch {}
  return '/tmp/content-calendar-data';
}

const DATA_DIR = resolveDataDir();
const DATA_FILE = path.join(DATA_DIR, 'entries.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// Seed writable data dir from bundled defaults if needed
if (DATA_DIR !== path.join(__dirname, 'data')) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const bundled = path.join(__dirname, 'data');
  for (const f of ['entries.json', 'config.json']) {
    const dest = path.join(DATA_DIR, f);
    if (!fs.existsSync(dest)) fs.copyFileSync(path.join(bundled, f), dest);
  }
}

// Uploads: use /tmp on read-only filesystems
const localUploads = path.join(__dirname, 'uploads');
let UPLOADS_DIR = localUploads;
try { fs.accessSync(localUploads, fs.constants.W_OK); } catch {
  UPLOADS_DIR = '/tmp/content-calendar-uploads';
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

console.log(`Data dir: ${DATA_DIR}`);
console.log(`Uploads dir: ${UPLOADS_DIR}`);

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

app.post('/api/import', (req, res) => {
  importUpload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large (max 10 MB)' });
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file received' });

    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!['.csv', '.xlsx', '.xls'].includes(ext)) {
      return res.status(400).json({ error: `Unsupported file type "${ext}" — use .csv, .xlsx, or .xls` });
    }

    let workbook;
    try {
      workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    } catch (e) {
      return res.status(400).json({ error: `Could not parse file: ${e.message}` });
    }

    if (!workbook.SheetNames.length) {
      return res.status(400).json({ error: 'File contains no sheets' });
    }

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (!rows.length) {
      return res.status(400).json({ error: 'Sheet is empty or has no data rows' });
    }

    const firstRowKeys = Object.keys(rows[0]);
    const hasNameCol = firstRowKeys.some(k => k.toLowerCase().trim() === 'name');
    if (!hasNameCol) {
      return res.status(400).json({
        error: `No "Name" column found. Columns detected: ${firstRowKeys.join(', ') || '(none)'}`
      });
    }

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

    try {
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
          contentType: col(row, 'content type', 'contenttype', 'type'),
          channel: col(row, 'channel'),
          copy: col(row, 'copy'),
          approval: col(row, 'approval', 'approval status'),
          comments: col(row, 'comments'),
          otherAssets: [],
          createdAt: new Date().toISOString(),
        });
      }

      if (!newEntries.length) {
        return res.status(400).json({ error: 'No rows imported — all rows were missing a Name value' });
      }

      entries.push(...newEntries);
      writeJSON(DATA_FILE, entries);
      res.json({ imported: newEntries.length });
    } catch (e) {
      console.error('Import error:', e);
      res.status(500).json({ error: `Server error: ${e.message}` });
    }
  });
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
const contentTypeHandlers = configListHandler('contentTypes');

app.post('/api/config/channels', channelHandlers.add);
app.delete('/api/config/channels', channelHandlers.remove);
app.post('/api/config/portfolios', portfolioHandlers.add);
app.delete('/api/config/portfolios', portfolioHandlers.remove);
app.post('/api/config/authors', authorHandlers.add);
app.delete('/api/config/authors', authorHandlers.remove);
app.post('/api/config/approval-statuses', statusHandlers.add);
app.delete('/api/config/approval-statuses', statusHandlers.remove);
app.post('/api/config/content-types', contentTypeHandlers.add);
app.delete('/api/config/content-types', contentTypeHandlers.remove);

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Content Calendar running at http://localhost:${PORT}`);
});
