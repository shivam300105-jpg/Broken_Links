const IGNORED_PREFIXES = ['mailto:', 'tel:', 'javascript:', 'sms:', 'whatsapp:'];
const IGNORED_PATH_SEGMENTS = ['cdn', 'cart', 'checkout', 'account'];

const TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'fbclid', 'gclid'];

const LISTING_PARAMS_PREFIXES = ['filter.', 'sort_by', 'page', 'constructor', 'pf_', 'grid_list', 'variant'];
const LISTING_PARAMS_EXACT = ['q'];

export function normalizeUrl(rawHref, baseUrl) {
  if (!rawHref) return null;

  const trimmed = rawHref.trim();
  if (!trimmed || trimmed === '#') return null;

  if (IGNORED_PREFIXES.some((prefix) => trimmed.toLowerCase().startsWith(prefix))) {
    return null;
  }

  let absolute;
  try {
    absolute = new URL(trimmed, baseUrl);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(absolute.protocol)) return null;

  absolute.hash = '';
  TRACKING_PARAMS.forEach((param) => absolute.searchParams.delete(param));

  let finalUrl = absolute.toString();
  if (finalUrl.endsWith('/') && absolute.pathname !== '/') {
    finalUrl = finalUrl.slice(0, -1);
  }

  return finalUrl;
}

export function getCrawlKey(url) {
  try {
    const parsed = new URL(url);
    const keysToDelete = [];
    for (const key of parsed.searchParams.keys()) {
      const lower = key.toLowerCase();
      if (
        LISTING_PARAMS_PREFIXES.some((p) => lower.startsWith(p)) ||
        LISTING_PARAMS_EXACT.includes(lower)
      ) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach((k) => parsed.searchParams.delete(k));
    return parsed.origin + parsed.pathname + (parsed.search || '');
  } catch {
    return url;
  }
}

export function shouldIgnore(url) {
  if (!url) return true;
  try {
    const { pathname } = new URL(url);
    const segments = pathname.toLowerCase().split('/').filter(Boolean);
    return IGNORED_PATH_SEGMENTS.some((seg) => segments.includes(seg));
  } catch {
    return true;
  }
}

export function isInternalLink(url, baseDomain) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '') === baseDomain.replace(/^www\./, '');
  } catch {
    return false;
  }
}

export function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
