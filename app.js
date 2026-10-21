// ================================================
//  HeartMate — Blood Pressure Tracker
//  app.js — Core Application Logic
// ================================================

'use strict';

// ---- CONSTANTS & CONFIG ----
const STORAGE_KEY = 'heartmate_readings_v2';
const CLINICAL_STATUS_STORAGE_KEY = 'heartmate_show_clinical_status';
const SLOTS = ['morning', 'afternoon', 'evening'];

// Global clinical status visibility state (defaults to true)
let isClinicalStatusVisible = localStorage.getItem(CLINICAL_STATUS_STORAGE_KEY) !== 'false';

const SLOT_CONFIG = {
  morning:   { icon: '🌅', label: 'Morning',   defaultTime: '08:00' },
  afternoon: { icon: '☀️', label: 'Afternoon', defaultTime: '14:00' },
  evening:   { icon: '🌙', label: 'Evening',   defaultTime: '20:00' }
};

const BP_THRESHOLDS = {
  low:      { sys: 90,  dia: 60  },
  normal:   { sys: 120, dia: 80  },
  elevated: { sys: 130, dia: 80  },
  high:     { sys: 140, dia: 90  }
};

// Chart instances
let chartInstances = {};
let receiptChartInstance = null;

// Global Chart.js performance defaults (debounced canvas resizing, prevent UI lag)
if (typeof Chart !== 'undefined') {
  Chart.defaults.responsive = true;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.resizeDelay = 200; // Built-in debounce for chart canvas resizing
}

// Current calendar month/year
let calYear, calMonth;

// ================================================
//  INIT
// ================================================
document.addEventListener('DOMContentLoaded', () => {
  const today = getTodayString();
  document.getElementById('logDate').value = today;

  // Default times per slot
  document.getElementById('morn-time').value = '08:00';
  document.getElementById('aft-time').value  = '14:00';
  document.getElementById('eve-time').value  = '20:00';

  loadLogForDate();
  setupInputListeners();
  setupSaveBtnRipple();
  initTheme();
  syncClinicalStatusToggles(isClinicalStatusVisible);

  // Keyboard shortcut: Ctrl+S to save
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (document.getElementById('page-log').classList.contains('active')) {
        saveReadings();
      }
    }
  });

  const now = new Date();
  calYear  = now.getFullYear();
  calMonth = now.getMonth();

  seedDemoData();
});

// ================================================
//  NAVIGATION
// ================================================
function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));

  document.getElementById(`page-${page}`).classList.add('active');
  document.getElementById(`tab-${page}`).classList.add('active');

  if (page === 'calendar') renderCalendar();
  if (page === 'analytics') renderAnalytics();
  if (page === 'report') {
    if (typeof reportActiveSubPage !== 'undefined' && reportActiveSubPage === 'invoice') {
      if (typeof initInvoiceDefaults === 'function' && !isInvoiceInitialized) {
        initInvoiceDefaults();
      } else if (typeof renderBillingInvoice === 'function') {
        renderBillingInvoice();
      }
    } else {
      renderReportPad();
    }
  }
}

function toggleMobileMenu() {
  const menu = document.getElementById('mobileMenu');
  menu.classList.toggle('open');
}

// ================================================
//  LOCAL STORAGE HELPERS
// ================================================
function getAll() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch { return {}; }
}

function saveAll(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function getTodayString() {
  const d = new Date();
  return formatDateKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function formatDateKey(y, m, d) {
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

// ================================================
//  DAILY LOG — LOAD
// ================================================
function loadLogForDate() {
  const dateKey = document.getElementById('logDate').value;
  const all = getAll();
  const dayData = all[dateKey] || {};

  SLOTS.forEach(slot => {
    const prefix = slot === 'morning' ? 'morn' : slot === 'afternoon' ? 'aft' : 'eve';
    const data   = dayData[slot] || {};

    document.getElementById(`${prefix}-sys`).value   = data.sys   || '';
    document.getElementById(`${prefix}-dia`).value   = data.dia   || '';
    document.getElementById(`${prefix}-pulse`).value = data.pulse || '';
    document.getElementById(`${prefix}-time`).value  = data.time  || SLOT_CONFIG[slot].defaultTime;

    updateStatusBadge(slot);
    updateDot(slot);
  });
}

// ================================================
//  DAILY LOG — SAVE
// ================================================
function saveReadings() {
  const dateKey = document.getElementById('logDate').value;
  if (!dateKey) {
    showToast('⚠️ Please select a date first.', 'error');
    return;
  }

  const all = getAll();
  if (!all[dateKey]) all[dateKey] = {};

  let saved = 0;
  let deleted = 0;

  const fields = {
    morning:   { prefix: 'morn' },
    afternoon: { prefix: 'aft'  },
    evening:   { prefix: 'eve'  }
  };

  SLOTS.forEach(slot => {
    const { prefix } = fields[slot];
    const sysVal   = document.getElementById(`${prefix}-sys`).value.trim();
    const diaVal   = document.getElementById(`${prefix}-dia`).value.trim();
    const pulseVal = document.getElementById(`${prefix}-pulse`).value.trim();
    const timeVal  = document.getElementById(`${prefix}-time`).value.trim();

    const sys   = parseFloat(sysVal);
    const dia   = parseFloat(diaVal);
    const pulse = parseFloat(pulseVal);
    const time  = timeVal || SLOT_CONFIG[slot].defaultTime;

    if (!isNaN(sys) && !isNaN(dia)) {
      all[dateKey][slot] = { sys, dia, pulse: isNaN(pulse) ? null : pulse, time };
      saved++;
    } else {
      if (all[dateKey] && all[dateKey][slot]) {
        delete all[dateKey][slot];
        deleted++;
      }
    }
  });

  if (saved === 0 && deleted === 0) {
    showToast('⚠️ Please fill in at least one reading.', 'error');
    return;
  }

  if (Object.keys(all[dateKey]).length === 0) {
    delete all[dateKey];
  }

  saveAll(all);
  SLOTS.forEach(slot => { updateStatusBadge(slot); updateDot(slot); });
  animateSaveBtn();

  if (saved > 0) {
    showToast(`✅ ${saved} reading${saved > 1 ? 's' : ''} saved for ${formatDisplayDate(dateKey)}!`, 'success');
  } else if (deleted > 0) {
    showToast(`🗑️ Reading cleared for ${formatDisplayDate(dateKey)}.`, 'info');
  }

  // Performance: Only update graphs/DOM when officially saved or deleted, and only if view is active
  if (document.getElementById('page-analytics')?.classList.contains('active')) {
    renderAnalytics();
  }
  if (chartFsInstance && currentFullscreenType) {
    switchFullscreenType(currentFullscreenType);
  }
  if (document.getElementById('page-calendar')?.classList.contains('active')) {
    renderCalendar();
  }
  if (document.getElementById('page-report')?.classList.contains('active')) {
    if (typeof reportActiveSubPage !== 'undefined' && reportActiveSubPage === 'invoice') {
      if (typeof renderBillingInvoice === 'function') renderBillingInvoice();
    } else {
      renderReportPad();
    }
  }
}

function animateSaveBtn() {
  const btn = document.getElementById('saveBtn');
  btn.style.background = 'linear-gradient(135deg, #3DB891, #2090C4)';
  btn.style.transform = 'scale(0.97)';
  setTimeout(() => {
    btn.style.background = 'linear-gradient(135deg, var(--blue-400), var(--green-400))';
    btn.style.transform = 'scale(1)';
  }, 600);
}

function setupSaveBtnRipple() {
  const btn = document.getElementById('saveBtn');
  btn.addEventListener('click', function(e) {
    const ripple = document.createElement('span');
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;
    ripple.style.cssText = `
      position: absolute;
      border-radius: 50%;
      background: rgba(255,255,255,0.35);
      width: ${size}px;
      height: ${size}px;
      left: ${e.clientX - rect.left - size/2}px;
      top: ${e.clientY - rect.top - size/2}px;
      transform: scale(0);
      animation: ripple-anim 0.6s linear;
      pointer-events: none;
    `;
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 650);
  });
}

// ================================================
//  STATUS LOGIC
// ================================================
function classifyBP(sys, dia) {
  if (!sys || !dia) return null;
  if (sys < 90 || dia < 60)    return 'low';
  if (sys < 120 && dia < 80)   return 'normal';
  if (sys < 130 && dia < 80)   return 'elevated';
  return 'high';
}

const STATUS_LABELS = {
  low:      '🔵 Low',
  normal:   '✅ Normal',
  elevated: '🟡 Elevated',
  high:     '🔴 High',
};

function updateStatusBadge(slot) {
  const prefix = slot === 'morning' ? 'morn' : slot === 'afternoon' ? 'aft' : 'eve';
  const sys = parseFloat(document.getElementById(`${prefix}-sys`).value);
  const dia = parseFloat(document.getElementById(`${prefix}-dia`).value);
  const badge = document.getElementById(`status-${slot}`);
  if (!badge) return;

  if (!isClinicalStatusVisible) {
    badge.style.display = 'none';
    return;
  }

  const category = classifyBP(sys, dia);
  badge.className = 'bp-status-badge';
  if (category) {
    badge.style.display = 'inline-flex';
    badge.classList.add(`status-${category}`);
    badge.textContent = STATUS_LABELS[category];
  } else {
    badge.style.display = 'none';
  }
}

function updateDot(slot) {
  const prefix = slot === 'morning' ? 'morn' : slot === 'afternoon' ? 'aft' : 'eve';
  const sys = document.getElementById(`${prefix}-sys`).value;
  const dia = document.getElementById(`${prefix}-dia`).value;
  const dot = document.getElementById(`dot-${slot}`);
  dot.classList.toggle('filled', !!(sys && dia));
}

function setupInputListeners() {
  SLOTS.forEach(slot => {
    const prefix = slot === 'morning' ? 'morn' : slot === 'afternoon' ? 'aft' : 'eve';
    ['sys', 'dia', 'pulse'].forEach(field => {
      document.getElementById(`${prefix}-${field}`).addEventListener('input', () => {
        updateStatusBadge(slot);
        updateDot(slot);
      });
    });
  });
}

// ================================================
//  TOAST
// ================================================
function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3500);
}

// ================================================
//  DATE HELPERS
// ================================================
function formatDisplayDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
}

// ================================================
//  CALENDAR
// ================================================
function renderCalendar() {
  const titleEl = document.getElementById('calMonthTitle');
  const gridEl  = document.getElementById('calendarGrid');
  const all = getAll();

  const monthName = new Date(calYear, calMonth, 1)
    .toLocaleString('en-US', { month: 'long', year: 'numeric' });
  titleEl.textContent = monthName;

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const daysInPrev  = new Date(calYear, calMonth, 0).getDate();

  const today = getTodayString();
  gridEl.innerHTML = '';

  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  for (let i = 0; i < totalCells; i++) {
    const cell = document.createElement('div');
    cell.className = 'cal-day';

    let dayNum, dateKey, isOtherMonth = false;

    if (i < firstDay) {
      dayNum = daysInPrev - firstDay + i + 1;
      const prevMonth = calMonth === 0 ? 12 : calMonth;
      const prevYear  = calMonth === 0 ? calYear - 1 : calYear;
      dateKey = formatDateKey(prevYear, prevMonth, dayNum);
      isOtherMonth = true;
    } else if (i >= firstDay + daysInMonth) {
      dayNum = i - firstDay - daysInMonth + 1;
      const nextMonth = calMonth === 11 ? 1 : calMonth + 2;
      const nextYear  = calMonth === 11 ? calYear + 1 : calYear;
      dateKey = formatDateKey(nextYear, nextMonth, dayNum);
      isOtherMonth = true;
    } else {
      dayNum = i - firstDay + 1;
      dateKey = formatDateKey(calYear, calMonth + 1, dayNum);
    }

    const dayData = all[dateKey] || {};
    const count = SLOTS.filter(s => dayData[s]?.sys).length;

    const numEl = document.createElement('div');
    numEl.className = 'cal-day-num';
    numEl.textContent = dayNum;

    const dotEl = document.createElement('div');
    dotEl.className = 'cal-indicator';
    if (count === 3) dotEl.classList.add('full');
    else if (count > 0) dotEl.classList.add('partial');

    cell.appendChild(numEl);
    cell.appendChild(dotEl);

    if (isOtherMonth) cell.classList.add('other-month');
    if (dateKey === today) cell.classList.add('today');

    if (!isOtherMonth) {
      cell.addEventListener('click', () => openDayModal(dateKey, dayData));
    }

    gridEl.appendChild(cell);
  }
}

function changeMonth(dir) {
  calMonth += dir;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0)  { calMonth = 11; calYear--; }
  renderCalendar();
}

// ================================================
//  DAY DETAIL MODAL
// ================================================
function openDayModal(dateKey, dayData) {
  document.getElementById('modalDateBadge').textContent = '📅 ' + formatDisplayDate(dateKey);
  document.getElementById('modalTitle').textContent = 'Blood Pressure Readings';
  document.getElementById('modalOverlay').classList.add('open');

  const body = document.getElementById('modalBody');
  body.innerHTML = '';

  SLOTS.forEach(slot => {
    const cfg  = SLOT_CONFIG[slot];
    const data = dayData[slot];
    const row  = document.createElement('div');
    row.className = 'modal-reading-row';

    row.innerHTML = `
      <div class="modal-slot-icon">${cfg.icon}</div>
      <div>
        <div class="modal-slot-label">${cfg.label}</div>
        ${data?.time ? `<div class="modal-slot-time">⏰ ${data.time}</div>` : ''}
      </div>
      ${data?.sys
        ? `<div class="modal-readings-vals">
            <div class="modal-val-chip chip-sys" title="Systolic">🩸 ${data.sys} mmHg</div>
            <div class="modal-val-chip chip-dia" title="Diastolic">💧 ${data.dia} mmHg</div>
            ${data.pulse ? `<div class="modal-val-chip chip-pulse" title="Pulse">💓 ${data.pulse} BPM</div>` : ''}
           </div>`
        : `<div class="modal-no-reading">No reading logged</div>`
      }
    `;

    if (data?.sys) {
      const cat = classifyBP(data.sys, data.dia);
      row.style.borderLeftColor = cat === 'normal' ? 'var(--green-400)'
        : cat === 'elevated' ? 'var(--yellow-300)'
        : cat === 'high' ? 'var(--coral-400)'
        : cat === 'low' ? 'var(--purple-300)'
        : 'var(--blue-300)';
    }

    body.appendChild(row);
  });
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
}

