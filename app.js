const CSV_PATHS = { ND: './nd_useage_matrix.csv', AD: './ad_useage_matrix.csv' };
let events = [];
let state = { fmt: 'ND', dates: [], decks: {}, chart: null };

const typeName = { added: '追加', removed: 'スタン落ち', adjusted: '調整' };

const deckSelect = document.getElementById('deckSelect');
const meta = document.getElementById('meta');

function parseCell(v) {
  const t = String(v ?? '').trim();
  if (!t || ['NA', 'N/A', '#N/A'].includes(t.toUpperCase())) return null;
  const n = Number(t.replace('%', ''));
  return Number.isNaN(n) ? null : n;
}

function parseCsv(text) {
  const lines = text.trim().split('\n').map(l => l.split(','));
  const dates = lines[0].slice(1).map(d => d.trim());
  const decks = {};
  for (let i = 1; i < lines.length; i++) {
    const name = (lines[i][0] || '').trim();
    if (!name || name === 'イベント') continue;
    decks[name] = dates.map((_, idx) => parseCell(lines[i][idx + 1]));
  }
  return { dates, decks };
}

function isZeroOrNA(v) { return v === 0 || v == null; }

function trimRange(values, minRun = 10) {
  const first = values.findIndex(v => !isZeroOrNA(v));
  if (first === -1) return null;
  let last = -1;
  for (let i = values.length - 1; i >= 0; i--) if (!isZeroOrNA(values[i])) { last = i; break; }
  let start = 0, end = values.length - 1;
  if (first >= minRun) start = first;
  if (values.length - 1 - last >= minRun) end = last;
  return { start, end };
}

function extendRangeToEvents(range, dates, fmt) {
  if (!range) return null;
  const idxByDate = new Map(dates.map((d, i) => [d, i]));
  const eIdx = events
    .filter(e => e.format === 'BOTH' || e.format === fmt)
    .map(e => idxByDate.get(e.date.replace(/-/g, '/')))
    .filter(v => v !== undefined)
    .sort((a,b)=>a-b);
  let { start, end } = range;

  // トリム結果の「直前」「直後」のイベントのみ範囲に含める
  const prev = eIdx.filter(i => i < start).pop();
  const next = eIdx.find(i => i > end);

  if (prev !== undefined) start = prev;
  if (next !== undefined) end = next;

  return { start, end };
}

function sumSeries(selected, decks, datesLen) {
  const out = [];
  for (let i = 0; i < datesLen; i++) {
    let sum = 0, has = false;
    for (const n of selected) {
      const v = decks[n]?.[i];
      if (typeof v === 'number') { sum += v; has = true; }
    }
    out.push(has ? sum : null);
  }
  return out;
}

function render() {
  const selected = Array.from(deckSelect.selectedOptions).map(o => o.value).slice(0, 5);
  if (Array.from(deckSelect.selectedOptions).length > 5) {
    alert('最大5件まで選択可能です');
  }
  if (!selected.length) return;

  const summed = sumSeries(selected, state.decks, state.dates.length);
  const base = trimRange(summed, 10);
  const range = extendRangeToEvents(base, state.dates, state.fmt);
  if (!range) return;

  const labels = state.dates.slice(range.start, range.end + 1);
  const values = summed.slice(range.start, range.end + 1);

  if (state.chart) state.chart.destroy();
  state.chart = new Chart(document.getElementById('chart'), {
    type: 'line',
    data: { labels, datasets: [{ label: selected.join(' + '), data: values, borderColor: '#2b6cb0', tension: 0.25 }] },
    options: { responsive: true, maintainAspectRatio: false }
  });

  meta.textContent = `期間: ${labels[0]} ~ ${labels[labels.length - 1]} / 合算デッキ数: ${selected.length}`;
  renderEventLabels(labels);
}

function renderEventLabels(labels) {
  const row = document.getElementById('eventRow');
  row.innerHTML = '';
  if (!state.chart) return;
  const meta = state.chart.getDatasetMeta(0);
  labels.forEach((d, i) => {
    const dayEvents = events.filter(e => (e.format === 'BOTH' || e.format === state.fmt) && e.date.replace(/-/g, '/') === d);
    dayEvents.forEach((ev, k) => {
      const el = document.createElement('div');
      const t = (ev.type || '').toLowerCase();
      el.className = `event-label ${t}`;
      el.textContent = `${typeName[t] || t}:${ev.label}`;
      el.title = ev.description || '';
      el.style.left = `${meta.data[i].x}px`;
      el.style.top = `${k * 12}px`;
      row.appendChild(el);
    });
  });
}

async function init() {
  const ev = await fetch('./events.json').then(r => r.json());
  events = ev.events || [];

  document.querySelectorAll('input[name="fmt"]').forEach(r => r.addEventListener('change', async e => {
    state.fmt = e.target.value;
    await loadCsv();
  }));
  deckSelect.addEventListener('change', render);
  await loadCsv();
}

async function loadCsv() {
  const csv = await fetch(CSV_PATHS[state.fmt]).then(r => r.text());
  const parsed = parseCsv(csv);
  state.dates = parsed.dates;
  state.decks = parsed.decks;
  const names = Object.keys(parsed.decks).sort();
  deckSelect.innerHTML = names.map(n => `<option value="${n}">${n}</option>`).join('');
  for (let i = 0; i < Math.min(3, names.length); i++) deckSelect.options[i].selected = true;
  render();
}

init();
