const form = document.getElementById('scan-form');
const urlInput = document.getElementById('website-url');
const scanBtn = document.getElementById('scan-btn');
const statusEl = document.getElementById('status');
const progressEl = document.getElementById('progress');
const resultsEl = document.getElementById('results');
const tableBody = document.querySelector('#broken-links-table tbody');

let lastReport = null;

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;

  startScan(url);
});

document.getElementById('export-broken').addEventListener('click', () => {
  if (lastReport) exportCsv(lastReport.brokenLinks, 'broken-links.csv');
});

function startScan(url) {
  resultsEl.hidden = true;
  tableBody.innerHTML = '';
  statusEl.textContent = 'Starting scan...';
  progressEl.hidden = false;
  scanBtn.disabled = true;
  document.body.classList.add('is-scanning');

  const source = new EventSource(`/scan-stream?url=${encodeURIComponent(url)}`);

  source.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleProgress(data);

    if (data.phase === 'done') {
      progressEl.hidden = true;
      document.body.classList.remove('is-scanning');
      renderReport(data.report);
      source.close();
      scanBtn.disabled = false;
    }

    if (data.phase === 'error') {
      statusEl.textContent = `Error: ${data.error}`;
      progressEl.hidden = true;
      document.body.classList.remove('is-scanning');
      source.close();
      scanBtn.disabled = false;
    }
  };

  source.onerror = () => {
    statusEl.textContent = 'Connection lost — the site may be too large for a single scan, or the server restarted. Try again, or scan a smaller section.';
    progressEl.hidden = true;
    document.body.classList.remove('is-scanning');
    source.close();
    scanBtn.disabled = false;
  };
}

function handleProgress(data) {
  const progressText = document.getElementById('progress-text');

  if (data.phase === 'crawling') {
    statusEl.textContent = `Crawling website... Pages scanned: ${data.pagesScanned || 0} | Links found: ${data.linksFound || 0}`;
    if (progressText) {
      progressText.textContent = 'Large site detected - this may take a few minutes.';
    }
  }

  if (data.phase === 'validating') {
    statusEl.textContent = `Validating links... ${data.checked || 0} / ${data.uniqueLinks || 0} checked (Remaining: ${data.remaining ?? '-'})`;
    if (progressText) {
      progressText.textContent = `Checking each link one by one - ${data.remaining ?? 0} remaining.`;
    }
  }
}
function renderReport(report) {
  lastReport = report;
  progressEl.hidden = true;
  statusEl.textContent = 'Scan complete.';

  animateCounter('stat-pages', report.pagesScanned);
  animateCounter('stat-links', report.uniqueLinksChecked);
  animateCounter('stat-broken', report.brokenLinksCount);

  const coverageNote = document.getElementById('coverage-note');
  if (coverageNote && report.sitemapUrlsFound !== undefined) {
    coverageNote.textContent = `Sitemap found ${report.sitemapUrlsFound} pages · ${report.pagesScanned} scanned`;
  }

  resultsEl.hidden = false;

  tableBody.innerHTML = '';
  if (report.brokenLinks.length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = `<td colspan="4" class="empty-state"><span class="empty-check">&#10003;</span>All clear — no broken links found</td>`;
    tableBody.appendChild(row);
    return;
  }

  report.brokenLinks.forEach((item, idx) => {
    const row = document.createElement('tr');
    row.style.setProperty('--i', idx);
    row.innerHTML = `
      <td><a href="${escapeAttr(item.sourcePage)}" target="_blank" rel="noopener">${escapeHtml(item.sourcePage)}</a></td>
      <td><a href="${escapeAttr(item.brokenUrl)}" target="_blank" rel="noopener">${escapeHtml(item.brokenUrl)}</a></td>
      <td>${badgeForStatus(item.status)}</td>
      <td>${escapeHtml(item.statusText)}</td>
    `;
    tableBody.appendChild(row);
  });
}