// ================================================
//  ANALYTICS
// ================================================
function renderAnalytics() {
  const days = parseInt(document.getElementById('analyticsTimeframe').value);
  const all  = getAll();
  const dataPoints = collectDataPoints(all, days);

  if (dataPoints.length === 0) {
    document.getElementById('noDataPlaceholder').style.display = 'block';
    document.getElementById('summaryCards').style.opacity = '0.3';
    ['chartSys','chartDia','chartPulse','chartCombined'].forEach(id => {
      const c = document.getElementById(id);
      if (chartInstances[id]) {
        try { chartInstances[id].destroy(); } catch (e) {}
        delete chartInstances[id];
      }
      if (c && typeof Chart !== 'undefined') {
        const existing = Chart.getChart(c);
        if (existing) {
          try { existing.destroy(); } catch (e) {}
        }
      }
    });
    updateSummaryCards([], []);
    return;
  }

  document.getElementById('noDataPlaceholder').style.display = 'none';
  document.getElementById('summaryCards').style.opacity = '1';

  updateSummaryCards(dataPoints, days);
  renderCharts(dataPoints);
}

function collectDataPoints(all, days) {
  const points = [];
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = formatDateKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
    const dayData = all[key];
    if (!dayData) continue;

    SLOTS.forEach(slot => {
      const r = dayData[slot];
      if (r?.sys && r?.dia) {
        points.push({
          dateKey: key,
          date: new Date(key),
          slot,
          sys: r.sys,
          dia: r.dia,
          pulse: r.pulse,
          time: r.time
        });
      }
    });
  }

  return points;
}

function updateSummaryCards(points, days) {
  if (points.length === 0) {
    ['avg-sys','avg-dia','avg-pulse','days-logged'].forEach(id => {
      document.getElementById(id).textContent = '—';
    });
    ['tag-sys','tag-dia','tag-pulse','tag-days'].forEach(id => {
      document.getElementById(id).textContent = '';
      document.getElementById(id).className = 'summary-tag';
    });
    return;
  }

  const avgSys   = avg(points.map(p => p.sys));
  const avgDia   = avg(points.map(p => p.dia));
  const pulsePts = points.filter(p => p.pulse);
  const avgPulse = pulsePts.length ? avg(pulsePts.map(p => p.pulse)) : null;

  const uniqueDays = new Set(points.map(p => p.dateKey)).size;

  document.getElementById('avg-sys').textContent   = Math.round(avgSys);
  document.getElementById('avg-dia').textContent   = Math.round(avgDia);
  document.getElementById('avg-pulse').textContent = avgPulse ? Math.round(avgPulse) : '—';
  document.getElementById('days-logged').textContent = uniqueDays;

  const sysCat = classifyBP(avgSys, avgDia);
  setTag('tag-sys',   isClinicalStatusVisible ? sysCat : null);
  setTag('tag-dia',   isClinicalStatusVisible ? sysCat : null);
  setTag('tag-pulse', isClinicalStatusVisible ? (avgPulse ? (avgPulse < 60 ? 'low' : avgPulse <= 100 ? 'normal' : 'high') : null) : null);

  const coverage = Math.round((uniqueDays / days) * 100);
  const daysTag = document.getElementById('tag-days');
  daysTag.textContent = `${coverage}% consistency`;
  daysTag.className = `summary-tag ${coverage >= 80 ? 'tag-normal' : coverage >= 50 ? 'tag-elevated' : 'tag-high'}`;
}

function setTag(id, category) {
  const el = document.getElementById(id);
  if (!category) { el.textContent = ''; el.className = 'summary-tag'; return; }
  const labels = { low: '🔵 Low', normal: '✅ Normal', elevated: '🟡 Elevated', high: '🔴 High' };
  el.textContent = labels[category] || '';
  el.className = `summary-tag tag-${category}`;
}

function avg(arr) {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

// ================================================
//  INTERACTIVE SELECTION & HIGHLIGHTING STATE
// ================================================
let currentSelectedDateKey = null;
let currentFullscreenType = 'combined';

// Custom Chart.js Plugin: Vertical semi-transparent pastel date overlay
const dayHighlightPlugin = {
  id: 'dayHighlight',
  beforeDatasetsDraw(chart, args, options) {
    if (!currentSelectedDateKey) return;
    const { ctx, chartArea, scales: { x } } = chart;
    if (!x || !chartArea) return;

    const points = chart._heartmatePoints;
    if (!points || !points.length) return;

    // Find indices matching the selected date
    const matchingIndices = [];
    points.forEach((p, idx) => {
      if (p.dateKey === currentSelectedDateKey) {
        matchingIndices.push(idx);
      }
    });

    if (matchingIndices.length === 0) return;

    const firstIdx = matchingIndices[0];
    const lastIdx  = matchingIndices[matchingIndices.length - 1];

    const xFirst = x.getPixelForValue(firstIdx);
    const xLast  = x.getPixelForValue(lastIdx);

    // Calculate half step to encapsulate the reading points nicely
    let halfStep = 18;
    if (points.length > 1) {
      const step = Math.abs(x.getPixelForValue(1) - x.getPixelForValue(0));
      halfStep = Math.max(14, step / 2);
    } else {
      halfStep = 32;
    }

    const left   = Math.max(chartArea.left, xFirst - halfStep);
    const right  = Math.min(chartArea.right, xLast + halfStep);
    const width  = Math.max(2, right - left);
    const top    = chartArea.top;
    const height = chartArea.bottom - chartArea.top;

    ctx.save();

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    // 1. Vertical semi-transparent highlight overlay (18% opacity soft pastel)
    ctx.fillStyle = isDark ? 'rgba(98, 207, 238, 0.18)' : 'rgba(74, 172, 218, 0.18)';
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(left, top, width, height, [6, 6, 6, 6]);
      ctx.fill();
    } else {
      ctx.fillRect(left, top, width, height);
    }

    // 2. Vertical pastel borders on left and right
    ctx.strokeStyle = isDark ? 'rgba(98, 207, 238, 0.65)' : 'rgba(74, 172, 218, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);

    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left, chartArea.bottom);
    ctx.moveTo(right, top);
    ctx.lineTo(right, chartArea.bottom);
    ctx.stroke();

    // 3. Floating pill header badge
    ctx.setLineDash([]);
    const count = matchingIndices.length;
    const pillText = `🎯 ${count} reading${count > 1 ? 's' : ''}`;
    ctx.font = '700 10px Inter, sans-serif';
    const textMetrics = ctx.measureText(pillText);
    const pillW = textMetrics.width + 14;
    const pillH = 18;
    const pillX = Math.max(chartArea.left + 2, Math.min(chartArea.right - pillW - 2, left + (width - pillW) / 2));
    const pillY = top + 6;

    ctx.fillStyle = isDark ? 'rgba(28, 37, 57, 0.92)' : 'rgba(255, 255, 255, 0.95)';
    ctx.strokeStyle = isDark ? 'rgba(98, 207, 238, 0.45)' : 'rgba(74, 172, 218, 0.45)';
    ctx.lineWidth = 1;

    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(pillX, pillY, pillW, pillH, 9);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(pillX, pillY, pillW, pillH);
      ctx.strokeRect(pillX, pillY, pillW, pillH);
    }

    ctx.fillStyle = isDark ? '#62CFEE' : '#2090C4';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pillText, pillX + pillW / 2, pillY + pillH / 2 + 0.5);

    ctx.restore();
  }
};

// Custom Chart.js Plugin: Medical clinical reference guide lines for clarity
const referenceLinesPlugin = {
  id: 'referenceLines',
  beforeDatasetsDraw(chart) {
    const metricType = chart._metricType;
    if (!metricType || metricType === 'combined') return;

    const { ctx, chartArea, scales: { y } } = chart;
    if (!y || !chartArea) return;

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    const drawGuideLine = (value, label, color) => {
      if (value < y.min || value > y.max) return;
      const yPixel = y.getPixelForValue(value);

      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 4]);

      ctx.beginPath();
      ctx.moveTo(chartArea.left, yPixel);
      ctx.lineTo(chartArea.right, yPixel);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.font = '600 10px Inter, sans-serif';
      ctx.fillStyle = color;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, chartArea.right - 4, yPixel - 3);

      ctx.restore();
    };

    if (metricType === 'sys') {
      drawGuideLine(120, 'Normal: 120', isDark ? 'rgba(63, 237, 182, 0.65)' : 'rgba(31, 153, 114, 0.65)');
      drawGuideLine(140, 'High: 140', isDark ? 'rgba(255, 123, 97, 0.6)' : 'rgba(232, 93, 66, 0.6)');
    } else if (metricType === 'dia') {
      drawGuideLine(80, 'Normal: 80', isDark ? 'rgba(63, 237, 182, 0.65)' : 'rgba(31, 153, 114, 0.65)');
      drawGuideLine(90, 'High: 90', isDark ? 'rgba(255, 123, 97, 0.6)' : 'rgba(232, 93, 66, 0.6)');
    } else if (metricType === 'pulse') {
      drawGuideLine(60, 'Low: 60', isDark ? 'rgba(98, 207, 238, 0.55)' : 'rgba(74, 172, 218, 0.55)');
      drawGuideLine(100, 'Resting Max: 100', isDark ? 'rgba(255, 216, 74, 0.65)' : 'rgba(180, 130, 20, 0.65)');
    }
  }
};

// ================================================
//  CROSS-LINKING & SELECTION HANDLERS
// ================================================
function handleChartClick(event, elements, chart) {
  const points = chart._heartmatePoints;
  if (!points || !points.length) return;

  if (elements && elements.length > 0) {
    const idx = elements[0].index;
    const pt = points[idx];
    if (pt?.dateKey) {
      if (currentSelectedDateKey === pt.dateKey) {
        selectDateHighlight(null);
      } else {
        selectDateHighlight(pt.dateKey);
      }
      return;
    }
  }

  // If clicked within a day column
  const xPixel = event.x;
  const xScale = chart.scales.x;
  if (xScale) {
    let closestIdx = -1;
    let minDiff = Infinity;
    points.forEach((p, idx) => {
      const px = xScale.getPixelForValue(idx);
      const diff = Math.abs(px - xPixel);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = idx;
      }
    });
    if (closestIdx !== -1 && minDiff < 45) {
      const pt = points[closestIdx];
      if (pt?.dateKey) {
        if (currentSelectedDateKey === pt.dateKey) {
          selectDateHighlight(null);
        } else {
          selectDateHighlight(pt.dateKey);
        }
      }
    }
  }
}

function selectDateHighlight(dateKey) {
  currentSelectedDateKey = dateKey;

  // 1. Update analytics date picker input
  const picker = document.getElementById('analyticsDatePicker');
  if (picker) {
    picker.value = dateKey || '';
  }

  // 2. Render / update the Day Focus Banner on dashboard
  updateDayFocusBanner(dateKey);

  // 3. Update the Fullscreen focus strip if open
  updateFullscreenFocusStrip(dateKey);

  // 4. Update all dashboard charts simultaneously
  Object.values(chartInstances).forEach(chart => {
    if (chart) chart.update('none');
  });

  // 5. Update fullscreen chart if open
  if (chartFsInstance) {
    chartFsInstance.update('none');
  }
}

function handleAnalyticsDatePick(val) {
  if (!val) {
    selectDateHighlight(null);
    return;
  }
  selectDateHighlight(val);
}

function handleTimeframeChange() {
  renderAnalytics();
}

function jumpToDateLog() {
  if (!currentSelectedDateKey) return;
  document.getElementById('logDate').value = currentSelectedDateKey;
  navigateTo('log');
  loadLogForDate();
  showToast(`📅 Loaded readings for ${formatDisplayDate(currentSelectedDateKey)}`, 'info');
}

function updateDayFocusBanner(dateKey) {
  const banner = document.getElementById('dayFocusBanner');
  if (!banner) return;

  if (!dateKey) {
    banner.style.display = 'none';
    return;
  }

  const all = getAll();
  const dayData = all[dateKey] || {};
  const dateObj = new Date(dateKey + 'T00:00:00');
  const formattedDate = dateObj.toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric'
  });

  document.getElementById('dayFocusDateTitle').textContent = formattedDate;

  const filledSlots = SLOTS.filter(s => dayData[s]?.sys && dayData[s]?.dia);
  const countBadge = document.getElementById('dayFocusCountBadge');
  countBadge.textContent = `${filledSlots.length} of 3 readings recorded`;

  const bodyEl = document.getElementById('dayFocusBody');

  let cardsHtml = '<div class="day-focus-cards-grid">';
  const sysValues = [];
  const diaValues = [];
  const pulseValues = [];

  SLOTS.forEach(slot => {
    const cfg = SLOT_CONFIG[slot];
    const data = dayData[slot];
    if (data?.sys && data?.dia) {
      sysValues.push(data.sys);
      diaValues.push(data.dia);
      if (data.pulse) pulseValues.push(data.pulse);

      const cat = classifyBP(data.sys, data.dia);
      cardsHtml += `
        <div class="day-slot-card">
          <div class="day-slot-header">
            <span class="day-slot-name">${cfg.icon} ${cfg.label}</span>
            <span class="day-slot-time">⏰ ${data.time || cfg.defaultTime}</span>
          </div>
          <div class="day-slot-readings">
            <span class="day-bp-value">${data.sys}/${data.dia}</span>
            <span class="day-unit">mmHg</span>
            ${data.pulse ? `<span class="day-pulse-val">💓 ${data.pulse} BPM</span>` : ''}
          </div>
          ${isClinicalStatusVisible ? `<span class="day-slot-badge status-${cat}">${STATUS_LABELS[cat]}</span>` : ''}
        </div>
      `;
    } else {
      cardsHtml += `
        <div class="day-slot-card">
          <div class="day-slot-header">
            <span class="day-slot-name">${cfg.icon} ${cfg.label}</span>
            <span class="day-slot-time">⏰ ${cfg.defaultTime}</span>
          </div>
          <div class="day-empty-slot">No reading recorded</div>
        </div>
      `;
    }
  });
  cardsHtml += '</div>';

  if (sysValues.length > 1) {
    const minSys = Math.min(...sysValues);
    const maxSys = Math.max(...sysValues);
    const diffSys = maxSys - minSys;
    const minDia = Math.min(...diaValues);
    const maxDia = Math.max(...diaValues);
    cardsHtml += `
      <div class="day-fluctuation-insight">
        <span>📈 <strong>24-Hour Fluctuation:</strong></span>
        <span>Systolic varied by <strong>${diffSys} mmHg</strong> (range: ${minSys} – ${maxSys} mmHg)</span>
        <span>•</span>
        <span>Diastolic range: <strong>${minDia} – ${maxDia} mmHg</strong></span>
        ${pulseValues.length > 1 ? `<span>• Pulse range: <strong>${Math.min(...pulseValues)} – ${Math.max(...pulseValues)} BPM</strong></span>` : ''}
      </div>
    `;
  }

  bodyEl.innerHTML = cardsHtml;
  banner.style.display = 'block';
}

