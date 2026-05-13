const CSV_PATHS = { ND: './usage_matrix_nd.csv', AD: './usage_matrix_ad.csv' };
let state = { fmt: 'ND', dates: [], decks: {}, chart: null, events: [], report: null, sourceCsvs: {}, sourceEventsJson: '' };
const selectIds = ['deck1', 'deck2', 'deck3', 'deck4', 'deck5'];
const deckSelects = selectIds.map(id => document.getElementById(id));
const meta = document.getElementById('meta');
const reportButtons = {
  sources: document.getElementById('exportSources'),
  chart: document.getElementById('exportChart'),
};
const imagePreview = document.getElementById('imagePreview');
const previewImage = document.getElementById('previewImage');
const closeImagePreviewButton = document.getElementById('closeImagePreview');
let previewImageUrl = '';
const REPORT_IMAGE_WIDTH = 1200;
const REPORT_CHART_HEIGHT = 620;
const REPORT_EVENT_GAP = 8;
const REPORT_IMAGE_HEIGHT = 720;
const CHART_POINT_RADIUS = 2;
const CHART_POINT_HOVER_RADIUS = 4;
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

function updateReportButtons(hasChart) {
  const hasSources = Boolean(state.sourceCsvs.ND && state.sourceCsvs.AD && state.sourceEventsJson);
  if (reportButtons.sources) reportButtons.sources.disabled = !hasSources;
  if (reportButtons.chart) {
    reportButtons.chart.disabled = !hasChart;
    reportButtons.chart.hidden = !hasChart;
  }
  if (!hasChart) closeImagePreview();
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function createZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  files.forEach(file => {
    const nameBytes = encoder.encode(file.name);
    const contentBytes = encoder.encode(file.content);
    const crc = crc32(contentBytes);
    const localHeader = makeZipHeader(0x04034b50, nameBytes, contentBytes.length, crc);
    const centralHeader = makeZipHeader(0x02014b50, nameBytes, contentBytes.length, crc, offset);

    localParts.push(localHeader, contentBytes);
    centralParts.push(centralHeader);
    offset += localHeader.length + contentBytes.length;
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = makeZipEnd(files.length, centralSize, offset);
  return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
}

function makeZipHeader(signature, nameBytes, size, crc, offset = 0) {
  const isCentral = signature === 0x02014b50;
  const buffer = new ArrayBuffer(isCentral ? 46 + nameBytes.length : 30 + nameBytes.length);
  const view = new DataView(buffer);
  let p = 0;

  view.setUint32(p, signature, true); p += 4;
  if (isCentral) { view.setUint16(p, 20, true); p += 2; }
  view.setUint16(p, 20, true); p += 2;
  view.setUint16(p, 0x0800, true); p += 2;
  view.setUint16(p, 0, true); p += 2;
  view.setUint16(p, 0, true); p += 2;
  view.setUint16(p, 0, true); p += 2;
  view.setUint32(p, crc, true); p += 4;
  view.setUint32(p, size, true); p += 4;
  view.setUint32(p, size, true); p += 4;
  view.setUint16(p, nameBytes.length, true); p += 2;
  view.setUint16(p, 0, true); p += 2;

  if (isCentral) {
    view.setUint16(p, 0, true); p += 2;
    view.setUint16(p, 0, true); p += 2;
    view.setUint16(p, 0, true); p += 2;
    view.setUint32(p, 0, true); p += 4;
    view.setUint32(p, offset, true); p += 4;
  }

  new Uint8Array(buffer).set(nameBytes, p);
  return new Uint8Array(buffer);
}

function makeZipEnd(fileCount, centralSize, centralOffset) {
  const buffer = new ArrayBuffer(22);
  const view = new DataView(buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, fileCount, true);
  view.setUint16(10, fileCount, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  return new Uint8Array(buffer);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  bytes.forEach(byte => {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  });
  return (crc ^ 0xffffffff) >>> 0;
}

function getReportBaseName() {
  if (!state.report) return `deck_usage_${state.fmt}`;
  const selectedPart = state.report.selected.map(name => name.replace(/[\\/:*?"<>|]/g, '_')).join('_');
  return `deck_usage_${state.fmt}_${selectedPart || 'none'}_${state.report.labels[0]}_${state.report.labels.at(-1)}`.replaceAll('/', '-');
}

function exportSourcesZip() {
  const hasSources = state.sourceCsvs.ND && state.sourceCsvs.AD && state.sourceEventsJson;
  if (!hasSources) return;

  const zip = createZip([
    { name: 'usage_matrix_nd.csv', content: state.sourceCsvs.ND },
    { name: 'usage_matrix_ad.csv', content: state.sourceCsvs.AD },
    { name: 'events.json', content: state.sourceEventsJson },
  ]);
  downloadFile('deck_usage_source_data.zip', zip, 'application/zip');
}

async function showChartImage() {
  if (!state.chart || !state.report) return;

  const canvas = await buildReportCanvas();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob || !previewImage || !imagePreview) return;

  if (previewImageUrl) URL.revokeObjectURL(previewImageUrl);
  previewImageUrl = URL.createObjectURL(blob);
  previewImage.src = previewImageUrl;
  previewImage.alt = `${getReportBaseName()}_chart`;
  imagePreview.classList.add('visible');
  imagePreview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeImagePreview() {
  if (!imagePreview || !previewImage) return;

  imagePreview.classList.remove('visible');
  previewImage.removeAttribute('src');
  if (previewImageUrl) {
    URL.revokeObjectURL(previewImageUrl);
    previewImageUrl = '';
  }
}

async function buildReportCanvas() {
  const scale = Math.max(1, window.devicePixelRatio || 1);
  const out = document.createElement('canvas');
  out.width = REPORT_IMAGE_WIDTH * scale;
  out.height = REPORT_IMAGE_HEIGHT * scale;
  const ctx = out.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, REPORT_IMAGE_WIDTH, REPORT_IMAGE_HEIGHT);

  const chartCanvas = document.createElement('canvas');
  chartCanvas.style.width = `${REPORT_IMAGE_WIDTH}px`;
  chartCanvas.style.height = `${REPORT_CHART_HEIGHT}px`;
  chartCanvas.width = REPORT_IMAGE_WIDTH;
  chartCanvas.height = REPORT_CHART_HEIGHT;

  const report = state.report;
  const exportChart = new Chart(chartCanvas, {
    type: 'line',
    data: {
      labels: report.labels,
      datasets: [{
        label: report.selected.join(' + '),
        data: report.values,
        borderColor: '#2b6cb0',
        pointRadius: CHART_POINT_RADIUS,
        pointHoverRadius: CHART_POINT_HOVER_RADIUS,
        tension: 0.25,
      }],
    },
    options: {
      animation: false,
      responsive: false,
      maintainAspectRatio: false,
      devicePixelRatio: scale,
      plugins: {
        eventLines: { events: report.visibleEvents },
        legend: {
          onClick: null,
        },
        tooltip: {
          enabled: false,
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

  exportChart.update('none');
  ctx.drawImage(chartCanvas, 0, 0, REPORT_IMAGE_WIDTH, REPORT_CHART_HEIGHT);
  renderReportEventLabels(ctx, exportChart, report.visibleEvents, REPORT_CHART_HEIGHT + REPORT_EVENT_GAP, REPORT_IMAGE_WIDTH);
  exportChart.destroy();

  return out;
}

function renderReportEventLabels(ctx, chart, events, yOffset, rowWidth) {
  const datasetMeta = chart.getDatasetMeta(0);
  const lanes = [];
  const labelGap = 8;
  const laneHeight = 20;
  const rowPadding = 8;
  const font = '12px system-ui, sans-serif';
  ctx.font = font;

  const labels = events.map(ev => {
    const x = datasetMeta.data[ev.index]?.x;
    const text = `${getEventMark(String(ev.type || '').toLowerCase())}${ev.label}`;
    return {
      ...ev,
      x,
      text,
      width: Math.min(140, Math.max(34, ctx.measureText(text).width + 18)),
    };
  }).filter(ev => Number.isFinite(ev.x)).sort((a, b) => a.x - b.x);

  labels.forEach(ev => {
    const type = String(ev.type || '').toLowerCase();
    const colors = getEventLabelColors(type);
    const displayX = Math.min(Math.max(ev.x, ev.width / 2 + rowPadding), rowWidth - ev.width / 2 - rowPadding);
    const left = displayX - ev.width / 2;
    const right = displayX + ev.width / 2;
    let lane = lanes.findIndex(end => left > end + labelGap);
    if (lane === -1) lane = lanes.length;
    lanes[lane] = right;

    const x = displayX - ev.width / 2;
    const y = yOffset + lane * laneHeight;
    const height = 16;

    drawRoundedRect(ctx, x, y, ev.width, height, 4, colors.background, colors.border);
    ctx.fillStyle = colors.text;
    ctx.font = font;
    ctx.textBaseline = 'middle';
    ctx.fillText(ev.text, x + 6, y + height / 2, ev.width - 12);
  });
}

function getEventLabelColors(type) {
  if (type === 'added') return { background: '#e6fffa', text: '#1f6f5d', border: '#81e6d9' };
  if (type === 'removed') return { background: '#fffaf0', text: '#9c4221', border: '#f6ad55' };
  if (type === 'adjusted') return { background: '#ebf8ff', text: '#2c5282', border: '#90cdf4' };
  return { background: '#f7fafc', text: '#4a5568', border: '#cbd5e0' };
}

function drawRoundedRect(ctx, x, y, width, height, radius, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

function render() {
  closeImagePreview();
  const selected = getSelectedDecks();
  if (!selected.length) {
    if (state.chart) {
      state.chart.destroy();
      state.chart = null;
    }
    meta.textContent = 'デッキを選択してください';
    document.getElementById('eventRow').innerHTML = '';
    state.report = null;
    updateReportButtons(false);
    return;
  }

  const summed = sumSeries(selected, state.decks, state.dates.length);
  const dataRange = trimRange(summed, 10);
  if (!dataRange) {
    if (state.chart) {
      state.chart.destroy();
      state.chart = null;
    }
    meta.textContent = '表示できる使用率データがありません';
    document.getElementById('eventRow').innerHTML = '';
    state.report = null;
    updateReportButtons(false);
    return;
  }
  const range = includeNeighboringEvents(dataRange, state.dates);

  const labels = state.dates.slice(range.start, range.end + 1);
  const values = summed.slice(range.start, range.end + 1);
  const visibleEvents = getVisibleEvents(labels);
  state.report = { selected, range, labels, values, visibleEvents };

  if (state.chart) state.chart.destroy();
  state.chart = new Chart(document.getElementById('chart'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: selected.join(' + '),
        data: values,
        borderColor: '#2b6cb0',
        pointRadius: CHART_POINT_RADIUS,
        pointHoverRadius: CHART_POINT_HOVER_RADIUS,
        tension: 0.25,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        eventLines: { events: visibleEvents },
        legend: {
          onClick: null,
        },
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
  updateReportButtons(true);
}

function setupDeckOptions(names) {
  const optionsHtml = ['<option value="">（未選択）</option>', ...names.map(n => `<option value="${n}">${n}</option>`)].join('');
  deckSelects.forEach((sel, idx) => {
    sel.innerHTML = optionsHtml;
    sel.value = '';
  });
}

async function loadCsv() {
  const csv = state.sourceCsvs[state.fmt] || await fetch(CSV_PATHS[state.fmt]).then(r => r.text());
  state.sourceCsvs[state.fmt] = csv;
  updateReportButtons(Boolean(state.chart && state.report));
  const parsed = parseCsv(csv);
  state.dates = parsed.dates;
  state.decks = parsed.decks;
  const names = Object.keys(parsed.decks).sort();
  setupDeckOptions(names);
  render();
}

async function init() {
  const [ndCsv, adCsv, eventsJson] = await Promise.all([
    fetch(CSV_PATHS.ND).then(r => r.text()),
    fetch(CSV_PATHS.AD).then(r => r.text()),
    fetch('./events.json').then(r => r.text()),
  ]);
  state.sourceCsvs = { ND: ndCsv, AD: adCsv };
  state.sourceEventsJson = eventsJson;
  const ev = JSON.parse(state.sourceEventsJson);
  state.events = ev.events || [];

  document.querySelectorAll('input[name="fmt"]').forEach(r => {
    r.addEventListener('change', async e => {
      state.fmt = e.target.value;
      await loadCsv();
    });
  });

  deckSelects.forEach(sel => sel.addEventListener('change', render));
  reportButtons.sources?.addEventListener('click', exportSourcesZip);
  reportButtons.chart?.addEventListener('click', showChartImage);
  closeImagePreviewButton?.addEventListener('click', closeImagePreview);
  updateReportButtons(false);
  await loadCsv();
}

init();