function badgeForStatus(status) {
  const str = String(status);
  const redStatuses = [
    '404',
    '410',
    'DNS_ERROR',
    'CONNECTION_REFUSED',
    'SOFT_404',
    'REDIRECTED_TO_HOME',
  ];
  const cls = redStatuses.includes(str) ? 'badge-red' : 'badge-orange';

  return `<span class="badge ${cls}">${escapeHtml(str)}</span>`;
}

function exportCsv(rows, filename) {
  if (!rows || rows.length === 0) return;

  const header = ['Source Page', 'Broken URL', 'Status', 'Reason'];
  const csvRows = [header.join(',')];

  rows.forEach((item) => {
    const line = [item.sourcePage, item.brokenUrl, item.status, item.statusText]
      .map((val) => `"${String(val).replace(/"/g, '""')}"`)
      .join(',');
    csvRows.push(line);
  });

  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}

function animateCounter(elementId, target) {
  const el = document.getElementById(elementId);
  if (!el) return;

  const duration = 700;
  const start = performance.now();

  function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(eased * target);

    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      el.textContent = target;
      el.classList.remove('count-done');
      void el.offsetWidth;
      el.classList.add('count-done');
    }
  }

  requestAnimationFrame(tick);
}

// --- Premium interaction effects ---

// 1. Cursor-following spotlight across the whole page background.
(function setupCursorSpotlight() {
  let active = false;

  window.addEventListener('mousemove', (e) => {
    document.documentElement.style.setProperty('--mx', `${e.clientX}px`);
    document.documentElement.style.setProperty('--my', `${e.clientY}px`);

    if (!active) {
      active = true;
      document.body.classList.add('cursor-active');
    }
  });

  window.addEventListener('mouseleave', () => {
    active = false;
    document.body.classList.remove('cursor-active');
  });
})();

// 2. Subtle 3D tilt on the search form and stat cards as the mouse moves
// over them - the element leans slightly toward the cursor.
function attachTilt(el) {
  if (!el) return;
  el.classList.add('tilt-card');

  el.addEventListener('mousemove', (e) => {
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;

    el.style.setProperty('--rx', `${px * 6}deg`);
    el.style.setProperty('--ry', `${-py * 6}deg`);
  });

  el.addEventListener('mouseleave', () => {
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  });
}

attachTilt(document.querySelector('.scan-form'));
document.querySelectorAll('.metric').forEach(attachTilt);

// 3. Magnetic pull on the scan button - it shifts a few pixels toward the
// cursor when nearby, and snaps back on mouse leave.
(function setupMagneticButton() {
  const btn = document.getElementById('scan-btn');
  if (!btn) return;

  btn.addEventListener('mousemove', (e) => {
    const rect = btn.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;

    btn.style.setProperty('--btn-x', `${x * 0.15}px`);
    btn.style.setProperty('--btn-y', `${y * 0.15}px`);
    btn.style.setProperty('--btn-scale', '1.03');
  });

  btn.addEventListener('mouseleave', () => {
    btn.style.setProperty('--btn-x', '0px');
    btn.style.setProperty('--btn-y', '0px');
    btn.style.setProperty('--btn-scale', '1');
  });
})();

// 4. Ripple effect spawned from the exact click point on the scan button.
(function setupRipple() {
  const btn = document.getElementById('scan-btn');
  if (!btn) return;

  btn.style.position = 'relative';
  btn.style.overflow = 'hidden';

  btn.addEventListener('click', (e) => {
    const rect = btn.getBoundingClientRect();
    const ripple = document.createElement('span');
    const size = Math.max(rect.width, rect.height);

    ripple.classList.add('ripple');
    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${e.clientY - rect.top - size / 2}px`;

    btn.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  });
})();

// 5. Small bounce on the ">" prompt glyph each time the user types.
(function setupGlyphPulse() {
  const input = document.getElementById('website-url');
  const glyph = document.querySelector('.prompt-glyph');
  if (!input || !glyph) return;

  let timeout;
  input.addEventListener('input', () => {
    glyph.classList.remove('pulse');
    void glyph.offsetWidth; // restart animation
    glyph.classList.add('pulse');
    clearTimeout(timeout);
    timeout = setTimeout(() => glyph.classList.remove('pulse'), 300);
  });
})();