function updateFullscreenFocusStrip(dateKey) {
  const strip = document.getElementById('chartFsFocusStrip');
  const textEl = document.getElementById('chartFsFocusText');
  if (!strip || !textEl) return;

  if (!dateKey) {
    strip.style.display = 'none';
    return;
  }

  const dateObj = new Date(dateKey + 'T00:00:00');
  const formatted = dateObj.toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric'
  });
  textEl.textContent = `Highlighting: ${formatted}`;
  strip.style.display = 'flex';
}

// ================================================
//  CHARTS RENDERING
// ================================================
function renderCharts(points) {
  const labels  = points.map(p => {
    const d = new Date(p.dateKey);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      + (p.time ? ` ${p.time}` : ` (${p.slot})`);
  });

  const sysData   = points.map(p => p.sys);
  const diaData   = points.map(p => p.dia);
  const pulseData = points.map(p => p.pulse);

  // Store for fullscreen re-use
  window._chartData = { labels, sysData, diaData, pulseData, points };

  // Set min/max on date picker input
  const picker = document.getElementById('analyticsDatePicker');
  if (picker && points.length > 0) {
    picker.min = points[0].dateKey;
    picker.max = points[points.length - 1].dateKey;
    if (currentSelectedDateKey) picker.value = currentSelectedDateKey;
  }

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const gridColor = isDark ? 'rgba(98,207,238,0.07)' : 'rgba(74,172,218,0.06)';
  const tickColor = isDark ? '#556280' : '#9AABBC';

  const baseChartOptions = (unit, metricType) => ({
    responsive: true,
    maintainAspectRatio: false,
    resizeDelay: 200,
    animation: { duration: 700, easing: 'easeInOutQuart' },
    interaction: { mode: 'index', intersect: false },
    onClick: handleChartClick,
    onHover: (event, chartElement) => {
      event.native.target.style.cursor = chartElement[0] ? 'pointer' : 'default';
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: isDark ? 'rgba(15,22,40,0.96)' : 'rgba(26,35,64,0.94)',
        titleColor: '#ffffff',
        titleFont: { family: 'Nunito', weight: '800', size: 13 },
        bodyColor: isDark ? '#62CFEE' : '#C3E0F8',
        bodyFont: { family: 'Inter', size: 12 },
        padding: 14,
        cornerRadius: 12,
        borderColor: isDark ? 'rgba(98,207,238,0.25)' : 'rgba(74,172,218,0.2)',
        borderWidth: 1,
        boxPadding: 4,
        usePointStyle: true,
        callbacks: {
          title: (items) => {
            const idx = items[0].dataIndex;
            const pt = points[idx];
            if (pt) {
              const slotLabel = SLOT_CONFIG[pt.slot]?.label || pt.slot;
              const icon = SLOT_CONFIG[pt.slot]?.icon || '⏰';
              return `${icon} ${slotLabel} (${pt.time || 'Logged'}) • ${formatDisplayDate(pt.dateKey)}`;
            }
            return items[0].label;
          },
          label: (item) => {
            const idx = item.dataIndex;
            const pt = points[idx];
            const val = item.raw;
            const u = { 'Systolic': 'mmHg', 'Diastolic': 'mmHg', 'Heart Rate': 'BPM' }[item.dataset.label] || unit;
            let statusStr = '';
            if (isClinicalStatusVisible && pt && pt.sys && pt.dia) {
              const cat = classifyBP(pt.sys, pt.dia);
              if (cat) statusStr = ` [${STATUS_LABELS[cat]}]`;
            }
            return ` ${item.dataset.label}: ${val} ${u}${statusStr}`;
          },
          afterBody: (items) => {
            const idx = items[0].dataIndex;
            const pt = points[idx];
            if (pt && pt.dateKey === currentSelectedDateKey) {
              return '\n🎯 Currently isolated day';
            }
            return '\n💡 Click to isolate this day';
          }
        }
      }
    },
    scales: {
      x: {
        ticks: { font: { family: 'Inter', size: 10 }, color: tickColor, maxRotation: 45, padding: 4 },
        grid: { color: gridColor, lineWidth: 1, dash: [4, 4] }
      },
      y: {
        ticks: { font: { family: 'Inter', size: 11 }, color: tickColor, padding: 6 },
        grid: { color: gridColor, lineWidth: 1, dash: [4, 4] },
        border: { dash: [4, 4] }
      }
    }
  });

  const makeGradient = (ctx, color) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
    gradient.addColorStop(0,   hexToRgba(color, isDark ? 0.35 : 0.28));
    gradient.addColorStop(0.5, hexToRgba(color, isDark ? 0.14 : 0.10));
    gradient.addColorStop(1,   hexToRgba(color, 0));
    return gradient;
  };

  const createLineDataset = (label, data, color, fill = true, ctx = null) => ({
    label,
    data,
    borderColor: color,
    backgroundColor: (fill && ctx) ? makeGradient(ctx, color) : 'transparent',
    borderWidth: 3,
    pointRadius: (c) => {
      if (!currentSelectedDateKey) return 5;
      const pt = points[c.dataIndex];
      return (pt && pt.dateKey === currentSelectedDateKey) ? 8.5 : 3.5;
    },
    pointHoverRadius: (c) => {
      if (!currentSelectedDateKey) return 9;
      const pt = points[c.dataIndex];
      return (pt && pt.dateKey === currentSelectedDateKey) ? 12 : 7;
    },
    pointBackgroundColor: (c) => {
      if (!currentSelectedDateKey) return color;
      const pt = points[c.dataIndex];
      return (pt && pt.dateKey === currentSelectedDateKey) ? color : hexToRgba(color, 0.45);
    },
    pointBorderColor: (c) => {
      if (!currentSelectedDateKey) return isDark ? '#1C2539' : '#ffffff';
      const pt = points[c.dataIndex];
      if (pt && pt.dateKey === currentSelectedDateKey) {
        return isDark ? '#EDF2FF' : '#ffffff';
      }
      return isDark ? '#1C2539' : '#ffffff';
    },
    pointBorderWidth: (c) => {
      if (!currentSelectedDateKey) return 2.5;
      const pt = points[c.dataIndex];
      return (pt && pt.dateKey === currentSelectedDateKey) ? 3.5 : 1.5;
    },
    tension: 0.45,
    fill: fill ? 'origin' : false
  });

  buildChart('chartSys', labels, (ctx) => [
    createLineDataset('Systolic', sysData, '#FF7B61', true, ctx)
  ], baseChartOptions('mmHg', 'sys'), points, 'sys');

  buildChart('chartDia', labels, (ctx) => [
    createLineDataset('Diastolic', diaData, '#4AACDA', true, ctx)
  ], baseChartOptions('mmHg', 'dia'), points, 'dia');

  buildChart('chartPulse', labels, (ctx) => [
    createLineDataset('Heart Rate', pulseData, '#3DB891', true, ctx)
  ], baseChartOptions('BPM', 'pulse'), points, 'pulse');

  // Combined chart
  const combinedOpts = {
    ...baseChartOptions('', 'combined'),
    plugins: {
      legend: {
        display: true,
        labels: {
          font: { family: 'Nunito', weight: '700', size: 12 },
          color: isDark ? '#B8CCEE' : '#3D5280',
          usePointStyle: true,
          pointStyleWidth: 12,
          padding: 18
        }
      },
      tooltip: {
        backgroundColor: isDark ? 'rgba(15,22,40,0.96)' : 'rgba(26,35,64,0.92)',
        titleColor: '#ffffff',
        titleFont: { family: 'Nunito', weight: '800', size: 13 },
        bodyColor: isDark ? '#62CFEE' : '#C3E0F8',
        bodyFont: { family: 'Inter', size: 12 },
        padding: 16,
        cornerRadius: 14,
        borderColor: isDark ? 'rgba(98,207,238,0.25)' : 'rgba(74,172,218,0.2)',
        borderWidth: 1,
        boxPadding: 4,
        usePointStyle: true,
        callbacks: {
          title: (items) => {
            const idx = items[0].dataIndex;
            const pt = points[idx];
            if (pt) {
              const slotLabel = SLOT_CONFIG[pt.slot]?.label || pt.slot;
              const icon = SLOT_CONFIG[pt.slot]?.icon || '⏰';
              return `${icon} ${slotLabel} (${pt.time || 'Logged'}) • ${formatDisplayDate(pt.dateKey)}`;
            }
            return items[0].label;
          },
          label: (item) => {
            const idx = item.dataIndex;
            const pt = points[idx];
            const units = { 'Systolic': 'mmHg', 'Diastolic': 'mmHg', 'Heart Rate': 'BPM' };
            const u = units[item.dataset.label] || '';
            let statusStr = '';
            if (isClinicalStatusVisible && pt && pt.sys && pt.dia && (item.dataset.label === 'Systolic' || item.dataset.label === 'Diastolic')) {
              const cat = classifyBP(pt.sys, pt.dia);
              if (cat) statusStr = ` [${STATUS_LABELS[cat]}]`;
            }
            return ` ${item.dataset.label}: ${item.raw} ${u}${statusStr}`;
          },
          afterBody: (items) => {
            const idx = items[0].dataIndex;
            const pt = points[idx];
            if (pt && pt.dateKey === currentSelectedDateKey) {
              return '\n🎯 Currently isolated day';
            }
            return '\n💡 Click to isolate this day across all charts';
          }
        }
      }
    }
  };

  buildChart('chartCombined', labels, (ctx) => [
    createLineDataset('Systolic',   sysData,   '#FF7B61', false, ctx),
    createLineDataset('Diastolic',  diaData,   '#4AACDA', false, ctx),
    createLineDataset('Heart Rate', pulseData, '#3DB891', false, ctx)
  ], combinedOpts, points, 'combined');

  // Maintain active day highlight state if exists
  if (currentSelectedDateKey) {
    updateDayFocusBanner(currentSelectedDateKey);
  }
}

function buildChart(id, labels, datasetsFn, options, points, metricType) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (chartInstances[id]) {
    try { chartInstances[id].destroy(); } catch (e) {}
    delete chartInstances[id];
  }
  if (typeof Chart !== 'undefined') {
    const existingChart = Chart.getChart(canvas);
    if (existingChart) {
      try { existingChart.destroy(); } catch (e) {}
    }
  }
  const ctx = canvas.getContext('2d');
  const datasets = typeof datasetsFn === 'function' ? datasetsFn(ctx) : datasetsFn;

  const chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options,
    plugins: [dayHighlightPlugin, referenceLinesPlugin]
  });

  chart._heartmatePoints = points;
  chart._metricType = metricType;
  chartInstances[id] = chart;
}

function hexToRgba(hex, alpha) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return hex;
  return `rgba(${parseInt(result[1],16)},${parseInt(result[2],16)},${parseInt(result[3],16)},${alpha})`;
}

// ================================================
//  CHART FULLSCREEN MODAL
// ================================================
let chartFsInstance = null;

const FS_DOT_COLORS = {
  sys: '#FF7B61', dia: '#4AACDA', pulse: '#3DB891'
};

function openChartFullscreen(sourceId, title, unit, type) {
  // If analytics data hasn't been collected yet, initialize it
  if (!window._chartData) {
    renderAnalytics();
  }
  if (!window._chartData) return;

  currentFullscreenType = type;

  // Sync tab active states
  ['combined', 'sys', 'dia', 'pulse'].forEach(t => {
    const tab = document.getElementById(`fsTab-${t}`);
    if (tab) tab.classList.toggle('active', t === type);
  });

  const overlay = document.getElementById('chartFsOverlay');
  const titleEl = document.getElementById('chartFsTitle');
  const unitEl  = document.getElementById('chartFsUnit');
  const dotEl   = document.getElementById('chartFsDot');

  if (titleEl) titleEl.textContent = title;
  if (unitEl)  unitEl.textContent  = unit;

  if (dotEl) {
    if (type === 'combined') {
      dotEl.style.cssText = 'background:linear-gradient(90deg,#FF7B61,#4AACDA,#3DB891);width:32px;height:10px;border-radius:4px;display:inline-block;flex-shrink:0;';
    } else {
      dotEl.style.cssText = `background:${FS_DOT_COLORS[type]||'#4AACDA'};width:12px;height:12px;border-radius:50%;display:inline-block;flex-shrink:0;`;
    }
  }

  updateFullscreenFocusStrip(currentSelectedDateKey);

  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';

  if (chartFsInstance) {
    chartFsInstance.destroy();
    chartFsInstance = null;
  }

  // Allow DOM to paint and layout dimensions
  requestAnimationFrame(() => {
    setTimeout(() => buildFullscreenChart(sourceId, type, unit), 50);
  });
}

