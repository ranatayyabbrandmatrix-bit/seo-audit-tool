// Fetches a single page or crawls a whole site (same host, BFS + sitemap seeds).
import * as cheerio from 'cheerio';

const UA = 'Mozilla/5.0 (compatible; SEO-GEO-AuditBot/1.0; +https://example.com/bot)';

export function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('Please enter a URL');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  const u = new URL(s);
  u.hash = '';
  return u.toString();
}

export async function fetchUrl(url, { timeout = 15000, method = 'GET' } = {}) {
  const started = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  const redirects = [];
  let current = url;
  try {
    // follow redirects manually so we can record the chain
    for (let i = 0; i < 8; i++) {
      const res = await fetch(current, {
        method,
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'en' }
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        const next = new URL(res.headers.get('location'), current).toString();
        redirects.push({ from: current, to: next, status: res.status });
        current = next;
        continue;
      }
      const body = method === 'HEAD' ? '' : await res.text();
      return {
        url, finalUrl: current, status: res.status, ok: res.ok, redirects,
        headers: Object.fromEntries(res.headers.entries()),
        body, bytes: Buffer.byteLength(body), ms: Date.now() - started
      };
    }
    throw new Error('Too many redirects');
  } catch (e) {
    return { url, finalUrl: current, status: 0, ok: false, redirects, headers: {}, body: '', bytes: 0, ms: Date.now() - started, error: e.name === 'AbortError' ? 'Timed out' : e.message };
  } finally {
    clearTimeout(t);
  }
}

const SKIP_EXT = /\.(jpg|jpeg|png|gif|webp|svg|ico|pdf|zip|rar|mp4|mp3|avi|mov|css|js|json|xml|txt|woff2?|ttf|eot|docx?|xlsx?|pptx?)(\?|$)/i;

export function extractLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  const out = [];
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href');
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) return;
    try {
      const u = new URL(href, baseUrl);
      u.hash = '';
      out.push({ url: u.toString(), text: $(a).text().trim().slice(0, 120), rel: $(a).attr('rel') || '' });
    } catch {}
  });
  return out;
}

async function sitemapUrls(origin, robotsTxt, limit) {
  const candidates = new Set([origin + '/sitemap.xml', origin + '/sitemap_index.xml']);
  for (const m of (robotsTxt || '').matchAll(/^\s*sitemap:\s*(\S+)/gim)) candidates.add(m[1]);
  const found = new Set();
  const queue = [...candidates];
  const seen = new Set();
  const sitemaps = [];
  while (queue.length && found.size < limit && seen.size < 10) {
    const sm = queue.shift();
    if (seen.has(sm)) continue;
    seen.add(sm);
    const r = await fetchUrl(sm, { timeout: 12000 });
    if (!r.ok || !/<(urlset|sitemapindex)/i.test(r.body)) continue;
    sitemaps.push(sm);
    const locs = [...r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1].replace(/&amp;/g, '&'));
    if (/<sitemapindex/i.test(r.body)) queue.push(...locs);
    else locs.forEach(l => found.size < limit && found.add(l));
  }
  return { urls: [...found], sitemaps };
}

/**
 * mode: 'page' | 'site'
 * onProgress(msg, pct)
 */
export async function crawl(startUrl, { mode = 'page', maxPages = 25, onProgress = () => {} } = {}) {
  let start = normalizeUrl(startUrl);
  // If HTTPS is unreachable and the user didn't explicitly type https, fall back to HTTP
  if (start.startsWith('https://') && !/^https:/i.test(String(startUrl).trim())) {
    const probe = await fetchUrl(start, { timeout: 10000, method: 'HEAD' });
    if (probe.status === 0) start = start.replace(/^https:/, 'http:');
  }
  const origin = new URL(start).origin;
  const host = new URL(start).host.replace(/^www\./, '');

  onProgress('Fetching robots.txt, sitemap and llms.txt', 3);
  const [robots, llms] = await Promise.all([
    fetchUrl(origin + '/robots.txt', { timeout: 10000 }),
    fetchUrl(origin + '/llms.txt', { timeout: 10000 })
  ]);
  const robotsTxt = robots.ok && !/<html/i.test(robots.body) ? robots.body : '';
  const sm = await sitemapUrls(origin, robotsTxt, mode === 'site' ? maxPages * 4 : 50);

  const pages = [];
  const seen = new Set();
  const queue = [start];
  const sameHost = u => { try { return new URL(u).host.replace(/^www\./, '') === host; } catch { return false; } };
  if (mode === 'site') sm.urls.filter(sameHost).forEach(u => queue.push(u));

  const limit = mode === 'site' ? maxPages : 1;
  while (queue.length && pages.length < limit) {
    const url = queue.shift();
    const key = url.replace(/\/$/, '');
    if (seen.has(key) || SKIP_EXT.test(url) || !sameHost(url)) continue;
    seen.add(key);
    onProgress(`Crawling ${pages.length + 1}/${limit}: ${url}`, 5 + Math.round((pages.length / limit) * 45));
    const r = await fetchUrl(url);
    const isHtml = /html/i.test(r.headers['content-type'] || '') || /<html/i.test(r.body.slice(0, 2000));
    if (r.ok && !isHtml) continue;
    pages.push(r);
    if (mode === 'site' && r.ok) {
      for (const l of extractLinks(r.body, r.finalUrl)) {
        if (sameHost(l.url) && !seen.has(l.url.replace(/\/$/, '')) && !SKIP_EXT.test(l.url)) queue.push(l.url);
      }
    }
  }

  // HTTP -> HTTPS check on the homepage
  let httpRedirectsToHttps = null;
  if (start.startsWith('https://')) {
    const h = await fetchUrl(start.replace(/^https:/, 'http:'), { timeout: 8000, method: 'HEAD' });
    httpRedirectsToHttps = h.finalUrl.startsWith('https://');
  }

  return {
    startUrl: start, origin, host, mode, pages,
    robots: { status: robots.status, text: robotsTxt },
    llms: { status: llms.status, exists: llms.ok && !/<html/i.test(llms.body.slice(0, 500)), text: llms.ok ? llms.body.slice(0, 4000) : '' },
    sitemap: { found: sm.sitemaps, urlCount: sm.urls.length },
    httpRedirectsToHttps
  };
}
