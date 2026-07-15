# Broken Link Scanner

Crawls any website, checks every internal link, and reports only confirmed
broken links (404 / 403). Live progress via Server-Sent Events.

## Setup

```bash
npm install
node src/app.js
```

Then open `http://localhost:3000`.

## Tech Stack

- Node.js (ESM) + Express
- Axios (HTTP requests)
- Cheerio (HTML parsing)
- Vanilla JS + HTML + CSS (frontend)

## How it works

1. Seeds the crawl queue from the site's `/sitemap.xml` (if available) for
   full coverage.
2. Crawls every internal page concurrently, extracting internal links.
3. Deduplicates links, then validates each one (HEAD → GET fallback) with
   proper error classification.
4. Reports only real broken links — 404 and 403 — with the source page each
   was found on.