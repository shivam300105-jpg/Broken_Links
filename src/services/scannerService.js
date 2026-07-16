import { crawlWebsite } from '../crawler/crawler.js';
import { validateLinksBatch } from '../validator/validator.js';

const VALIDATION_CONCURRENCY = 30;

const BROKEN_NUMERIC_STATUSES = new Set([404, 403, 410]);
const BROKEN_STRING_STATUSES = new Set([
  'DNS_ERROR',
  'CONNECTION_REFUSED',
  'SSL_ERROR',
  'SOFT_404',
  'REDIRECTED_TO_HOME',
]);

function isBroken(status) {
  if (typeof status === 'number') return BROKEN_NUMERIC_STATUSES.has(status);
  return BROKEN_STRING_STATUSES.has(status);
}

const MAX_LINKS_TO_VALIDATE = 4000; // similar safety cap to what commercial tools use on free tiers

export async function startScan(url, onProgress = () => {}) {
  onProgress({ phase: 'crawling', pagesScanned: 0, linksFound: 0 });

  const { pagesScanned, discoveredLinks, sitemapUrlsFound } = await crawlWebsite(url, (progress) => {
    onProgress({ phase: 'crawling', ...progress });
  });

  const uniqueLinkMap = new Map();
  for (const { sourcePage, link } of discoveredLinks) {
    if (!uniqueLinkMap.has(link)) {
      uniqueLinkMap.set(link, sourcePage);
    }
  }

  let uniqueLinks = Array.from(uniqueLinkMap.keys());
  const cappedNote = uniqueLinks.length > MAX_LINKS_TO_VALIDATE;
  if (cappedNote) {
    uniqueLinks = uniqueLinks.slice(0, MAX_LINKS_TO_VALIDATE);
  }

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

  // TEMPORARY DEBUG - keep for one more run to confirm the fix, then remove
  const statusCounts = {};
  results.forEach((r) => {
    const key = String(r.status);
    statusCounts[key] = (statusCounts[key] || 0) + 1;
  });
  console.log('--- STATUS BREAKDOWN ---', statusCounts);

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
    sitemapUrlsFound,
    totalLinks: discoveredLinks.length,
    uniqueLinksChecked: uniqueLinks.length,
    cappedAt: cappedNote ? MAX_LINKS_TO_VALIDATE : null,
    brokenLinksCount: brokenLinks.length,
    brokenLinks,
  };

  onProgress({ phase: 'done', report });

  return report;
}