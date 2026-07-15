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
    statusEl.textContent = 'Connection lost. Please try again.';
    progressEl.hidden = true;
    document.body.classList.remove('is-scanning');
    source.close();
    scanBtn.disabled = false;
  };
}

function handleProgress(data) {
  if (data.phase === 'crawling') {
    statusEl.textContent = `Crawling website... Pages scanned: ${data.pagesScanned || 0} | Links found: ${data.linksFound || 0}`;
  }

  if (data.phase === 'validating') {
    statusEl.textContent = `Checking links... ${data.checked || 0} / ${data.uniqueLinks || 0} checked (Remaining: ${data.remaining ?? '-'})`;
  }
}

function renderReport(report) {
  lastReport = report;
  progressEl.hidden = true;
  statusEl.textContent = 'Scan complete.';

  document.getElementById('stat-pages').textContent = report.pagesScanned;
  document.getElementById('stat-links').textContent = report.uniqueLinksChecked;
  document.getElementById('stat-broken').textContent = report.brokenLinksCount;

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
  const cls = str === '404' ? 'badge-red' : 'badge-orange'; // 403
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