function switchFullscreenType(type) {
  if (!window._chartData) return;
  currentFullscreenType = type;

  ['combined', 'sys', 'dia', 'pulse'].forEach(t => {
    const tab = document.getElementById(`fsTab-${t}`);
    if (tab) tab.classList.toggle('active', t === type);
  });

  const titles = {
    combined: 'All Metrics — Full Overview',
    sys: 'Systolic Pressure',
    dia: 'Diastolic Pressure',
    pulse: 'Heart Rate'
  };
  const units = {
    combined: '',
    sys: 'mmHg',
    dia: 'mmHg',
    pulse: 'BPM'
  };

  const titleEl = document.getElementById('chartFsTitle');
  const unitEl  = document.getElementById('chartFsUnit');
  const dotEl   = document.getElementById('chartFsDot');

  if (titleEl) titleEl.textContent = titles[type];
  if (unitEl)  unitEl.textContent  = units[type];

  if (dotEl) {
    if (type === 'combined') {
      dotEl.style.cssText = 'background:linear-gradient(90deg,#FF7B61,#4AACDA,#3DB891);width:32px;height:10px;border-radius:4px;display:inline-block;flex-shrink:0;';
    } else {
      dotEl.style.cssText = `background:${FS_DOT_COLORS[type]||'#4AACDA'};width:12px;height:12px;border-radius:50%;display:inline-block;flex-shrink:0;`;
    }
  }

  buildFullscreenChart('chartFullscreen', type, units[type]);
}

function buildFullscreenChart(sourceId, type, unit) {
  const canvas = document.getElementById('chartFullscreen');
  if (!canvas || !window._chartData) return;
  const ctx = canvas.getContext('2d');
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const { labels, sysData, diaData, pulseData, points } = window._chartData;

  const gridColor   = isDark ? 'rgba(98,207,238,0.09)' : 'rgba(74,172,218,0.07)';
  const tickColor   = isDark ? '#4A5E80' : '#9AABBC';
  const legendColor = isDark ? '#B8CCEE' : '#3D5280';

  const makeGrad = (color) => {
    const h = canvas.offsetHeight || 440;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0,   hexToRgba(color, isDark ? 0.42 : 0.32));
    g.addColorStop(0.6, hexToRgba(color, isDark ? 0.14 : 0.08));
    g.addColorStop(1,   hexToRgba(color, 0));
    return g;
  };

  const mkDs = (label, data, color, fill) => ({
    label, data,
    borderColor: color,
    backgroundColor: fill ? makeGrad(color) : 'transparent',
    borderWidth: 3.5,
    pointRadius: (c) => {
      if (!currentSelectedDateKey) return 5.5;
      const pt = points[c.dataIndex];
      return (pt && pt.dateKey === currentSelectedDateKey) ? 10 : 4;
    },
    pointHoverRadius: (c) => {
      if (!currentSelectedDateKey) return 10;
      const pt = points[c.dataIndex];
      return (pt && pt.dateKey === currentSelectedDateKey) ? 14 : 8;
    },
    pointBackgroundColor: (c) => {
      if (!currentSelectedDateKey) return color;
      const pt = points[c.dataIndex];
      return (pt && pt.dateKey === currentSelectedDateKey) ? color : hexToRgba(color, 0.45);
    },
    pointBorderColor: (c) => {
      if (!currentSelectedDateKey) return isDark ? '#1C2539' : '#ffffff';
      const pt = points[c.dataIndex];
      return (pt && pt.dateKey === currentSelectedDateKey) ? (isDark ? '#EDF2FF' : '#ffffff') : (isDark ? '#1C2539' : '#ffffff');
    },
    pointBorderWidth: (c) => {
      if (!currentSelectedDateKey) return 2.5;
      const pt = points[c.dataIndex];
      return (pt && pt.dateKey === currentSelectedDateKey) ? 4 : 1.5;
    },
    tension: 0.45,
    fill: fill ? 'origin' : false
  });

  let datasets;
  if (type === 'combined') {
    datasets = [
      mkDs('Systolic',   sysData,   '#FF7B61', false),
      mkDs('Diastolic',  diaData,   '#4AACDA', false),
      mkDs('Heart Rate', pulseData, '#3DB891', false)
    ];
  } else {
    const map = {
      sys:   ['Systolic',   sysData,   '#FF7B61'],
      dia:   ['Diastolic',  diaData,   '#4AACDA'],
      pulse: ['Heart Rate', pulseData, '#3DB891']
    };
    const [lbl, data, color] = map[type];
    datasets = [mkDs(lbl, data, color, true)];
  }

  const tooltipUnit = (label) =>
    ({ 'Systolic': 'mmHg', 'Diastolic': 'mmHg', 'Heart Rate': 'BPM' }[label] || unit);

  const oldChart = Chart.getChart(canvas);
  if (oldChart) {
    oldChart.destroy();
  }
  if (chartFsInstance) {
    chartFsInstance.destroy();
    chartFsInstance = null;
  }

  chartFsInstance = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      resizeDelay: 200,
      animation: { duration: 500, easing: 'easeInOutQuart' },
      interaction: { mode: 'index', intersect: false },
      onClick: handleChartClick,
      onHover: (event, chartElement) => {
        event.native.target.style.cursor = chartElement[0] ? 'pointer' : 'default';
      },
      plugins: {
        legend: {
          display: type === 'combined',
          labels: {
            font: { family: 'Nunito', weight: '700', size: 14 },
            color: legendColor,
            usePointStyle: true,
            pointStyleWidth: 14,
            padding: 22
          }
        },
        tooltip: {
          backgroundColor: isDark ? 'rgba(12,18,36,0.96)' : 'rgba(26,35,64,0.94)',
          titleColor: '#ffffff',
          titleFont: { family: 'Nunito', weight: '800', size: 14 },
          bodyColor: isDark ? '#62CFEE' : '#C3E0F8',
          bodyFont: { family: 'Inter', size: 13 },
          padding: 16,
          cornerRadius: 14,
          borderColor: isDark ? 'rgba(98,207,238,0.25)' : 'rgba(74,172,218,0.2)',
          borderWidth: 1,
          boxPadding: 4,
          callbacks: {
            title: (items) => {
              const idx = items[0].dataIndex;
              const pt = points[idx];
              if (pt) {
                const slotLabel = SLOT_CONFIG[pt.slot]?.label || pt.slot;
                const icon = SLOT_CONFIG[pt.slot]?.icon || '⏰';
                return `${icon} ${slotLabel} (${pt.time || 'Logged'}) • ${formatDisplayDate(pt.dateKey)}`;
              }
              return items[0].label;
            },
            label: (item) => {
              const idx = item.dataIndex;
              const pt = points[idx];
              const u = tooltipUnit(item.dataset.label);
              let statusStr = '';
              if (isClinicalStatusVisible && pt && pt.sys && pt.dia && (item.dataset.label === 'Systolic' || item.dataset.label === 'Diastolic')) {
                const cat = classifyBP(pt.sys, pt.dia);
                if (cat) statusStr = ` [${STATUS_LABELS[cat]}]`;
              }
              return ` ${item.dataset.label}: ${item.raw} ${u}${statusStr}`;
            },
            afterBody: (items) => {
              const idx = items[0].dataIndex;
              const pt = points[idx];
              if (pt && pt.dateKey === currentSelectedDateKey) {
                return '\n🎯 Currently isolated day';
              }
              return '\n💡 Click to isolate this day across all charts';
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { font: { family: 'Inter', size: 12 }, color: tickColor, maxRotation: 45, padding: 6 },
          grid:  { color: gridColor, lineWidth: 1, dash: [5, 5] }
        },
        y: {
          ticks: { font: { family: 'Inter', size: 13 }, color: tickColor, padding: 8 },
          grid:  { color: gridColor, lineWidth: 1, dash: [5, 5] },
          border: { dash: [5, 5] }
        }
      }
    },
    plugins: [dayHighlightPlugin, referenceLinesPlugin]
  });

  chartFsInstance._heartmatePoints = points;
  chartFsInstance._metricType = type;
}

function closeChartFullscreen() {
  const overlay = document.getElementById('chartFsOverlay');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
  if (chartFsInstance) {
    try { chartFsInstance.destroy(); } catch (e) {}
    chartFsInstance = null;
  }
  const canvas = document.getElementById('chartFullscreen');
  if (canvas && typeof Chart !== 'undefined') {
    const existing = Chart.getChart(canvas);
    if (existing) {
      try { existing.destroy(); } catch (e) {}
    }
  }
}


// ================================================
//  DEMO DATA SEEDER (30 days of realistic data)
// ================================================
function seedDemoData() {
  const all = getAll();
  const now = new Date();
  let seeded = false;

  // Only seed if no data at all
  const hasData = Object.keys(all).length > 0;
  if (hasData) return;

  // Realistic BP patterns for an elderly person
  const baseSys = 138, baseDia = 86, basePulse = 74;

  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = formatDateKey(d.getFullYear(), d.getMonth() + 1, d.getDate());

    if (!all[key]) all[key] = {};

    // Skip a few random days to make it realistic
    if (Math.random() < 0.12) continue;

    SLOTS.forEach((slot, si) => {
      if (Math.random() < 0.1) return; // occasional missed readings
      const variance = (v, r) => Math.round(v + (Math.random() - 0.5) * r);
      const slotMod  = si === 0 ? -4 : si === 1 ? 0 : 3; // BP tends to rise through day

      all[key][slot] = {
        sys:   Math.max(95, Math.min(175, variance(baseSys + slotMod, 18))),
        dia:   Math.max(58, Math.min(110, variance(baseDia + slotMod, 12))),
        pulse: Math.max(55, Math.min(105, variance(basePulse, 14))),
        time:  SLOT_CONFIG[slot].defaultTime
      };
    });
    seeded = true;
  }

  if (seeded) saveAll(all);
}

// ================================================
//  THEME TOGGLE
// ================================================
function initTheme() {
  const saved = localStorage.getItem('heartmate_theme') || 'light';
  applyTheme(saved, false);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next, true);
}

function applyTheme(theme, animate) {
  if (animate) {
    // Add a brief class to body to block pointer events during transition
    document.body.style.pointerEvents = 'none';
    setTimeout(() => { document.body.style.pointerEvents = ''; }, 350);
  }

  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }

  localStorage.setItem('heartmate_theme', theme);

  // Re-render charts with updated colors if they exist
  if (Object.keys(chartInstances).length > 0) {
    setTimeout(() => updateChartTheme(theme), 50);
  }
}

function updateChartTheme(theme) {
  const isDark = theme === 'dark';
  const gridColor   = isDark ? 'rgba(98,207,238,0.07)' : 'rgba(74,172,218,0.06)';
  const tickColor   = isDark ? '#556280' : '#9AABBC';
  const legendColor = isDark ? '#B8CCEE' : '#3D5280';

  Object.values(chartInstances).forEach(chart => {
    if (!chart) return;
    if (chart.options.scales?.x) {
      chart.options.scales.x.ticks.color = tickColor;
      chart.options.scales.x.grid.color  = gridColor;
    }
    if (chart.options.scales?.y) {
      chart.options.scales.y.ticks.color = tickColor;
      chart.options.scales.y.grid.color  = gridColor;
    }
    if (chart.options.plugins?.legend?.labels) {
      chart.options.plugins.legend.labels.color = legendColor;
    }
    chart.update('none'); // no animation for theme switch
  });
}

// ================================================
//  CLEAR ALL MODAL
// ================================================
function openClearModal() {
  const overlay = document.getElementById('clearModalOverlay');
  const input   = document.getElementById('deleteInput');
  const btn     = document.getElementById('destroyBtn');

  input.value = '';
  input.classList.remove('valid');
  btn.disabled = true;
  btn.setAttribute('aria-disabled', 'true');

  overlay.classList.add('open');
  // Focus the input after animation
  setTimeout(() => input.focus(), 380);
}

function closeClearModal() {
  document.getElementById('clearModalOverlay').classList.remove('open');
}

function checkDeleteInput() {
  const input = document.getElementById('deleteInput');
  const btn   = document.getElementById('destroyBtn');
  const isValid = input.value.trim().toUpperCase() === 'DELETE';

  if (isValid) {
    input.classList.add('valid');
    btn.disabled = false;
    btn.setAttribute('aria-disabled', 'false');
  } else {
    input.classList.remove('valid');
    btn.disabled = true;
    btn.setAttribute('aria-disabled', 'true');
  }
}

function executeCleanAll() {
  // Double-check guard
  const input = document.getElementById('deleteInput');
  if (input.value.trim().toUpperCase() !== 'DELETE') return;

  // Wipe all data
  localStorage.removeItem(STORAGE_KEY);

  // Clear chart instances & active highlight
  Object.keys(chartInstances).forEach(id => {
    if (chartInstances[id]) {
      try { chartInstances[id].destroy(); } catch (e) {}
      delete chartInstances[id];
    }
    const canvas = document.getElementById(id);
    if (canvas && typeof Chart !== 'undefined') {
      const existing = Chart.getChart(canvas);
      if (existing) {
        try { existing.destroy(); } catch (e) {}
      }
    }
  });
  chartInstances = {};

  if (receiptChartInstance) {
    try { receiptChartInstance.destroy(); } catch (e) {}
    receiptChartInstance = null;
  }
  const rxCanvas = document.getElementById('receiptChartCanvas');
  if (rxCanvas && typeof Chart !== 'undefined') {
    const existing = Chart.getChart(rxCanvas);
    if (existing) {
      try { existing.destroy(); } catch (e) {}
    }
  }

  if (chartFsInstance) {
    try { chartFsInstance.destroy(); } catch (e) {}
    chartFsInstance = null;
  }
  const fsCanvas = document.getElementById('chartFullscreen');
  if (fsCanvas && typeof Chart !== 'undefined') {
    const existing = Chart.getChart(fsCanvas);
    if (existing) {
      try { existing.destroy(); } catch (e) {}
    }
  }
  currentSelectedDateKey = null;
  const picker = document.getElementById('analyticsDatePicker');
  if (picker) picker.value = '';
  const banner = document.getElementById('dayFocusBanner');
  if (banner) banner.style.display = 'none';

  // Reset form fields
  SLOTS.forEach(slot => {
    const prefix = slot === 'morning' ? 'morn' : slot === 'afternoon' ? 'aft' : 'eve';
    ['sys', 'dia', 'pulse'].forEach(f => {
      const el = document.getElementById(`${prefix}-${f}`);
      if (el) el.value = '';
    });
    updateStatusBadge(slot);
    updateDot(slot);
  });

  closeClearModal();
  showToast('🗑️ All records have been cleared.', 'error');

  // Refresh calendar, analytics, & report pad if they were open
  if (document.getElementById('page-calendar').classList.contains('active')) {
    renderCalendar();
  }
  if (document.getElementById('page-analytics').classList.contains('active')) {
    renderAnalytics();
  }
  if (document.getElementById('page-report').classList.contains('active')) {
    renderReportPad();
  }
}

