let config = {};

async function init() {
  config = await fetch('/api/config').then(r => r.json());
  render();
  bindEvents();
}

function render() {
  renderList('authors-list', config.authors, 'authors');
  renderList('portfolios-list', config.portfolios, 'portfolios');
  renderList('channels-list', config.channels, 'channels');
  renderList('statuses-list', config.approvalStatuses, 'approval-statuses');
}

function renderList(containerId, items, apiKey) {
  const el = document.getElementById(containerId);
  if (!items.length) { el.innerHTML = '<span style="color:var(--muted);font-size:12px">None added yet.</span>'; return; }
  el.innerHTML = items.map(v => `
    <span class="tag">
      ${escHtml(v)}
      <button class="tag-remove" data-key="${apiKey}" data-value="${escHtml(v)}" title="Remove">&times;</button>
    </span>
  `).join('');
  el.querySelectorAll('.tag-remove').forEach(btn => {
    btn.addEventListener('click', () => removeItem(btn.dataset.key, btn.dataset.value));
  });
}

async function addItem(apiKey, value, configKey) {
  value = value.trim();
  if (!value) return;
  try {
    const updated = await fetch(`/api/config/${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value })
    }).then(r => { if (!r.ok) throw new Error(); return r.json(); });
    config[configKey] = updated;
    render();
    toast(`Added "${value}".`, 'success');
  } catch {
    toast('Already exists or error.', 'error');
  }
}

async function removeItem(apiKey, value) {
  if (!confirm(`Remove "${value}"? Existing entries will keep this value but it won't appear in new dropdowns.`)) return;
  const configKeyMap = {
    'authors': 'authors',
    'portfolios': 'portfolios',
    'channels': 'channels',
    'approval-statuses': 'approvalStatuses'
  };
  try {
    const updated = await fetch(`/api/config/${apiKey}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value })
    }).then(r => r.json());
    config[configKeyMap[apiKey]] = updated;
    render();
    toast(`Removed "${value}".`);
  } catch {
    toast('Error removing item.', 'error');
  }
}

function bindEvents() {
  function addOnEnterAndClick(inputId, btnId, apiKey, configKey) {
    const input = document.getElementById(inputId);
    const btn = document.getElementById(btnId);
    btn.addEventListener('click', () => { addItem(apiKey, input.value, configKey); input.value = ''; });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addItem(apiKey, input.value, configKey); input.value = ''; } });
  }
  addOnEnterAndClick('new-author', 'btn-add-author', 'authors', 'authors');
  addOnEnterAndClick('new-portfolio', 'btn-add-portfolio', 'portfolios', 'portfolios');
  addOnEnterAndClick('new-channel', 'btn-add-channel', 'channels', 'channels');
  addOnEnterAndClick('new-status', 'btn-add-status', 'approval-statuses', 'approvalStatuses');
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

init();
