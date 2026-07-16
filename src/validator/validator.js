import axios from 'axios';

const VALIDATION_TIMEOUT_MS = 8000;

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const MIN_INTERVAL_MS = 35;
let throttleChain = Promise.resolve();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function throttledSlot() {
  const next = throttleChain.then(() => delay(MIN_INTERVAL_MS));
  throttleChain = next;
  return next;
}

const STATUS_TEXT_MAP = {
  404: 'Not Found',
  410: 'Gone',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

function mapStatusText(code) {
  return STATUS_TEXT_MAP[code] || `HTTP ${code}`;
}

function classifyError(err) {
  if (err.code === 'ECONNABORTED' || err.message?.toLowerCase().includes('timeout')) {
    return { status: 'TIMEOUT', statusText: 'Request Timeout' };
  }
  if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
    return { status: 'DNS_ERROR', statusText: 'Domain Not Found' };
  }
  if (err.code === 'ECONNREFUSED') {
    return { status: 'CONNECTION_REFUSED', statusText: 'Connection Refused' };
  }
  if ((err.code && err.code.startsWith('ERR_TLS')) || err.code === 'CERT_HAS_EXPIRED') {
    return { status: 'SSL_ERROR', statusText: 'SSL Certificate Error' };
  }
  return { status: 'FAILED', statusText: err.message || 'Unknown Error' };
}

const RETRYABLE_ERROR_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED']);

async function requestWithRetry(url, retriesLeft = 1) {
  await throttledSlot();

  try {
    const response = await axios.get(url, {
      timeout: VALIDATION_TIMEOUT_MS,
      headers: HEADERS,
      maxRedirects: 5,
      validateStatus: () => true,
    });
    return { response, err: null };
  } catch (err) {
    if (RETRYABLE_ERROR_CODES.has(err.code) && retriesLeft > 0) {
      await delay(600);
      return requestWithRetry(url, retriesLeft - 1);
    }
    return { response: null, err };
  }
}

// Many stores redirect deleted collection/product URLs straight to the
// homepage instead of returning a real 404. This function detects that
// pattern by comparing the requested path to where axios actually ended up
// after following redirects.
function getFinalUrl(response) {
  return response?.request?.res?.responseUrl || null;
}

function isRedirectedToHome(originalUrl, response) {
  const finalUrl = getFinalUrl(response);
  if (!finalUrl) return false;

  try {
    const orig = new URL(originalUrl);
    const final = new URL(finalUrl);
    const origPath = orig.pathname.replace(/\/$/, '') || '/';
    const finalPath = final.pathname.replace(/\/$/, '') || '/';
    return origPath !== '/' && finalPath === '/';
  } catch {
    return false;
  }
}

// Some themes return HTTP 200 for a deleted page but the body itself says
// "page not found" - a soft 404. Checking the rendered text catches these
// even though the status code alone looks fine.
const SOFT_404_PATTERNS = [
  /page not found/i,
  /404[\s-]*(not found|error)/i,
  /couldn't find (that|this) page/i,
  /we can(no|')t find the page/i,
  /this page (is|was) unavailable/i,
  /oops[!,]? .*page/i,
];

function isSoft404(html) {
  if (!html || typeof html !== 'string') return false;
  return SOFT_404_PATTERNS.some((re) => re.test(html));
}

export async function validateLink(url, retriesLeft = 2) {
  const { response, err } = await requestWithRetry(url);

  if (err) {
    const { status, statusText } = classifyError(err);
    return { url, status, statusText, broken: true };
  }

  if (response.status === 429) {
    if (retriesLeft > 0) {
      const retryAfterHeader = response.headers['retry-after'];
      const waitMs = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : 1500;
      await delay(waitMs);
      return validateLink(url, retriesLeft - 1);
    }
    return { url, status: response.status, statusText: 'Rate Limited (Skipped)', broken: false };
  }

  if (response.status >= 400) {
    return {
      url,
      status: response.status,
      statusText: mapStatusText(response.status),
      broken: true,
    };
  }

  if (isRedirectedToHome(url, response)) {
    return {
      url,
      status: 'REDIRECTED_TO_HOME',
      statusText: 'Redirects to homepage (likely a deleted page)',
      broken: true,
    };
  }

  const contentType = response.headers['content-type'] || '';
  if (contentType.includes('text/html') && isSoft404(response.data)) {
    return { url, status: 'SOFT_404', statusText: 'Page not found (soft 404)', broken: true };
  }

  return { url, status: response.status, statusText: 'OK', broken: false };
}

export async function validateLinksBatch(urls, concurrency = 25, onProgress = () => {}) {
  const results = new Array(urls.length);
  let index = 0;
  let checked = 0;

  async function worker() {
    while (index < urls.length) {
      const currentIndex = index;
      index += 1;
      const url = urls[currentIndex];

      const result = await validateLink(url);
      results[currentIndex] = result;

      checked += 1;
      onProgress({ checked, total: urls.length, result });
    }
  }

  const workerCount = Math.min(concurrency, urls.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  return results;
}