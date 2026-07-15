import { crawlWebsite } from '../crawler/crawler.js';
import { validateLinksBatch } from '../validator/validator.js';

const VALIDATION_CONCURRENCY = 30;

// 404/403 = confirmed dead page. DNS_ERROR = domain doesn't resolve at all,
// which is also permanent (unlike TIMEOUT/500 which can be transient).
const BROKEN_NUMERIC_STATUSES = new Set([404, 403]);
const BROKEN_STRING_STATUSES = new Set(['DNS_ERROR']);

function isBroken(status) {
  return BROKEN_NUMERIC_STATUSES.has(status) || BROKEN_STRING_STATUSES.has(status);
}
/**
 * Full scan pipeline: crawl (internal pages only) -> dedupe -> validate ->
 * keep only real broken links (404 / 403) -> build report.
 *
 * @param {string} url - starting URL of the website to scan
 * @param {function} onProgress - optional callback for live updates (SSE route)
 */
export async function startScan(url, onProgress = () => {}) {
  onProgress({ phase: 'crawling', pagesScanned: 0, linksFound: 0 });

  const { pagesScanned, discoveredLinks } = await crawlWebsite(url, (progress) => {
    onProgress({ phase: 'crawling', ...progress });
  });

  // Dedupe: validate each unique internal link only once
  const uniqueLinkMap = new Map(); // link -> sourcePage
  for (const { sourcePage, link } of discoveredLinks) {
    if (!uniqueLinkMap.has(link)) {
      uniqueLinkMap.set(link, sourcePage);
    }
  }

  const uniqueLinks = Array.from(uniqueLinkMap.keys());

  onProgress({
    phase: 'validating',
    pagesScanned,
    linksFound: discoveredLinks.length,
    uniqueLinks: uniqueLinks.length,
    checked: 0,
    remaining: uniqueLinks.length,
  });

  const results = await validateLinksBatch(uniqueLinks, VALIDATION_CONCURRENCY, ({ checked, total }) => {
    onProgress({
      phase: 'validating',
      pagesScanned,
      linksFound: discoveredLinks.length,
      uniqueLinks: uniqueLinks.length,
      checked,
      remaining: total - checked,
    });
  });

  const brokenLinks = results
    .filter((r) => isBroken(r.status))
    .map((r) => ({
      sourcePage: uniqueLinkMap.get(r.url),
      brokenUrl: r.url,
      status: r.status,
      statusText: r.statusText,
    }));

  const report = {
    success: true,
    website: url,
    pagesScanned,
    totalLinks: discoveredLinks.length,
    uniqueLinksChecked: uniqueLinks.length,
    brokenLinksCount: brokenLinks.length,
    brokenLinks,
  };

  onProgress({ phase: 'done', report });

  return report;
}