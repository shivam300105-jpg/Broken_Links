import axios from 'axios';
import { Queue } from './queue.js';
import { extractLinks } from '../parser/extractLinks.js';
import { isInternalLink, shouldIgnore, getDomain, getCrawlKey } from '../utils/urlHelper.js';

const MAX_PAGES = 800;
const PAGE_TIMEOUT_MS = 9000;
const CRAWL_CONCURRENCY = 10;
const MIN_INTERVAL_MS = 40;

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Global throttle - all workers share this, so no matter how many run in
// parallel, requests never go out faster than MIN_INTERVAL_MS apart. This
// is what keeps results consistent across repeated scans of the same site.
let throttleChain = Promise.resolve();
function throttledSlot() {
  const next = throttleChain.then(() => delay(MIN_INTERVAL_MS));
  throttleChain = next;
  return next;
}

// Retry once before giving up. Most timeouts are transient (server was
// briefly slow), not a genuinely dead page - without this, a page can
// succeed on one scan and fail on the next, changing the final counts.
async function fetchWithRetry(url, retriesLeft = 1) {
  await throttledSlot();

  try {
    const response = await axios.get(url, {
      timeout: PAGE_TIMEOUT_MS,
      headers: HEADERS,
      validateStatus: () => true,
    });

    if (response.status >= 400) return null;
    return response;
  } catch {
    if (retriesLeft > 0) {
      await delay(500);
      return fetchWithRetry(url, retriesLeft - 1);
    }
    return null;
  }
}

async function fetchHtml(url) {
  const response = await fetchWithRetry(url);
  if (!response) return null;

  const contentType = response.headers['content-type'] || '';
  if (!contentType.includes('text/html')) return null;

  return response.data;
}

async function fetchXml(url) {
  const response = await fetchWithRetry(url);
  if (!response || typeof response.data !== 'string') return null;
  return response.data;
}

/**
 * Most modern websites expose a full sitemap at /sitemap.xml (often an
 * index pointing to further sub-sitemaps). Pulling every URL from it gives
 * near-complete page coverage up front, instead of relying only on following
 * links from the homepage - which can miss pages that aren't linked from
 * anywhere reachable within MAX_PAGES.
 */
async function getSitemapUrls(baseUrl) {
  const domain = getDomain(baseUrl);
  const rootXml = await fetchXml(`https://${domain}/sitemap.xml`);
  if (!rootXml) return [];

  const locs = [...rootXml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1].trim());
  const subSitemaps = locs.filter((u) => u.endsWith('.xml'));
  const directUrls = locs.filter((u) => !u.endsWith('.xml'));

  const urls = new Set(directUrls);

  for (const sub of subSitemaps.slice(0, 30)) {
    const xml = await fetchXml(sub);
    if (!xml) continue;
    const subLocs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1].trim());
    subLocs.forEach((u) => {
      if (!u.endsWith('.xml')) urls.add(u);
    });
  }

  return Array.from(urls);
}

/**
 * Crawl an entire website (BFS, concurrent workers), seeded with the
 * full sitemap for complete coverage. Only INTERNAL links are collected -
 * external links are intentionally ignored.
 */
export async function crawlWebsite(startUrl, onProgress = () => {}) {
  const baseDomain = getDomain(startUrl);
  const queue = new Queue();
  const visited = new Set();
  const visitedCrawlKeys = new Set();
  const discoveredLinks = []; // internal links only: { sourcePage, link }
  const linkKeySet = new Set();

  queue.enqueue(startUrl);
  visitedCrawlKeys.add(getCrawlKey(startUrl));

  const sitemapUrls = await getSitemapUrls(startUrl);
  for (const url of sitemapUrls) {
    if (!isInternalLink(url, baseDomain)) continue;
    if (shouldIgnore(url)) continue;
    const crawlKey = getCrawlKey(url);
    if (!visitedCrawlKeys.has(crawlKey) && queue.size < MAX_PAGES) {
      visitedCrawlKeys.add(crawlKey);
      queue.enqueue(url);
    }
  }

  let pagesScanned = 0;
  let activeFetches = 0;

  async function worker() {
    while (pagesScanned < MAX_PAGES) {
      if (queue.isEmpty()) {
        if (activeFetches === 0) return;
        await delay(40);
        continue;
      }

      const currentUrl = queue.dequeue();
      if (!currentUrl || visited.has(currentUrl)) continue;
      visited.add(currentUrl);

      activeFetches += 1;
      const html = await fetchHtml(currentUrl);
      activeFetches -= 1;

      if (!html) continue;

      pagesScanned += 1;

      const rawLinks = extractLinks(html, currentUrl);

      for (const link of rawLinks) {
        if (shouldIgnore(link)) continue;

        const internal = isInternalLink(link, baseDomain);
        if (!internal) continue;

        const key = `${currentUrl}|${link}`;
        if (!linkKeySet.has(key)) {
          linkKeySet.add(key);
          discoveredLinks.push({ sourcePage: currentUrl, link });
        }

        const crawlKey = getCrawlKey(link);

        if (
          !visited.has(link) &&
          !queue.contains(link) &&
          !visitedCrawlKeys.has(crawlKey) &&
          pagesScanned + queue.size < MAX_PAGES
        ) {
          visitedCrawlKeys.add(crawlKey);
          queue.enqueue(link);
        }
      }

      onProgress({
        pagesScanned,
        linksFound: discoveredLinks.length,
        currentUrl,
      });
    }
  }

  const workers = Array.from({ length: CRAWL_CONCURRENCY }, () => worker());
  await Promise.all(workers);

  return { pagesScanned, discoveredLinks };
}