// Close modals with Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeChartFullscreen();
    closeClearModal();
    closeModal();
  }
});

// ================================================
//  PAGE 4: REPORT GENERATOR / RX RECEIPT & BILLING INVOICE
// ================================================

let reportActiveSubPage = 'rx'; // 'rx' (Prescription Pad) or 'invoice' (Billing Invoice)
let reportCurrentDataMode = 'averages'; // 'averages' or 'individual'
let isPrescriptionVisible = true;

// Billing Invoice Dynamic State
let invoiceItems = [
  { id: 'item-1', desc: 'Comprehensive Cardiology Consultation & Clinical BP Review', date: '', amount: 700 },
  { id: 'item-2', desc: 'Ambulatory Blood Pressure Monitoring & Metric Profiling (3x Daily)', date: '', amount: 600 },
  { id: 'item-3', desc: 'Lifestyle & Dietary Sodium Intervention Protocol Guidance', date: '', amount: 500 }
];
let invoiceManualTotal = null; // null if auto-sum, number if manually overridden
let isInvoiceInitialized = false;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Initializes Start Date and End Date inputs to default 30-day window if empty.
 */
function initReportDateInputs() {
  const startEl = document.getElementById('reportStartDate');
  const endEl = document.getElementById('reportEndDate');
  if (!startEl || !endEl) return;

  if (!endEl.value) {
    const now = new Date();
    endEl.value = formatDateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }
  if (!startEl.value) {
    const [y, m, d] = endEl.value.split('-').map(Number);
    const past = new Date(y, m - 1, d);
    past.setDate(past.getDate() - 29);
    startEl.value = formatDateKey(past.getFullYear(), past.getMonth() + 1, past.getDate());
  }
}

/**
 * Collects data points for the prescription pad based on the custom Start Date and End Date.
 */
function getReportPoints() {
  initReportDateInputs();
  const startEl = document.getElementById('reportStartDate');
  const endEl = document.getElementById('reportEndDate');

  let startDate = startEl ? startEl.value : '';
  let endDate = endEl ? endEl.value : '';

  if (startDate && endDate && startDate > endDate) {
    // Swap if start is later than end
    const temp = startDate;
    startDate = endDate;
    endDate = temp;
    if (startEl) startEl.value = startDate;
    if (endEl) endEl.value = endDate;
  }

  const all = getAll();
  const keys = Object.keys(all).filter(k => (!startDate || k >= startDate) && (!endDate || k <= endDate)).sort();
  const points = [];

  keys.forEach(key => {
    const dayData = all[key];
    if (!dayData) return;
    SLOTS.forEach(slot => {
      const r = dayData[slot];
      if (r?.sys && r?.dia) {
        points.push({
          dateKey: key,
          date: new Date(key),
          slot,
          sys: Number(r.sys),
          dia: Number(r.dia),
          pulse: r.pulse ? Number(r.pulse) : null,
          time: r.time || ''
        });
      }
    });
  });

  return points;
}

/**
 * Handler for manual changes to Start Date or End Date calendar inputs.
 */
function handleCustomDateRangeChange() {
  document.querySelectorAll('.preset-pill').forEach(p => p.classList.remove('active'));
  renderReportPad();
}

/**
 * Applies preset date ranges (7D, 14D, 30D, 90D, or All).
 */
function applyPresetRange(preset) {
  const endInput = document.getElementById('reportEndDate');
  const startInput = document.getElementById('reportStartDate');
  const now = new Date();
  const endStr = formatDateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());

  let startStr = endStr;
  if (preset === 'all') {
    const all = getAll();
    const keys = Object.keys(all).sort();
    startStr = keys.length ? keys[0] : endStr;
  } else {
    const days = parseInt(preset, 10) || 30;
    const past = new Date(now);
    past.setDate(past.getDate() - (days - 1));
    startStr = formatDateKey(past.getFullYear(), past.getMonth() + 1, past.getDate());
  }

  if (endInput) endInput.value = endStr;
  if (startInput) startInput.value = startStr;

  // Highlight active preset pill
  document.querySelectorAll('.preset-pill').forEach(p => p.classList.remove('active'));
  const activePill = document.getElementById(preset === 'all' ? 'pillAll' : `pill${preset}d`);
  if (activePill) activePill.classList.add('active');

  renderReportPad();
}

/**
 * Switches data display mode between 'averages' (Calculated Averages) and 'individual' (Individual Records).
 */
function setDataDisplayMode(mode) {
  reportCurrentDataMode = mode;
  const btnAvg = document.getElementById('modeBtnAvg');
  const btnInd = document.getElementById('modeBtnInd');
  if (btnAvg) btnAvg.classList.toggle('active', mode === 'averages');
  if (btnInd) btnInd.classList.toggle('active', mode === 'individual');

  renderReportPad();
}

/**
 * Toggles visibility of the Doctor's Prescription & Lifestyle Recommendations on the pad.
 * When removed, the underlying receipt body perfectly preserves the faint top grid pattern
 * and light horizontal ruled lines matching reference template 11.jpeg.
 */
function togglePrescriptionContent() {
  isPrescriptionVisible = !isPrescriptionVisible;
  const block = document.getElementById('rxRecommendationsBlock');
  const btn = document.getElementById('toggleRxContentBtn');
  const textEl = document.getElementById('toggleRxBtnText');
  const iconEl = document.getElementById('toggleRxIcon');

  if (block) {
    block.style.display = isPrescriptionVisible ? 'block' : 'none';
  }

  if (isPrescriptionVisible) {
    if (textEl) textEl.textContent = 'Remove Prescription & Lifestyle Recommendations';
    if (iconEl) iconEl.textContent = '🗑️';
    if (btn) btn.classList.remove('active-removed');
    showToast('Prescription recommendations restored to receipt.', 'info');
  } else {
    if (textEl) textEl.textContent = 'Restore Prescription & Lifestyle Recommendations';
    if (iconEl) iconEl.textContent = '➕';
    if (btn) btn.classList.add('active-removed');
    showToast('Prescription recommendations removed from receipt.', 'info');
  }
}

/**
 * Render or refresh the Prescription Pad view:
 * sets today's date if empty, renders selected data mode (averages or records) aligned to ruled lines,
 * updates trend graph, and synchronizes recommendation block visibility.
 */
function renderReportPad() {
  // 1. Ensure date field has today's date if not already populated
  const rxDateEl = document.getElementById('rxDate');
  if (rxDateEl && !rxDateEl.value) {
    const now = new Date();
    const d = String(now.getDate()).padStart(2, '0');
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const y = now.getFullYear();
    rxDateEl.value = `${d}/${m}/${y}`;
  }

  // 2. Fetch points for the selected custom date range
  const points = getReportPoints();

  // 3. Render Data Display Container (Calculated Averages vs Individual Records)
  renderReportDataDisplay(points);

  // 4. Update embedded visual graph if toggle is enabled
  const toggleEl = document.getElementById('toggleIncludeGraph');
  const includeGraph = toggleEl ? toggleEl.checked : true;
  const container = document.getElementById('rxGraphContainer');
  if (container) {
    container.style.display = includeGraph ? 'block' : 'none';
  }

  if (includeGraph) {
    renderReceiptChart(points);
  }

  // 5. Ensure prescription block visibility state is preserved
  const recBlock = document.getElementById('rxRecommendationsBlock');
  if (recBlock) {
    recBlock.style.display = isPrescriptionVisible ? 'block' : 'none';
  }
}

/**
 * Formats and renders either Calculated Averages or Individual Records
 * directly into #rxDataContainer, with each line/row aligned cleanly to 32px height.
 */
function renderReportDataDisplay(points) {
  const container = document.getElementById('rxDataContainer');
  if (!container) return;

  const startEl = document.getElementById('reportStartDate');
  const endEl = document.getElementById('reportEndDate');
  const startStr = startEl?.value ? formatShortDate(startEl.value) : '';
  const endStr = endEl?.value ? formatShortDate(endEl.value) : '';

  if (!points || points.length === 0) {
    container.innerHTML = `
      <div class="rx-averages-view">
        <div class="rx-ruled-row rx-summary-title-row" style="color: #64748B !important;">
          <span>ℹ️ No blood pressure readings logged between ${startStr || 'selected start'} and ${endStr || 'selected end'}.</span>
        </div>
      </div>
    `;
    return;
  }

  if (reportCurrentDataMode === 'averages') {
    // Mode 1: Calculated Averages (Aggregated mean values for Systolic, Diastolic, and Pulse)
    const sysValues = points.map(p => p.sys);
    const diaValues = points.map(p => p.dia);
    const pulsePts = points.filter(p => p.pulse);

    const avgSys = Math.round(avg(sysValues));
    const avgDia = Math.round(avg(diaValues));
    const avgPulse = pulsePts.length ? Math.round(avg(pulsePts.map(p => p.pulse))) : null;

    const minSys = Math.min(...sysValues);
    const maxSys = Math.max(...sysValues);
    const minDia = Math.min(...diaValues);
    const maxDia = Math.max(...diaValues);
    const uniqueDays = new Set(points.map(p => p.dateKey)).size;

    const cat = classifyBP(avgSys, avgDia);
    const catLabel = STATUS_LABELS[cat] || 'Monitored';
    const statusBadgeHtml = isClinicalStatusVisible
      ? `<span class="rx-status-tag ${cat}">${catLabel}</span>`
      : '';

    container.innerHTML = `
      <div class="rx-averages-view">
        <div class="rx-ruled-row rx-summary-title-row">
          <span>📊 <strong>CALCULATED AVERAGES</strong> (${startStr} to ${endStr} • ${points.length} readings across ${uniqueDays} days)</span>
        </div>
        <div class="rx-ruled-row">
          <span>• <strong>Systolic Mean:</strong> ${avgSys} mmHg</span>
          <span>• <strong>Diastolic Mean:</strong> ${avgDia} mmHg</span>
          <span>• <strong>Heart Rate Mean:</strong> ${avgPulse ? avgPulse + ' BPM' : '—'}</span>
          ${statusBadgeHtml}
        </div>
        <div class="rx-ruled-row">
          <span>• <strong>Recorded Pressure Range:</strong> Sys ${minSys}–${maxSys} mmHg &nbsp;|&nbsp; Dia ${minDia}–${maxDia} mmHg</span>
        </div>
      </div>
    `;
  } else {
    // Mode 2: Individual Records (Listing each time-stamped reading within chosen date range)
    const statusThHtml = isClinicalStatusVisible ? `<th>CLINICAL STATUS</th>` : '';

    // Daily Record Delineation: detect whether readings span multiple distinct calendar days
    const uniqueDates = [...new Set(points.map(p => p.dateKey))];
    const spansMultipleDays = uniqueDates.length > 1;

    let rowsHtml = `
      <div class="rx-individual-view">
        <div class="rx-records-table-wrap">
          <table class="rx-records-table">
            <thead>
              <tr>
                <th>DATE & TIME</th>
                <th>SESSION</th>
                <th>SYSTOLIC</th>
                <th>DIASTOLIC</th>
                <th>PULSE</th>
                ${statusThHtml}
              </tr>
            </thead>
            <tbody>
    `;

    points.forEach((p, index) => {
      const cat = classifyBP(p.sys, p.dia);
      const catLabel = STATUS_LABELS[cat] || cat;
      const timeStr = p.time || SLOT_CONFIG[p.slot]?.defaultTime || '';
      const slotLabel = SLOT_CONFIG[p.slot]?.label || p.slot;
      const statusTdHtml = isClinicalStatusVisible
        ? `<td><span class="rx-table-badge ${cat}">${catLabel}</span></td>`
        : '';

      // Check if current reading is the last logged entry of its specific date
      const nextPoint = points[index + 1];
      const isLastEntryOfDay = spansMultipleDays && (!nextPoint || nextPoint.dateKey !== p.dateKey);
      const dayLastClass = isLastEntryOfDay ? ' rx-day-last-row rx-daily-delineator' : '';
      const dayDataAttr = isLastEntryOfDay ? ` data-daily-delineator="true" data-delineator-date="${p.dateKey}"` : '';

      rowsHtml += `
        <tr class="rx-record-row${dayLastClass}" data-date="${p.dateKey}"${dayDataAttr}>
          <td>${formatShortDate(p.dateKey)} ${timeStr}</td>
          <td>${slotLabel}</td>
          <td><strong>${p.sys}</strong> mmHg</td>
          <td><strong>${p.dia}</strong> mmHg</td>
          <td>${p.pulse ? p.pulse + ' BPM' : '—'}</td>
          ${statusTdHtml}
        </tr>
      `;
    });

    rowsHtml += `
            </tbody>
          </table>
        </div>
      </div>
    `;
    container.innerHTML = rowsHtml;
  }
}

/**
 * Formats a YYYY-MM-DD date key into a compact readable string (e.g. "21 Oct 2026").
 */
