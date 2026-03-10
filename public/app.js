// ── State ─────────────────────────────────────────────────────────────────────
let entries = [];
let config = { channels: [], portfolios: [], authors: [], approvalStatuses: [] };
let sortKey = 'date';
let sortDir = 1; // 1 = asc, -1 = desc
let editingAssets = []; // assets for the open modal

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await Promise.all([loadConfig(), loadEntries()]);
  populateFilterDropdowns();
  renderTable();
  bindEvents();
}

// ── API helpers ───────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function loadEntries() {
  entries = await api('GET', '/api/entries');
}

async function loadConfig() {
  config = await api('GET', '/api/config');
}

// ── Dropdowns ─────────────────────────────────────────────────────────────────
function populateSelect(el, values, placeholder) {
  const current = el.value;
  el.innerHTML = placeholder ? `<option value="">${placeholder}</option>` : '';
  values.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; el.appendChild(o); });
  if (values.includes(current)) el.value = current;
}

function populateFilterDropdowns() {
  populateSelect(document.getElementById('f-author'), config.authors, 'All');
  populateSelect(document.getElementById('f-portfolio'), config.portfolios, 'All');
  populateSelect(document.getElementById('f-channel'), config.channels, 'All');
  populateSelect(document.getElementById('f-approval'), config.approvalStatuses, 'All');
  populateSelect(document.getElementById('f-entry-author'), config.authors, 'Select author…');
  populateSelect(document.getElementById('f-entry-portfolio'), config.portfolios, 'Select portfolio…');
  populateSelect(document.getElementById('f-entry-channel'), config.channels, 'Select channel…');
  populateSelect(document.getElementById('f-entry-approval'), config.approvalStatuses, 'Select status…');
}

// ── Filters ───────────────────────────────────────────────────────────────────
function getFilters() {
  return {
    dateFrom: document.getElementById('f-date-from').value,
    dateTo:   document.getElementById('f-date-to').value,
    author:   document.getElementById('f-author').value,
    name:     document.getElementById('f-name').value.toLowerCase(),
    portfolio: document.getElementById('f-portfolio').value,
    channel:  document.getElementById('f-channel').value,
    approval: document.getElementById('f-approval').value,
  };
}

function applyFilters(list) {
  const f = getFilters();
  return list.filter(e => {
    if (f.dateFrom && e.date < f.dateFrom) return false;
    if (f.dateTo   && e.date > f.dateTo)   return false;
    if (f.author   && e.author !== f.author) return false;
    if (f.name     && !(e.name || '').toLowerCase().includes(f.name)) return false;
    if (f.portfolio && e.portfolio !== f.portfolio) return false;
    if (f.channel  && e.channel !== f.channel) return false;
    if (f.approval && e.approval !== f.approval) return false;
    return true;
  });
}

// ── Sorting ───────────────────────────────────────────────────────────────────
function applySort(list) {
  return [...list].sort((a, b) => {
    const av = (a[sortKey] || '').toLowerCase();
    const bv = (b[sortKey] || '').toLowerCase();
    return av < bv ? -sortDir : av > bv ? sortDir : 0;
  });
}

// ── Render ────────────────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function badgeClass(status) {
  if (!status) return 'badge-default';
  const s = status.toLowerCase();
  if (s.includes('draft')) return 'badge-draft';
  if (s.includes('pending')) return 'badge-pending';
  if (s.includes('approved')) return 'badge-approved';
  if (s.includes('published')) return 'badge-published';
  return 'badge-default';
}

