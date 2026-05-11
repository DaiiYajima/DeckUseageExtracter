const CSV_PATHS = { ND: './nd_useage_matrix.csv', AD: './ad_useage_matrix.csv' };
let state = { fmt: 'ND', dates: [], decks: {}, chart: null, events: [] };
const selectIds = ['deck1', 'deck2', 'deck3', 'deck4', 'deck5'];
const deckSelects = selectIds.map(id => document.getElementById(id));
const meta = document.getElementById('meta');

function parseCell(v) {
  const t = String(v ?? '').trim();
  if (!t || ['NA', 'N/A', '#N/A'].includes(t.toUpperCase())) return null;
  const n = Number(t.replace('%', ''));
  return Number.isNaN(n) ? null : n;
}

function parseCsv(text) {
  const lines = text.trim().split('\n').map(parseCsvLine);
  const dates = lines[0].slice(1).map(d => d.trim());
  const decks = {};

  for (let i = 1; i < lines.length; i++) {
    const name = (lines[i][0] || '').trim();
    if (!name || name === 'イベント') continue;
    decks[name] = dates.map((_, idx) => parseCell(lines[i][idx + 1]));
  }

  return { dates, decks };
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function isZeroOrNA(v) { return v === 0 || v == null; }

function trimRange(values, minRun = 10) {
  const first = values.findIndex(v => !isZeroOrNA(v));
  if (first === -1) return null;
  let last = -1;
  for (let i = values.length - 1; i >= 0; i--) {
    if (!isZeroOrNA(values[i])) { last = i; break; }
  }
  let start = 0;
  let end = values.length - 1;
  if (first >= minRun) start = first;
  if (values.length - 1 - last >= minRun) end = last;
  return { start, end };
}

function getSelectedDecks() {
  const selected = deckSelects.map(s => s.value).filter(Boolean);
  return [...new Set(selected)];
}

function sumSeries(selected, decks, datesLen) {
  const out = [];
  for (let i = 0; i < datesLen; i++) {
    let sum = 0;
    let hasNumber = false;
    for (const name of selected) {
      const v = decks[name]?.[i];
      if (typeof v === 'number') { sum += v; hasNumber = true; }
    }
    out.push(hasNumber ? sum : null);
  }
  return out;
}

function renderEventLabels(labels) {
  const row = document.getElementById('eventRow');
  row.innerHTML = '';
  if (!state.chart) return;

  const datasetMeta = state.chart.getDatasetMeta(0);
  labels.forEach((d, i) => {
    const dayEvents = state.events.filter(e => (e.format === 'BOTH' || e.format === state.fmt) && e.date.replace(/-/g, '/') === d);
    dayEvents.forEach((ev, k) => {
      const el = document.createElement('div');
      const t = String(ev.type || '').toLowerCase();
      el.className = `event-label ${t}`;
      el.textContent = ev.label;
      el.title = ev.description || '';
      el.style.left = `${datasetMeta.data[i].x}px`;
      el.style.top = `${k * 12}px`;
      row.appendChild(el);
    });
  });
}

function render() {
  const selected = getSelectedDecks();
  if (!selected.length) return;

  const summed = sumSeries(selected, state.decks, state.dates.length);
  const range = trimRange(summed, 10);
  if (!range) return;

  const labels = state.dates.slice(range.start, range.end + 1);
  const values = summed.slice(range.start, range.end + 1);

  if (state.chart) state.chart.destroy();
  state.chart = new Chart(document.getElementById('chart'), {
    type: 'line',
    data: {
      labels,
      datasets: [{ label: selected.join(' + '), data: values, borderColor: '#2b6cb0', tension: 0.25 }],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });

  meta.textContent = `期間: ${labels[0]} ~ ${labels[labels.length - 1]} / 合算デッキ数: ${selected.length}`;
  renderEventLabels(labels);
}

function setupDeckOptions(names) {
  deckSelects.forEach((sel, idx) => {
    sel.innerHTML = '';
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = '（未選択）';
    sel.appendChild(empty);
    names.forEach(n => {
      const opt = document.createElement('option');
      opt.value = n;
      opt.textContent = n;
      sel.appendChild(opt);
    });
    if (names[idx]) sel.value = names[idx];
  });
}

async function loadCsv() {
  const csv = await fetch(CSV_PATHS[state.fmt]).then(r => r.text());
  const parsed = parseCsv(csv);
  state.dates = parsed.dates;
  state.decks = parsed.decks;
  const names = Object.keys(parsed.decks).sort();
  setupDeckOptions(names);
  render();
}

async function init() {
  const ev = await fetch('./events.json').then(r => r.json());
  state.events = ev.events || [];

  document.querySelectorAll('input[name="fmt"]').forEach(r => {
    r.addEventListener('change', async e => {
      state.fmt = e.target.value;
      await loadCsv();
    });
  });

  deckSelects.forEach(sel => sel.addEventListener('change', render));
  await loadCsv();
}

init();