function formatShortDate(key) {
  if (!key) return '';
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Renders a crisp, high-contrast miniature trend line chart on #receiptChartCanvas.
 */
function renderReceiptChart(points) {
  const canvas = document.getElementById('receiptChartCanvas');
  if (!canvas) return;

  if (receiptChartInstance) {
    receiptChartInstance.destroy();
    receiptChartInstance = null;
  }
  if (typeof Chart !== 'undefined') {
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();
  }

  if (!points || points.length === 0) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '600 13px Inter, sans-serif';
    ctx.fillStyle = '#64748B';
    ctx.textAlign = 'center';
    ctx.fillText('No readings recorded in the selected date range.', canvas.width / 2, canvas.height / 2);
    return;
  }

  const labels = points.map(p => {
    const d = new Date(p.dateKey);
    const slotShort = p.slot ? (p.slot.charAt(0).toUpperCase() + p.slot.slice(1, 4)) : '';
    return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${slotShort}`;
  });

  const sysData = points.map(p => p.sys);
  const diaData = points.map(p => p.dia);
  const pulseData = points.map(p => p.pulse || null);

  const ctx = canvas.getContext('2d');

  receiptChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Systolic',
          data: sysData,
          borderColor: '#DC2626',
          backgroundColor: 'rgba(220, 38, 38, 0.08)',
          borderWidth: 2.4,
          pointRadius: 3.5,
          pointHoverRadius: 5.5,
          pointBackgroundColor: '#DC2626',
          pointBorderColor: '#FFFFFF',
          pointBorderWidth: 1.5,
          tension: 0.35,
          fill: false
        },
        {
          label: 'Diastolic',
          data: diaData,
          borderColor: '#2563EB',
          backgroundColor: 'rgba(37, 99, 235, 0.08)',
          borderWidth: 2.4,
          pointRadius: 3.5,
          pointHoverRadius: 5.5,
          pointBackgroundColor: '#2563EB',
          pointBorderColor: '#FFFFFF',
          pointBorderWidth: 1.5,
          tension: 0.35,
          fill: false
        },
        {
          label: 'Heart Rate',
          data: pulseData,
          borderColor: '#059669',
          backgroundColor: 'transparent',
          borderWidth: 1.8,
          borderDash: [4, 3],
          pointRadius: 2.8,
          pointHoverRadius: 4.5,
          pointBackgroundColor: '#059669',
          pointBorderColor: '#FFFFFF',
          pointBorderWidth: 1.2,
          tension: 0.35,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      resizeDelay: 200,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.94)',
          titleColor: '#FFFFFF',
          titleFont: { family: 'Nunito', weight: '800', size: 12 },
          bodyColor: '#E2E8F0',
          bodyFont: { family: 'Inter', size: 11 },
          padding: 10,
          cornerRadius: 8,
          boxPadding: 4,
          callbacks: {
            label: (item) => {
              const u = item.dataset.label === 'Heart Rate' ? 'BPM' : 'mmHg';
              let statusStr = '';
              if (isClinicalStatusVisible && (item.dataset.label === 'Systolic' || item.dataset.label === 'Diastolic')) {
                const pt = points[item.dataIndex];
                if (pt && pt.sys && pt.dia) {
                  const cat = classifyBP(pt.sys, pt.dia);
                  if (cat) statusStr = ` [${STATUS_LABELS[cat]}]`;
                }
              }
              return ` ${item.dataset.label}: ${item.raw} ${u}${statusStr}`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            font: { family: 'Inter', size: 9, weight: '600' },
            color: '#334155',
            maxRotation: 40,
            padding: 2
          },
          grid: {
            color: 'rgba(0, 0, 0, 0.06)',
            lineWidth: 1
          }
        },
        y: {
          min: 40,
          suggestedMax: 160,
          ticks: {
            stepSize: 20,
            font: { family: 'Inter', size: 9, weight: '600' },
            color: '#334155',
            padding: 4
          },
          grid: {
            color: 'rgba(0, 0, 0, 0.06)',
            lineWidth: 1
          }
        }
      }
    }
  });
}

/**
 * Toggles the miniature trend graph visibility on the ruled prescription pad.
 */
function toggleReceiptGraph(include) {
  const container = document.getElementById('rxGraphContainer');
  if (container) {
    container.style.display = include ? 'block' : 'none';
  }
  if (include) {
    const points = getReportPoints();
    renderReceiptChart(points);
  }
}

/**
 * Reads health records and automatically populates:
 * - Patient Diagnosis with calculated average BP and Stage
 * - Today's Date
 * - Clinical lifestyle prescriptions and monitoring advice
 */
function autofillPrescriptionData() {
  const points = getReportPoints();
  const rxDateEl = document.getElementById('rxDate');
  const rxDiagnosisEl = document.getElementById('rxDiagnosis');
  const rxNotesEl = document.getElementById('rxNotes');

  // 1. Set current date
  const today = new Date();
  const d = String(today.getDate()).padStart(2, '0');
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const y = today.getFullYear();
  if (rxDateEl) rxDateEl.value = `${d}/${m}/${y}`;

  if (points.length === 0) {
    if (rxDiagnosisEl) rxDiagnosisEl.value = 'Routine Preventive BP Monitoring — Awaiting Active Record Entries';
    if (rxNotesEl) rxNotesEl.value = '1. Record BP 3 times daily (Morning, Afternoon, Evening) for at least 7 consecutive days.\n2. Maintain standard resting position for 5 minutes before every cuff inflation.\n3. Return for clinical evaluation with completed readings log.';
    showToast('ℹ️ No readings recorded yet in selected timeframe.', 'info');
    return;
  }

  const avgSys = avg(points.map(p => p.sys));
  const avgDia = avg(points.map(p => p.dia));
  const pulsePts = points.filter(p => p.pulse);
  const avgPulse = pulsePts.length ? avg(pulsePts.map(p => p.pulse)) : 72;

  const cat = classifyBP(avgSys, avgDia);
  let diagText = '';
  let adviceNotes = '';

  if (cat === 'normal') {
    diagText = `Normal Blood Pressure (Avg: ${Math.round(avgSys)}/${Math.round(avgDia)} mmHg, HR: ${Math.round(avgPulse)} BPM) — Optimal Cardiovascular Status`;
    adviceNotes = `1. Nutrition & Diet: Maintain low-sodium dietary intake (< 2g/day). Emphasize potassium-rich fresh fruits, steamed vegetables, and whole grains.
2. Daily BP Logging: Continue logging readings 3 times daily (Morning before 10 AM, Afternoon 2-4 PM, Evening 8-9 PM).
3. Physical Activity: 30 minutes light morning brisk walk; maintain daily hydration (2.0 - 2.5 Liters).
4. Clinical Review: Sit resting for 5 mins prior to measurement. Return for clinic review if Systolic > 140 or Diastolic > 90 mmHg.`;
  } else if (cat === 'elevated') {
    diagText = `Elevated Blood Pressure (Avg: ${Math.round(avgSys)}/${Math.round(avgDia)} mmHg, HR: ${Math.round(avgPulse)} BPM) — Pre-Hypertensive Monitoring`;
    adviceNotes = `1. Dietary Sodium Restriction: Strictly limit sodium to < 1.5g/day. Eliminate added table salt, processed snacks, and packaged foods.
2. Cardiovascular Exercise: 30-45 minutes brisk walking 5 days weekly; incorporate potassium-rich foods (bananas, spinach, citrus).
3. Stress Management: Practice 10 minutes daily mindful breathing exercises; ensure 7-8 hours restful sleep.
4. Monitoring Protocol: Continue logging 3 times daily. Contact GS Clinic if morning readings persistently exceed 135/85 mmHg.`;
  } else if (cat === 'high') {
    diagText = `Essential Hypertension (Avg: ${Math.round(avgSys)}/${Math.round(avgDia)} mmHg, HR: ${Math.round(avgPulse)} BPM) — Active Ambulatory BP Management`;
    adviceNotes = `1. Clinical Review: Schedule in-person clinic follow-up for medication dosage titration and cardiovascular review.
2. DASH Diet Protocol: Strict low-sodium regimen (< 1.5g sodium/day). Zero pickles, papad, or salty broths.
3. Strict Ambulatory Logging: Continue strict 3x daily BP logging (Morning 8 AM, Afternoon 2 PM, Evening 8 PM).
4. Red Flag Alert: Seek immediate medical attention if Systolic exceeds 180 or Diastolic exceeds 110 mmHg.`;
  } else {
    diagText = `Borderline Low Blood Pressure (Avg: ${Math.round(avgSys)}/${Math.round(avgDia)} mmHg, HR: ${Math.round(avgPulse)} BPM) — Hypovolemic / Orthostatic Review`;
    adviceNotes = `1. Hydration Protocol: Increase oral fluid intake to 2.5 - 3.0 Liters daily with electrolytes.
2. Postural Awareness: Change positions slowly when standing up from bed or seated positions.
3. Nutrition: Normal dietary salt intake; consume smaller, frequent nutrient-dense meals.
4. Clinical Follow-up: Report any episodes of dizziness, lightheadedness, or palpitations immediately.`;
  }

  if (rxDiagnosisEl) rxDiagnosisEl.value = diagText;
  if (rxNotesEl) rxNotesEl.value = adviceNotes;

  // If recommendations were previously removed, restore visibility so the user can inspect the auto-filled advice
  if (!isPrescriptionVisible) {
    togglePrescriptionContent();
  }

  renderReportPad();
  showToast('🪄 Prescription Pad auto-filled from health records!', 'success');
}

// ================================================
//  BILLING INVOICE SUB-PAGE LOGIC & CONFIGURATION
// ================================================

/**
 * Switches between Prescription Pad and Billing Invoice sub-pages.
 * Toggles controls panels, printable viewports, and sub-navigation active indicators.
 */
function switchReportSubPage(subpage) {
  reportActiveSubPage = subpage;

  const tabRx = document.getElementById('subtab-rx');
  const tabInv = document.getElementById('subtab-invoice');
  const rxControls = document.getElementById('rxControlsPanel');
  const invControls = document.getElementById('invoiceControlsPanel');
  const rxViewport = document.getElementById('rxPadViewport');
  const invViewport = document.getElementById('invoiceViewport');

  if (subpage === 'invoice') {
    if (tabRx) {
      tabRx.classList.remove('active');
      tabRx.setAttribute('aria-selected', 'false');
    }
    if (tabInv) {
      tabInv.classList.add('active');
      tabInv.setAttribute('aria-selected', 'true');
    }
    if (rxControls) rxControls.style.display = 'none';
    if (invControls) invControls.style.display = 'flex';
    if (rxViewport) rxViewport.style.display = 'none';
    if (invViewport) invViewport.style.display = 'flex';

    if (!isInvoiceInitialized) {
      initInvoiceDefaults();
    } else {
      renderBillingInvoice();
    }
  } else {
    // subpage === 'rx'
    if (tabInv) {
      tabInv.classList.remove('active');
      tabInv.setAttribute('aria-selected', 'false');
    }
    if (tabRx) {
      tabRx.classList.add('active');
      tabRx.setAttribute('aria-selected', 'true');
    }
    if (invControls) invControls.style.display = 'none';
    if (rxControls) rxControls.style.display = 'block';
    if (invViewport) invViewport.style.display = 'none';
    if (rxViewport) rxViewport.style.display = 'flex';

    renderReportPad();
  }
}

/**
 * Initializes default dates and values for the Billing Invoice.
 */
function initInvoiceDefaults() {
  const invDateInput = document.getElementById('invDateInput');
  const today = getTodayString();
  if (invDateInput && !invDateInput.value) {
    invDateInput.value = today;
  }

  const sgstInput = document.getElementById('invSgstInput');
  if (sgstInput && !sgstInput.value) {
    sgstInput.value = '0';
  }
  const igstInput = document.getElementById('invIgstInput');
  if (igstInput && !igstInput.value) {
    igstInput.value = '0';
  }

  // Set default item dates if empty
  invoiceItems.forEach(item => {
    if (!item.date) item.date = today;
  });

  // Calculate default auto-sum with taxes
  const subtotal = invoiceItems.reduce((acc, it) => acc + (Number(it.amount) || 0), 0);
  const sgstRate = Math.max(0, parseFloat(sgstInput?.value) || 0);
  const igstRate = Math.max(0, parseFloat(igstInput?.value) || 0);
  const grandTotal = Math.round((subtotal + (subtotal * sgstRate / 100) + (subtotal * igstRate / 100)) * 100) / 100;

  const totalInput = document.getElementById('invTotalAmountInput');
  if (totalInput && (!totalInput.value || invoiceManualTotal === null)) {
    totalInput.value = grandTotal;
  }

  isInvoiceInitialized = true;
  renderInvoiceConfigItems();
  renderBillingInvoice();
}

/**
 * Renders the list of itemized charge input rows in the configuration panel.
 */
function renderInvoiceConfigItems() {
  const container = document.getElementById('invoiceItemsEditorList');
  if (!container) return;

  const today = getTodayString();

  let html = '';
  invoiceItems.forEach((item) => {
    html += `
      <div class="item-editor-row" id="editor-row-${item.id}">
        <input
          type="text"
          class="inv-config-input"
          value="${escapeHtml(item.desc)}"
          placeholder="Service / Consultation description"
          aria-label="Charge description"
          oninput="updateChargeItem('${item.id}', 'desc', this.value)"
        />
        <input
          type="date"
          class="inv-config-input"
          value="${item.date || today}"
          aria-label="Charge date"
          onchange="updateChargeItem('${item.id}', 'date', this.value)"
        />
        <div class="input-with-currency">
          <span class="currency-prefix">₹</span>
          <input
            type="number"
            class="inv-config-input"
            style="padding-left: 24px;"
            value="${item.amount}"
            placeholder="Amount"
            min="0"
            step="50"
            aria-label="Charge amount"
            oninput="updateChargeItem('${item.id}', 'amount', this.value)"
          />
        </div>
        <button
          type="button"
          class="item-del-btn"
          onclick="removeChargeItem('${item.id}')"
          title="Remove charge item"
          ${invoiceItems.length <= 1 ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''}
        >
          ✕
        </button>
      </div>
    `;
  });

  container.innerHTML = html;
}

/**
 * Adds a new itemized charge row to the invoice configuration panel.
 */
function addNewChargeItem() {
  const today = getTodayString();
  const newItem = {
    id: 'item-' + Date.now(),
    desc: 'Clinical Follow-up & Ambulatory Tele-monitoring',
    date: today,
    amount: 400
  };
  invoiceItems.push(newItem);

  renderInvoiceConfigItems();
  autoSumInvoiceItems();
  renderBillingInvoice();
  showToast('➕ New itemized charge added!', 'info');
}

/**
 * Removes an itemized charge by ID.
 */
function removeChargeItem(id) {
  if (invoiceItems.length <= 1) {
    showToast('⚠️ Invoice must have at least one itemized charge.', 'info');
    return;
  }
  invoiceItems = invoiceItems.filter(item => item.id !== id);
  renderInvoiceConfigItems();
  autoSumInvoiceItems();
  renderBillingInvoice();
  showToast('🗑️ Itemized charge removed.', 'info');
}

/**
 * Updates a specific field ('desc', 'date', 'amount') of a charge item.
 */
function updateChargeItem(id, field, value) {
  const item = invoiceItems.find(it => it.id === id);
  if (!item) return;

  if (field === 'amount') {
    const parsed = parseFloat(value);
    item.amount = isNaN(parsed) ? 0 : parsed;
    // If not manually locked, auto sync total including taxes
    if (invoiceManualTotal === null) {
      const subtotal = invoiceItems.reduce((acc, it) => acc + (Number(it.amount) || 0), 0);
      const sgstRate = Math.max(0, parseFloat(document.getElementById('invSgstInput')?.value) || 0);
      const igstRate = Math.max(0, parseFloat(document.getElementById('invIgstInput')?.value) || 0);
      const grandTotal = Math.round((subtotal + (subtotal * sgstRate / 100) + (subtotal * igstRate / 100)) * 100) / 100;
      const totalInput = document.getElementById('invTotalAmountInput');
      if (totalInput) totalInput.value = grandTotal;
    }
  } else {
    item[field] = value;
  }

  renderBillingInvoice();
}

/**
 * Auto-sums itemized charges plus SGST & IGST and updates the Total Payment Amount control input.
 */
function autoSumInvoiceItems() {
  invoiceManualTotal = null;
  const subtotal = invoiceItems.reduce((acc, it) => acc + (Number(it.amount) || 0), 0);
  const sgstRate = Math.max(0, parseFloat(document.getElementById('invSgstInput')?.value) || 0);
  const igstRate = Math.max(0, parseFloat(document.getElementById('invIgstInput')?.value) || 0);
  const sgstAmt = (subtotal * sgstRate) / 100;
  const igstAmt = (subtotal * igstRate) / 100;
  const grandTotal = Math.round((subtotal + sgstAmt + igstAmt) * 100) / 100;

  const totalInput = document.getElementById('invTotalAmountInput');
  if (totalInput) totalInput.value = grandTotal;

  renderBillingInvoice();
  showToast(`🔄 Auto-Sum calculated (Subtotal + Taxes): ₹ ${grandTotal.toLocaleString('en-IN')}`, 'info');
}

/**
 * Handles tax rate changes (SGST / IGST) and dynamically recalculates taxes and total.
 */
function handleTaxConfigChange() {
  const sgstRate = Math.max(0, parseFloat(document.getElementById('invSgstInput')?.value) || 0);
  const igstRate = Math.max(0, parseFloat(document.getElementById('invIgstInput')?.value) || 0);

  syncTaxPills('sgst', sgstRate);
  syncTaxPills('igst', igstRate);

  // If not manually locked, auto-calculate new total
  if (invoiceManualTotal === null) {
    const subtotal = invoiceItems.reduce((acc, it) => acc + (Number(it.amount) || 0), 0);
    const sgstAmt = (subtotal * sgstRate) / 100;
    const igstAmt = (subtotal * igstRate) / 100;
    const grandTotal = Math.round((subtotal + sgstAmt + igstAmt) * 100) / 100;
    const totalInput = document.getElementById('invTotalAmountInput');
    if (totalInput) totalInput.value = grandTotal;
  }

  renderBillingInvoice();
}

/**
 * Sets a tax preset percentage (e.g. 0%, 2.5%, 6%, 9% for SGST; 0%, 5%, 12%, 18% for IGST).
 */
function setTaxPreset(taxType, rate) {
  const inputId = taxType === 'sgst' ? 'invSgstInput' : 'invIgstInput';
  const input = document.getElementById(inputId);
  if (input) {
    input.value = rate;
    handleTaxConfigChange();
  }
}

/**
 * Synchronizes active class on tax preset pills.
 */
function syncTaxPills(taxType, currentRate) {
  const container = document.getElementById(taxType === 'sgst' ? 'sgstPillsContainer' : 'igstPillsContainer');
  if (!container) return;
  container.querySelectorAll('.tax-pill').forEach(pill => {
    const pillRate = parseFloat(pill.textContent.replace('%', ''));
    pill.classList.toggle('active', pillRate === currentRate);
  });
}

/**
 * Handles manual total amount override input in the configuration panel.
 */
function handleManualTotalAmountInput() {
  const totalInput = document.getElementById('invTotalAmountInput');
  if (!totalInput) return;
  const val = parseFloat(totalInput.value);
  invoiceManualTotal = isNaN(val) ? 0 : val;
  renderBillingInvoice();
}

/**
 * Synchronizes controls inputs (Date, Patient, Age, Status, Invoice #) to billing invoice.
 */
function handleInvoiceConfigChange() {
  renderBillingInvoice();
}

/**
 * Formats a number to Indian Rupees words representation (e.g., INR One Thousand Eight Hundred Only).
 */
function numberToWordsINR(num) {
  if (num === 0) return 'INR Zero Only';
  if (!num || isNaN(num)) return 'INR Zero Only';

  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
             'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertTwoDigits(n) {
    if (n < 20) return a[n];
    return b[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + a[n % 10] : '');
  }

  function convertThreeDigits(n) {
    let str = '';
    if (Math.floor(n / 100) > 0) {
      str += a[Math.floor(n / 100)] + ' Hundred';
      if (n % 100 !== 0) str += ' and ';
    }
    str += convertTwoDigits(n % 100);
    return str.trim();
  }

  let n = Math.floor(Math.abs(num));
  let str = '';

  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const remainder = n;

  if (crore > 0) str += convertTwoDigits(crore) + ' Crore ';
  if (lakh > 0) str += convertTwoDigits(lakh) + ' Lakh ';
  if (thousand > 0) str += convertTwoDigits(thousand) + ' Thousand ';
  if (remainder > 0) str += convertThreeDigits(remainder) + ' ';

  return 'INR ' + str.trim() + ' Only';
}

/**
 * Renders the clean, structured rectangular Billing Invoice (#billingInvoicePad):
 * - Corporate header with metadata
 * - Patient and clinical details grid
 * - Grid-based billing table
 * - Heavily bolded right-aligned Total Amount Due (Subtotal + SGST + IGST)
 * - Distinct line items for Subtotal, SGST, IGST
 * - Signature and official stamp
 */
function renderBillingInvoice() {
  const invDateInput = document.getElementById('invDateInput');
  const invNumberInput = document.getElementById('invNumberInput');
  const invPatientInput = document.getElementById('invPatientInput');
  const invAgeInput = document.getElementById('invAgeInput');
  const invStatusSelect = document.getElementById('invStatusSelect');
  const invTotalAmountInput = document.getElementById('invTotalAmountInput');

  const today = getTodayString();
  const dateVal = invDateInput?.value || today;
  const numberVal = invNumberInput?.value || 'INV-2026-0842';
  const patientVal = invPatientInput?.value || 'Mom (Mrs. Gurmeet Kaur)';
  const ageVal = invAgeInput?.value || '64 Yrs';
  const statusVal = invStatusSelect?.value || 'PAID ✅';

  // 1. Header Metadata
  const numDisplay = document.getElementById('invDisplayNumber');
  if (numDisplay) numDisplay.textContent = numberVal;

  const dateDisplay = document.getElementById('invDisplayIssueDate');
  if (dateDisplay) dateDisplay.textContent = formatShortDate(dateVal);

  const statusDisplay = document.getElementById('invDisplayStatus');
  if (statusDisplay) {
    statusDisplay.textContent = statusVal;
    statusDisplay.className = 'inv-status-pill';
    if (statusVal.includes('PAID') && !statusVal.includes('PARTIAL')) {
      statusDisplay.classList.add('paid');
    } else if (statusVal.includes('PENDING')) {
      statusDisplay.classList.add('pending');
    } else {
      statusDisplay.classList.add('partial');
    }
  }

  // 2. Patient & Clinical Info
  const patDisplay = document.getElementById('invDisplayPatient');
  if (patDisplay) patDisplay.textContent = patientVal;

  const ageDisplay = document.getElementById('invDisplayAge');
  if (ageDisplay) ageDisplay.textContent = ageVal;

  const billDateDisplay = document.getElementById('invDisplayBillingDate');
  if (billDateDisplay) billDateDisplay.textContent = formatShortDate(dateVal);

  // 3. Grid-Based Billing Table Rows
  const tbody = document.getElementById('invoiceTableBody');
  if (tbody) {
    let rowsHtml = '';
    invoiceItems.forEach((item, index) => {
      const itemDateStr = item.date ? formatShortDate(item.date) : formatShortDate(dateVal);
      const itemAmount = Number(item.amount) || 0;
      rowsHtml += `
        <tr>
          <td class="inv-col-sr">${index + 1}</td>
          <td class="inv-col-desc">
            <div class="inv-desc-main">${escapeHtml(item.desc || 'Medical Service')}</div>
          </td>
          <td class="inv-col-date">${itemDateStr}</td>
          <td class="inv-col-amount">₹ ${itemAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
        </tr>
      `;
    });
    tbody.innerHTML = rowsHtml;
  }

  // 4. Subtotal, Tax Breakdown (SGST & IGST), and Heavily Bolded Total Due
  const itemsSubtotal = invoiceItems.reduce((acc, it) => acc + (Number(it.amount) || 0), 0);
  const subtotalDisplay = document.getElementById('invDisplaySubtotal');
  if (subtotalDisplay) {
    subtotalDisplay.textContent = `₹ ${itemsSubtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  }

  // SGST & IGST calculations
  const sgstRate = Math.max(0, parseFloat(document.getElementById('invSgstInput')?.value) || 0);
  const igstRate = Math.max(0, parseFloat(document.getElementById('invIgstInput')?.value) || 0);
  const sgstAmount = (itemsSubtotal * sgstRate) / 100;
  const igstAmount = (itemsSubtotal * igstRate) / 100;

  // Update control panel hints
  const sgstHint = document.getElementById('invSgstCalculatedHint');
  if (sgstHint) sgstHint.textContent = `₹ ${sgstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  const igstHint = document.getElementById('invIgstCalculatedHint');
  if (igstHint) igstHint.textContent = `₹ ${igstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  // Update distinct tax line items directly above final total
  const sgstRateDisplay = document.getElementById('invDisplaySgstRate');
  if (sgstRateDisplay) sgstRateDisplay.textContent = `${sgstRate}%`;
  const sgstDisplay = document.getElementById('invDisplaySgst');
  if (sgstDisplay) sgstDisplay.textContent = `₹ ${sgstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  const igstRateDisplay = document.getElementById('invDisplayIgstRate');
  if (igstRateDisplay) igstRateDisplay.textContent = `${igstRate}%`;
  const igstDisplay = document.getElementById('invDisplayIgst');
  if (igstDisplay) igstDisplay.textContent = `₹ ${igstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  // Automatically calculate sum of itemized charges (Subtotal) plus configured SGST and IGST
  const calculatedTotal = Math.round((itemsSubtotal + sgstAmount + igstAmount) * 100) / 100;

  let finalTotal = calculatedTotal;
  if (invoiceManualTotal !== null) {
    finalTotal = invoiceManualTotal;
  } else if (invTotalAmountInput && invTotalAmountInput.value !== '') {
    finalTotal = parseFloat(invTotalAmountInput.value) || 0;
  }

  const totalDueDisplay = document.getElementById('invDisplayTotalDue');
  if (totalDueDisplay) {
    totalDueDisplay.textContent = `₹ ${finalTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  }

  const wordsDisplay = document.getElementById('invDisplayWords');
  if (wordsDisplay) {
    wordsDisplay.textContent = numberToWordsINR(finalTotal);
  }
}

/**
 * Auto-fills Invoice Data from health records and Prescription Pad:
 * - Patient Name & Age from rx fields
 * - Sets current date
 * - Recalculates total
 */
function autofillInvoiceData() {
  const rxPatient = document.getElementById('rxPatient')?.value;
  const rxAge = document.getElementById('rxAge')?.value;
  const invPatientInput = document.getElementById('invPatientInput');
  const invAgeInput = document.getElementById('invAgeInput');
  const invDateInput = document.getElementById('invDateInput');

  if (rxPatient && invPatientInput) invPatientInput.value = rxPatient;
  if (rxAge && invAgeInput) invAgeInput.value = rxAge;

  const today = getTodayString();
  if (invDateInput) invDateInput.value = today;

  invoiceItems.forEach(item => {
    item.date = today;
  });

  renderInvoiceConfigItems();
  autoSumInvoiceItems();
  renderBillingInvoice();
  showToast('🪄 Invoice auto-filled with patient details & current date!', 'success');
}

/**
 * Resets billing charges and taxes to standard GS Clinic defaults.
 */
function resetInvoiceDefaults() {
  const today = getTodayString();
  invoiceItems = [
    { id: 'item-1', desc: 'Comprehensive Cardiology Consultation & Clinical BP Review', date: today, amount: 700 },
    { id: 'item-2', desc: 'Ambulatory Blood Pressure Monitoring & Metric Profiling (3x Daily)', date: today, amount: 600 },
    { id: 'item-3', desc: 'Lifestyle & Dietary Sodium Intervention Protocol Guidance', date: today, amount: 500 }
  ];
  invoiceManualTotal = null;

  const sgstInput = document.getElementById('invSgstInput');
  if (sgstInput) sgstInput.value = '0';
  const igstInput = document.getElementById('invIgstInput');
  if (igstInput) igstInput.value = '0';

  syncTaxPills('sgst', 0);
  syncTaxPills('igst', 0);

  const totalInput = document.getElementById('invTotalAmountInput');
  if (totalInput) totalInput.value = 1800;

  renderInvoiceConfigItems();
  renderBillingInvoice();
  showToast('🔄 Reset to default clinic consultation, monitoring charges, and 0% tax.', 'info');
}

/**
 * Shared Export Functionality:
 * Dynamically captures whichever sub-page is currently active (Prescription Pad or Billing Invoice).
 * Exports the clean rectangular DOM element as high-res PNG, cropping out all configuration inputs.
 */
async function downloadReceiptImage() {
  const isInvoice = reportActiveSubPage === 'invoice';
  const padEl = isInvoice
    ? document.getElementById('billingInvoicePad')
    : document.getElementById('prescriptionPad');

  if (!padEl) {
    showToast(`⚠️ ${isInvoice ? 'Billing invoice' : 'Prescription pad'} element not found.`, 'error');
    return;
  }

  const downloadBtn = isInvoice
    ? (document.getElementById('downloadInvoiceBtn') || document.getElementById('downloadImgBtn'))
    : document.getElementById('downloadImgBtn');

  const originalHtml = downloadBtn ? downloadBtn.innerHTML : '';
  if (downloadBtn) {
    downloadBtn.disabled = true;
    downloadBtn.innerHTML = '<span>⏳</span><span>Generating Image...</span>';
  }

  try {
    if (typeof html2canvas === 'undefined') {
      throw new Error('html2canvas library is not loaded');
    }

    // Capture element with 2x scale for crisp print/share quality
    const canvas = await html2canvas(padEl, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      scrollX: 0,
      scrollY: 0,
      onclone: (clonedDoc) => {
        // Ensure input & textarea values are explicitly synchronized in the cloned DOM
        const origInputs = padEl.querySelectorAll('input, textarea');
        const clonedInputs = clonedDoc.querySelectorAll(
          isInvoice ? '#billingInvoicePad input, #billingInvoicePad textarea' : '#prescriptionPad input, #prescriptionPad textarea'
        );
        origInputs.forEach((inp, idx) => {
          if (clonedInputs[idx]) {
            clonedInputs[idx].value = inp.value;
          }
        });
      }
    });

    let patientName = 'Patient';
    let reportDate = getTodayString();

    if (isInvoice) {
      const patInput = document.getElementById('invPatientInput');
      const dateInput = document.getElementById('invDateInput');
      patientName = (patInput?.value || 'Patient').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
      reportDate = (dateInput?.value || getTodayString()).trim().replace(/[^a-zA-Z0-9_-]/g, '-');
    } else {
      const patientInput = document.getElementById('rxPatient');
      const dateInput = document.getElementById('rxDate');
      patientName = (patientInput?.value || 'Patient').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
      reportDate = (dateInput?.value || getTodayString()).trim().replace(/[^a-zA-Z0-9_-]/g, '-');
    }

    const docType = isInvoice ? 'Billing_Invoice' : 'BP_Receipt';
    const fileName = `GS_Clinic_${docType}_${patientName}_${reportDate}.png`;

    const link = document.createElement('a');
    link.download = fileName;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast(`📸 ${isInvoice ? 'Billing Invoice' : 'Prescription pad'} saved as high-res PNG image!`, 'success');
  } catch (err) {
    console.error('Error generating document image:', err);
    showToast('❌ Failed to export image. Please try again or use Print.', 'error');
  } finally {
    if (downloadBtn) {
      downloadBtn.disabled = false;
      downloadBtn.innerHTML = originalHtml;
    }
  }
}

/**
 * Triggers standard browser print dialog for printing or saving as PDF,
 * dynamically applying active sub-page print styles.
 */
function printReceipt() {
  const isInvoice = reportActiveSubPage === 'invoice';
  if (isInvoice) {
    document.body.classList.add('print-invoice-mode');
    document.body.classList.remove('print-rx-mode');
  } else {
    document.body.classList.add('print-rx-mode');
    document.body.classList.remove('print-invoice-mode');
  }

  window.print();

  setTimeout(() => {
    document.body.classList.remove('print-invoice-mode');
    document.body.classList.remove('print-rx-mode');
  }, 1000);
}

// ================================================
//  REFRESH APPLICATION DATA (SOFT RELOAD)
// ================================================
/**
 * Executes a soft reload of the application's state across all pages:
 * Daily Log, Calendar Overview, Analytical Insights, and Report Generator.
 * Triggers a smooth, 360-degree spinning animation on the refresh icon without
 * requiring a full-page browser reload.
 */
function refreshAppData() {
  const icons = document.querySelectorAll('.refresh-icon');

  // Trigger smooth 360-degree spinning animation
  icons.forEach(ic => {
    ic.classList.remove('spinning');
    void ic.offsetWidth; // Reflow to restart CSS animation
    ic.classList.add('spinning');
  });

  const activePage = document.querySelector('.page.active')?.id || 'page-log';

  // Lazy Loading & Performance: Only refresh data for the currently active tab
  if (activePage === 'page-log') {
    loadLogForDate();
  } else if (activePage === 'page-calendar') {
    renderCalendar();
  } else if (activePage === 'page-analytics') {
    renderAnalytics();
  } else if (activePage === 'page-report') {
    if (typeof reportActiveSubPage !== 'undefined' && reportActiveSubPage === 'invoice') {
      renderBillingInvoice();
    } else {
      renderReportPad();
    }
  }

  // Update Fullscreen chart if open
  if (chartFsInstance && currentFullscreenType) {
    switchFullscreenType(currentFullscreenType);
  }

  setTimeout(() => {
    icons.forEach(ic => ic.classList.remove('spinning'));
  }, 750);

  showToast('🔄 Application records refreshed from local storage!', 'success');
}

// ================================================
//  MOBILE QUICK ACTION BUTTON (FAB) & SPEED-DIAL
// ================================================
/**
 * Toggles the Mobile Floating Action Button (FAB) speed-dial menu.
 * When expanded, applies a soft background blur and a dark semi-transparent overlay.
 */
function toggleFabMenu(forceState) {
  const container = document.getElementById('fabContainer');
  const backdrop = document.getElementById('fabBackdrop');
  const mainBtn = document.getElementById('fabMainBtn');
  if (!container || !backdrop) return;

  const willOpen = typeof forceState === 'boolean'
    ? forceState
    : !container.classList.contains('open');

  if (willOpen) {
    container.classList.add('open');
    backdrop.classList.add('active');
    if (mainBtn) mainBtn.setAttribute('aria-expanded', 'true');
  } else {
    container.classList.remove('open');
    backdrop.classList.remove('active');
    if (mainBtn) mainBtn.setAttribute('aria-expanded', 'false');
  }
}

/**
 * FAB Shortcut 1: "Quick Log"
 * Instantly focuses the current time slot's data entry card on the Daily Log page.
 * Evaluates current time:
 * - Morning: Before 12:00
 * - Afternoon: 12:00 to 16:59
 * - Evening: 17:00 onwards
 */
function quickLogAction() {
  toggleFabMenu(false);

  // Navigate to Daily Log
  navigateTo('log');

  // Ensure today's date is active
  const today = getTodayString();
  const logDateInput = document.getElementById('logDate');
  if (logDateInput && logDateInput.value !== today) {
    logDateInput.value = today;
    loadLogForDate();
  }

  // Determine current slot based on current time
  const hour = new Date().getHours();
  let slot = 'morning';
  let cardId = 'card-morning';
  let inputId = 'morn-sys';
  let slotLabel = 'Morning Check-in';

  if (hour >= 12 && hour < 17) {
    slot = 'afternoon';
    cardId = 'card-afternoon';
    inputId = 'aft-sys';
    slotLabel = 'Afternoon Reading';
  } else if (hour >= 17) {
    slot = 'evening';
    cardId = 'card-evening';
    inputId = 'eve-sys';
    slotLabel = 'Evening Check-in';
  }

  const card = document.getElementById(cardId);
  const input = document.getElementById(inputId);

  if (card) {
    // Scroll card smoothly into center view
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Apply whimsical pulse highlight
    card.classList.remove('quick-log-active-pulse');
    void card.offsetWidth;
    card.classList.add('quick-log-active-pulse');
    setTimeout(() => {
      card.classList.remove('quick-log-active-pulse');
    }, 1800);
  }

  if (input) {
    setTimeout(() => {
      input.focus();
      input.select();
    }, 320);
  }

  showToast(`⚡ Quick Log: Focused ${slotLabel}!`, 'info');
}

/**
 * FAB Shortcut 2: "View Trends"
 * Instantly navigates the user to the Analytical Insights page for data visualization.
 */
function quickViewTrendsAction() {
  toggleFabMenu(false);
  navigateTo('analytics');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  showToast('📈 Navigated to Health Analytics', 'info');
}

/**
 * FAB Shortcut 3: "Create Receipt"
 * Instantly navigates the user to the Report Generator to export a receipt.
 */
function quickCreateReceiptAction() {
  toggleFabMenu(false);
  navigateTo('report');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  showToast('🩺 Navigated to Rx Receipt Pad', 'info');
}

// Global key listener to dismiss FAB menu on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const fabContainer = document.getElementById('fabContainer');
    if (fabContainer && fabContainer.classList.contains('open')) {
      toggleFabMenu(false);
    }
  }
});

// Explicit window bindings for inline HTML onclick handlers
window.openChartFullscreen = openChartFullscreen;
window.closeChartFullscreen = closeChartFullscreen;
window.switchFullscreenType = switchFullscreenType;
window.selectDateHighlight = selectDateHighlight;
window.handleAnalyticsDatePick = handleAnalyticsDatePick;
window.handleTimeframeChange = handleTimeframeChange;
window.jumpToDateLog = jumpToDateLog;
window.renderAnalytics = renderAnalytics;
window.navigateTo = navigateTo;
window.toggleTheme = toggleTheme;
window.openClearModal = openClearModal;
window.closeClearModal = closeClearModal;
window.checkDeleteInput = checkDeleteInput;
window.executeCleanAll = executeCleanAll;
window.loadLogForDate = loadLogForDate;
window.saveReadings = saveReadings;
window.changeMonth = changeMonth;
window.closeModal = closeModal;
window.toggleMobileMenu = toggleMobileMenu;

// Report Generator window bindings
window.renderReportPad = renderReportPad;
window.handleCustomDateRangeChange = handleCustomDateRangeChange;
window.applyPresetRange = applyPresetRange;
window.setDataDisplayMode = setDataDisplayMode;
window.togglePrescriptionContent = togglePrescriptionContent;
window.toggleReceiptGraph = toggleReceiptGraph;
window.autofillPrescriptionData = autofillPrescriptionData;
window.downloadReceiptImage = downloadReceiptImage;
window.printReceipt = printReceipt;

// Billing Invoice window bindings
window.switchReportSubPage = switchReportSubPage;
window.handleInvoiceConfigChange = handleInvoiceConfigChange;
window.handleTaxConfigChange = handleTaxConfigChange;
window.setTaxPreset = setTaxPreset;
window.syncTaxPills = syncTaxPills;
window.autoSumInvoiceItems = autoSumInvoiceItems;
window.handleManualTotalAmountInput = handleManualTotalAmountInput;
window.addNewChargeItem = addNewChargeItem;
window.removeChargeItem = removeChargeItem;
window.updateChargeItem = updateChargeItem;
window.autofillInvoiceData = autofillInvoiceData;
window.resetInvoiceDefaults = resetInvoiceDefaults;
window.renderBillingInvoice = renderBillingInvoice;
window.initInvoiceDefaults = initInvoiceDefaults;

// Refresh Data and Mobile FAB Action window bindings
window.refreshAppData = refreshAppData;
window.toggleFabMenu = toggleFabMenu;
window.quickLogAction = quickLogAction;
window.quickViewTrendsAction = quickViewTrendsAction;
window.quickCreateReceiptAction = quickCreateReceiptAction;

// ================================================
//  CLINICAL STATUS TOGGLE (GLOBAL & REPORT GENERATOR)
// ================================================
/**
 * Global toggle for Clinical Status visibility (Normal, Elevated, Hypertension).
 * Synchronizes navbar toggle, mobile menu toggle, and Report Generator control panel toggle.
 * Dynamically updates Daily Log badges, Analytical Insights chart tooltips, and Report Generator receipt body.
 */
function toggleClinicalStatus(visible) {
  isClinicalStatusVisible = !!visible;
  localStorage.setItem(CLINICAL_STATUS_STORAGE_KEY, isClinicalStatusVisible ? 'true' : 'false');
  syncClinicalStatusToggles(isClinicalStatusVisible);

  // 1. Update Daily Log status badges in real-time
  SLOTS.forEach(updateStatusBadge);

  // 2. Refresh charts and tooltips if on Analytics or fullscreen
  if (document.getElementById('page-analytics').classList.contains('active')) {
    renderAnalytics();
  }
  if (chartFsInstance && currentFullscreenType) {
    switchFullscreenType(currentFullscreenType);
  }

  // 3. Re-render Prescription Pad on Report Generator if currently active
  if (document.getElementById('page-report')?.classList.contains('active')) {
    if (typeof reportActiveSubPage !== 'undefined' && reportActiveSubPage === 'invoice') {
      if (typeof renderBillingInvoice === 'function') renderBillingInvoice();
    } else {
      renderReportPad();
    }
  }

  showToast(
    isClinicalStatusVisible
      ? '🩺 Status display enabled (Normal, Elevated, High)'
      : '🔒 Status hidden — private numerical data mode active',
    'info'
  );
}

function syncClinicalStatusToggles(visible) {
  const gToggle = document.getElementById('globalClinicalToggle');
  const mToggle = document.getElementById('mobileClinicalToggle');
  const rToggle = document.getElementById('reportClinicalToggle');

  if (gToggle) gToggle.checked = visible;
  if (mToggle) mToggle.checked = visible;
  if (rToggle) rToggle.checked = visible;
}

window.toggleClinicalStatus = toggleClinicalStatus;
window.syncClinicalStatusToggles = syncClinicalStatusToggles;


// ================================================
//  WINDOW RESIZE DEBOUNCING (SMOOTH GRAPH SCALING)
// ================================================
function debounce(fn, wait = 180) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), wait);
  };
}

const handleWindowResize = debounce(() => {
  // Only resize active charts smoothly if the user is on Analytics or Report page or fullscreen
  if (document.getElementById('page-analytics')?.classList.contains('active')) {
    Object.values(chartInstances).forEach(chart => {
      if (chart && typeof chart.resize === 'function') {
        try { chart.resize(); } catch (e) {}
      }
    });
  }
  if (chartFsInstance && typeof chartFsInstance.resize === 'function') {
    try { chartFsInstance.resize(); } catch (e) {}
  }
  if (receiptChartInstance && typeof receiptChartInstance.resize === 'function' && document.getElementById('page-report')?.classList.contains('active')) {
    try { receiptChartInstance.resize(); } catch (e) {}
  }
}, 180);

window.addEventListener('resize', handleWindowResize, { passive: true });