function renderAssets(assets) {
  if (!assets || !assets.length) return '—';
  return `<ul class="assets-list">${assets.map(a =>
    `<li><a href="${escHtml(a.url)}" target="_blank" rel="noopener">${escHtml(a.name || a.url)}</a></li>`
  ).join('')}</ul>`;
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderTable() {
  const filtered = applySort(applyFilters(entries));
  const tbody = document.getElementById('table-body');
  const info = document.getElementById('results-info');
  info.textContent = `Showing ${filtered.length} of ${entries.length} entries`;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty-state"><strong>No entries found</strong><p>Try adjusting the filters or add a new entry.</p></td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(e => `
    <tr data-id="${e.id}">
      <td class="col-date">${fmtDate(e.date)}</td>
      <td class="col-author">${escHtml(e.author)}</td>
      <td class="col-name"><strong>${escHtml(e.name)}</strong></td>
      <td class="col-portfolio">${escHtml(e.portfolio)}</td>
      <td class="col-channel">${e.channel ? `<span class="chip">${escHtml(e.channel)}</span>` : '—'}</td>
      <td class="col-copy"><div class="cell-truncate">${escHtml(e.copy)}</div></td>
      <td class="col-approval">${e.approval ? `<span class="badge ${badgeClass(e.approval)}">${escHtml(e.approval)}</span>` : '—'}</td>
      <td class="col-assets">${renderAssets(e.otherAssets)}</td>
      <td class="col-comments"><div class="cell-truncate">${escHtml(e.comments)}</div></td>
      <td class="col-actions">
        <div class="row-actions">
          <button class="btn btn-ghost btn-icon btn-edit" title="Edit" data-id="${e.id}">&#9998;</button>
        </div>
      </td>
    </tr>
  `).join('');

  // Update sort header indicators
  document.querySelectorAll('thead th[data-sort]').forEach(th => {
    th.classList.toggle('sorted', th.dataset.sort === sortKey);
    const icon = th.querySelector('.sort-icon');
    if (th.dataset.sort === sortKey) icon.textContent = sortDir === 1 ? '↑' : '↓';
    else icon.textContent = '↕';
  });
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openModal(entry = null) {
  document.getElementById('modal-title').textContent = entry ? 'Edit Entry' : 'Add Entry';
  document.getElementById('btn-delete').style.display = entry ? 'inline-flex' : 'none';

  document.getElementById('f-id').value = entry?.id || '';
  document.getElementById('f-entry-date').value = entry?.date || '';
  document.getElementById('f-entry-author').value = entry?.author || '';
  document.getElementById('f-entry-name').value = entry?.name || '';
  document.getElementById('f-entry-portfolio').value = entry?.portfolio || '';
  document.getElementById('f-entry-channel').value = entry?.channel || '';
  document.getElementById('f-entry-copy').value = entry?.copy || '';
  document.getElementById('f-entry-approval').value = entry?.approval || '';
  document.getElementById('f-entry-comments').value = entry?.comments || '';

  editingAssets = entry?.otherAssets ? JSON.parse(JSON.stringify(entry.otherAssets)) : [];
  renderAssetsEditor();
  document.getElementById('asset-link-url').value = '';
  document.getElementById('asset-link-name').value = '';
  document.getElementById('asset-file-input').value = '';

  document.getElementById('entry-modal').classList.add('open');
}

function closeModal() {
  document.getElementById('entry-modal').classList.remove('open');
}

function renderAssetsEditor() {
  const el = document.getElementById('assets-list-editor');
  if (!editingAssets.length) { el.innerHTML = ''; return; }
  el.innerHTML = editingAssets.map((a, i) => `
    <div class="asset-item">
      <a href="${escHtml(a.url)}" target="_blank" rel="noopener">${escHtml(a.name || a.url)}</a>
      <button type="button" class="btn btn-ghost btn-icon btn-sm" data-remove="${i}" title="Remove">&#10005;</button>
    </div>
  `).join('');
  el.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      editingAssets.splice(parseInt(btn.dataset.remove), 1);
      renderAssetsEditor();
    });
  });
}

async function saveEntry() {
  const id = document.getElementById('f-id').value;
  const data = {
    date:       document.getElementById('f-entry-date').value,
    author:     document.getElementById('f-entry-author').value,
    name:       document.getElementById('f-entry-name').value.trim(),
    portfolio:  document.getElementById('f-entry-portfolio').value,
    channel:    document.getElementById('f-entry-channel').value,
    copy:       document.getElementById('f-entry-copy').value.trim(),
    approval:   document.getElementById('f-entry-approval').value,
    comments:   document.getElementById('f-entry-comments').value.trim(),
    otherAssets: editingAssets,
  };

  if (!data.date || !data.name) { toast('Date and Name are required.', 'error'); return; }

  try {
    if (id) {
      const updated = await api('PUT', `/api/entries/${id}`, data);
      const idx = entries.findIndex(e => e.id === id);
      if (idx !== -1) entries[idx] = updated;
      toast('Entry updated.');
    } else {
      const created = await api('POST', '/api/entries', data);
      entries.push(created);
      toast('Entry added.', 'success');
    }
    closeModal();
    renderTable();
  } catch (err) {
    toast('Error saving entry.', 'error');
    console.error(err);
  }
}

async function deleteEntry(id) {
  if (!confirm('Delete this entry? This cannot be undone.')) return;
  try {
    await api('DELETE', `/api/entries/${id}`);
    entries = entries.filter(e => e.id !== id);
    closeModal();
    renderTable();
    toast('Entry deleted.');
  } catch (err) {
    toast('Error deleting entry.', 'error');
  }
}

// ── File upload ───────────────────────────────────────────────────────────────
async function uploadFile() {
  const input = document.getElementById('asset-file-input');
  if (!input.files.length) { toast('Choose a file first.', 'error'); return; }
  const formData = new FormData();
  formData.append('file', input.files[0]);

  document.getElementById('upload-progress').style.display = 'block';
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    editingAssets.push({ name: data.name, url: data.url });
    renderAssetsEditor();
    input.value = '';
    toast('File uploaded.', 'success');
  } catch (err) {
    toast('Upload failed.', 'error');
  } finally {
    document.getElementById('upload-progress').style.display = 'none';
  }
}

// ── Import CSV / XLSX ─────────────────────────────────────────────────────────
async function importFile() {
  const input = document.getElementById('import-file-input');
  if (!input.files.length) return;
  const formData = new FormData();
  formData.append('file', input.files[0]);
  try {
    const res = await fetch('/api/import', { method: 'POST', body: formData });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    await loadEntries();
    renderTable();
    toast(`Imported ${data.imported} entr${data.imported === 1 ? 'y' : 'ies'}.`, 'success');
  } catch (err) {
    toast('Import failed.', 'error');
    console.error(err);
  }
  input.value = '';
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── Events ────────────────────────────────────────────────────────────────────
function bindEvents() {
  // Header buttons
  document.getElementById('btn-add').addEventListener('click', () => openModal());
  document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file-input').click());
  document.getElementById('import-file-input').addEventListener('change', importFile);

  // Modal controls
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-save').addEventListener('click', saveEntry);
  document.getElementById('btn-delete').addEventListener('click', () => {
    const id = document.getElementById('f-id').value;
    if (id) deleteEntry(id);
  });

  // Close modal on overlay click
  document.getElementById('entry-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('entry-modal')) closeModal();
  });

  // Assets
  document.getElementById('btn-add-link').addEventListener('click', () => {
    const url = document.getElementById('asset-link-url').value.trim();
    const name = document.getElementById('asset-link-name').value.trim();
    if (!url) { toast('Enter a URL.', 'error'); return; }
    editingAssets.push({ name: name || url, url });
    renderAssetsEditor();
    document.getElementById('asset-link-url').value = '';
    document.getElementById('asset-link-name').value = '';
  });
  document.getElementById('btn-upload-file').addEventListener('click', uploadFile);

  // Edit row buttons (delegated)
  document.getElementById('table-body').addEventListener('click', e => {
    const btn = e.target.closest('.btn-edit');
    if (btn) {
      const entry = entries.find(x => x.id === btn.dataset.id);
      if (entry) openModal(entry);
    }
  });

  // Filters
  ['f-date-from','f-date-to','f-author','f-name','f-portfolio','f-channel','f-approval'].forEach(id => {
    document.getElementById(id).addEventListener('input', renderTable);
    document.getElementById(id).addEventListener('change', renderTable);
  });

  document.getElementById('btn-clear-filters').addEventListener('click', () => {
    ['f-date-from','f-date-to','f-name'].forEach(id => document.getElementById(id).value = '');
    ['f-author','f-portfolio','f-channel','f-approval'].forEach(id => document.getElementById(id).value = '');
    renderTable();
  });

  // Sorting
  document.querySelectorAll('thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      if (sortKey === th.dataset.sort) sortDir *= -1;
      else { sortKey = th.dataset.sort; sortDir = 1; }
      renderTable();
    });
  });

  // Keyboard close
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });
}

init();
