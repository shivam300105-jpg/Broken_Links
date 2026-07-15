// src/parser/extractLinks.js
import * as cheerio from 'cheerio';
import { normalizeUrl } from '../utils/urlHelper.js';

/**
 * Extract every <a href> from an HTML page and normalize it against baseUrl.
 * Returns an array of absolute URLs. Duplicates are possible - caller dedupes.
 */
export function extractLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  const links = [];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const normalized = normalizeUrl(href, baseUrl);
    if (normalized) {
      links.push(normalized);
    }
  });

  return links;
}