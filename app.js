const CSV_PATHS = { ND: './nd_usage_matrix.csv', AD: './ad_usage_matrix.csv' };
let state = { fmt: 'ND', dates: [], decks: {}, chart: null, events: [] };
const selectIds = ['deck1', 'deck2', 'deck3', 'deck4', 'deck5'];
const deckSelects = selectIds.map(id => document.getElementById(id));
const meta = document.getElementById('meta');
const eventTooltip = document.createElement('div');
eventTooltip.className = 'event-tooltip';
document.body.appendChild(eventTooltip);
const eventLinePlugin = {
  id: 'eventLines',
  afterDatasetsDraw(chart, _args, options) {
    const events = options?.events || [];
    if (!events.length) return;

    const { ctx, chartArea } = chart;
    const datasetMeta = chart.getDatasetMeta(0);
    const xPositions = [...new Set(events.map(ev => Math.round(datasetMeta.data[ev.index]?.x)).filter(Number.isFinite))];

    ctx.save();
    ctx.strokeStyle = '#718096';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    xPositions.forEach(x => {
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
    });
    ctx.restore();
  },
};

Chart.register(eventLinePlugin);

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
  for (let i = values.length - 1; i >= 0; i--) {
    if (!isZeroOrNA(values[i])) { last = i; break; }
  }
  let start = 0;
  let end = values.length - 1;
  if (first >= minRun) start = first;
  if (values.length - 1 - last >= minRun) end = last;
  return { start, end };
}

function includeNeighboringEvents(range, dates) {
  const eventIndexes = state.events
    .filter(e => e.format === 'BOTH' || e.format === state.fmt)
    .map(e => dates.indexOf(e.date.replace(/-/g, '/')))
    .filter(i => i !== -1)
    .sort((a, b) => a - b);

  const previous = eventIndexes.filter(i => i < range.start).at(-1);
  const next = eventIndexes.find(i => i > range.end);

  return {
    start: previous ?? range.start,
    end: next ?? range.end,
  };
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

function formatPercent(value) {
  return typeof value === 'number' ? `${value.toFixed(1)}%` : 'NA';
}

function getVisibleEvents(labels) {
  return labels.flatMap((d, index) => {
    const dayEvents = state.events.filter(e => (e.format === 'BOTH' || e.format === state.fmt) && e.date.replace(/-/g, '/') === d);
    return dayEvents.map(event => ({ ...event, index }));
  });
}

function renderEventLabels(labels) {
  const row = document.getElementById('eventRow');
  row.innerHTML = '';
  if (!state.chart) return;

  const datasetMeta = state.chart.getDatasetMeta(0);
  const lanes = [];
  const labelGap = 6;
  const laneHeight = 18;
  const rowPadding = 4;
  const rowWidth = row.clientWidth;
  const visibleEvents = getVisibleEvents(labels).map(ev => ({
    ...ev,
    x: datasetMeta.data[ev.index].x,
    width: Math.min(86, Math.max(28, String(ev.label || '').length * 7 + 22)),
  })).sort((a, b) => a.x - b.x);

  visibleEvents.forEach(ev => {
    const displayX = Math.min(Math.max(ev.x, ev.width / 2 + rowPadding), rowWidth - ev.width / 2 - rowPadding);
    const left = displayX - ev.width / 2;
    const right = displayX + ev.width / 2;
    let lane = lanes.findIndex(end => left > end + labelGap);
    if (lane === -1) lane = lanes.length;
    lanes[lane] = right;

    const el = document.createElement('div');
    const t = String(ev.type || '').toLowerCase();
    el.className = `event-label ${t}`;
    el.textContent = `${getEventMark(t)}${ev.label}`;
    el.setAttribute('aria-label', ev.description || ev.label || '');
    attachEventTooltip(el, ev.description || ev.label || '');
    el.style.left = `${displayX}px`;
    el.style.top = `${lane * laneHeight}px`;
    row.appendChild(el);
  });

  row.style.height = `${Math.max(34, lanes.length * laneHeight + 4)}px`;
}

function attachEventTooltip(el, text) {
  if (!text) return;

  const show = event => {
    eventTooltip.textContent = text;
    eventTooltip.classList.add('visible');
    moveTooltip(event);
  };
  const hide = () => eventTooltip.classList.remove('visible');

  el.addEventListener('mouseenter', show);
  el.addEventListener('mousemove', moveTooltip);
  el.addEventListener('mouseleave', hide);
  el.addEventListener('focus', show);
  el.addEventListener('blur', hide);
}

function moveTooltip(event) {
  const margin = 10;
  const offset = 14;
  const rect = eventTooltip.getBoundingClientRect();
  const pointerX = event.clientX ?? event.target.getBoundingClientRect().left;
  const pointerY = event.clientY ?? event.target.getBoundingClientRect().top;
  const left = Math.min(pointerX + offset, window.innerWidth - rect.width - margin);
  const top = Math.min(pointerY + offset, window.innerHeight - rect.height - margin);

  eventTooltip.style.left = `${Math.max(margin, left)}px`;
  eventTooltip.style.top = `${Math.max(margin, top)}px`;
}

function getEventMark(type) {
  if (type === 'added') return '➕';
  if (type === 'removed') return '➖';
  if (type === 'adjusted') return '';
  return '•';
}

function render() {
  const selected = getSelectedDecks();
  if (!selected.length) {
    if (state.chart) {
      state.chart.destroy();
      state.chart = null;
    }
    meta.textContent = 'デッキを選択してください';
    document.getElementById('eventRow').innerHTML = '';
    return;
  }

  const summed = sumSeries(selected, state.decks, state.dates.length);
  const dataRange = trimRange(summed, 10);
  if (!dataRange) return;
  const range = includeNeighboringEvents(dataRange, state.dates);

  const labels = state.dates.slice(range.start, range.end + 1);
  const values = summed.slice(range.start, range.end + 1);
  const visibleEvents = getVisibleEvents(labels);

  if (state.chart) state.chart.destroy();
  state.chart = new Chart(document.getElementById('chart'), {
    type: 'line',
    data: {
      labels,
      datasets: [{ label: selected.join(' + '), data: values, borderColor: '#2b6cb0', tension: 0.25 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        eventLines: { events: visibleEvents },
        tooltip: {
          callbacks: {
            label: context => `合計: ${formatPercent(context.parsed.y)}`,
            afterLabel: context => {
              const sourceIndex = range.start + context.dataIndex;
              return selected.map(name => `${name}: ${formatPercent(state.decks[name]?.[sourceIndex])}`);
            },
          },
        },
      },
      scales: {
        y: {
          title: {
            display: true,
            text: '使用率',
          },
          ticks: {
            callback: value => `${value}%`,
          },
        },
      },
    },
  });

  meta.textContent = `期間: ${labels[0]} ~ ${labels[labels.length - 1]} / 合算デッキ数: ${selected.length}`;
  renderEventLabels(labels);
}

function setupDeckOptions(names) {
  const optionsHtml = ['<option value="">（未選択）</option>', ...names.map(n => `<option value="${n}">${n}</option>`)].join('');
  deckSelects.forEach((sel, idx) => {
    sel.innerHTML = optionsHtml;
    sel.value = '';
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
