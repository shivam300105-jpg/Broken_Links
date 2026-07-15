// src/validator/validator.js
import axios from 'axios';

const VALIDATION_TIMEOUT_MS = 8000;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; BrokenLinkScanner/1.0)',
};

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

/**
 * Turn an axios error (no response received) into a clear status label.
 */
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

/**
 * Validate a single URL. Tries HEAD first (cheap), falls back to GET
 * because some servers/CDNs reject or mishandle HEAD requests.
 */
export async function validateLink(url) {
  try {
    const response = await axios.head(url, {
      timeout: VALIDATION_TIMEOUT_MS,
      headers: HEADERS,
      maxRedirects: 5,
      validateStatus: () => true,
    });

    if (response.status >= 400) {
      // Confirm with GET before flagging - some servers just don't support HEAD (405/403)
      return await validateWithGet(url);
    }

    return { url, status: response.status, statusText: 'OK', broken: false };
  } catch {
    return await validateWithGet(url);
  }
}

async function validateWithGet(url) {
  try {
    const response = await axios.get(url, {
      timeout: VALIDATION_TIMEOUT_MS,
      headers: HEADERS,
      maxRedirects: 5,
      validateStatus: () => true,
    });

    // 403 can be a transient bot-protection blip - confirm it's persistent
    // before flagging, so a one-off block doesn't get reported as broken.
    if (response.status === 403) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const confirm = await axios.get(url, {
        timeout: VALIDATION_TIMEOUT_MS,
        headers: HEADERS,
        maxRedirects: 5,
        validateStatus: () => true,
      });
      if (confirm.status !== 403) {
        return { url, status: confirm.status, statusText: confirm.status >= 400 ? mapStatusText(confirm.status) : 'OK', broken: confirm.status >= 400 };
      }
    }

    const broken = response.status >= 400;
    return {
      url,
      status: response.status,
      statusText: broken ? mapStatusText(response.status) : 'OK',
      broken,
    };
  } catch (err) {
    const { status, statusText } = classifyError(err);
    return { url, status, statusText, broken: true };
  }
}

/**
 * Validate many links concurrently using a fixed-size worker pool.
 * Prevents firing hundreds of requests at once (which causes 429s/timeouts)
 * while still being much faster than a sequential for-loop.
 *
 * @param {string[]} urls - unique urls to validate
 * @param {number} concurrency - how many requests to run in parallel
 * @param {function} onProgress - callback({ checked, total, result })
 */
export async function validateLinksBatch(urls, concurrency = 20, onProgress = () => {}) {
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