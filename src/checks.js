// Deterministic SEO + GEO checks. Each check: {id, cat, title, status, detail, fix, weight}
import * as cheerio from 'cheerio';
import { extractLinks } from './crawler.js';

export const CATEGORIES = {
  technical: 'Technical SEO',
  onpage: 'On-page SEO',
  content: 'Content quality',
  performance: 'Speed & mobile',
  schema: 'Structured data',
  geo: 'GEO / AI search readiness'
};

const AI_BOTS = [
  { ua: 'GPTBot', who: 'OpenAI (ChatGPT training)' },
  { ua: 'OAI-SearchBot', who: 'ChatGPT Search' },
  { ua: 'ChatGPT-User', who: 'ChatGPT browsing' },
  { ua: 'ClaudeBot', who: 'Anthropic Claude' },
  { ua: 'Claude-SearchBot', who: 'Claude search' },
  { ua: 'PerplexityBot', who: 'Perplexity' },
  { ua: 'Google-Extended', who: 'Google Gemini / AI' },
  { ua: 'Bingbot', who: 'Bing / Copilot' },
  { ua: 'Applebot-Extended', who: 'Apple Intelligence' },
  { ua: 'CCBot', who: 'Common Crawl (used by many LLMs)' }
];

const c = (cat, id, title, status, detail, fix = '', weight = 2) => ({ cat, id, title, status, detail, fix, weight });

// ---------- robots.txt parsing ----------
function robotsGroups(txt) {
  const groups = [];
  let cur = null;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^(user-agent|disallow|allow)\s*:\s*(.*)$/i);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') {
      if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(v.toLowerCase());
    } else if (cur) cur.rules.push({ type: k, path: v });
  }
  return groups;
}
export function isBlockedForAgent(txt, agent, path = '/') {
  const groups = robotsGroups(txt || '');
  const a = agent.toLowerCase();
  let g = groups.filter(g => g.agents.some(x => x !== '*' && a.includes(x)));
  if (!g.length) g = groups.filter(g => g.agents.includes('*'));
  const rules = g.flatMap(x => x.rules).filter(r => r.path !== '' || r.type === 'allow');
  let best = null;
  for (const r of rules) {
    const p = r.path.replace(/\*/g, '');
    if (r.path === '' ) continue;
    if (path.startsWith(p) && (!best || p.length > best.len || (p.length === best.len && r.type === 'allow'))) best = { len: p.length, type: r.type };
  }
  return best ? best.type === 'disallow' : false;
}

// ---------- per page ----------
export function analyzePage(page, ctx) {
  const checks = [];
  const facts = { url: page.finalUrl, status: page.status, ms: page.ms, bytes: page.bytes };
  if (!page.ok) {
    checks.push(c('technical', 'status', 'Page loads successfully', 'fail', `HTTP ${page.status || 'error'} ${page.error || ''}`.trim(), 'Fix the server error or broken URL; return 200 for indexable pages.', 5));
    return { facts, checks };
  }
  const $ = cheerio.load(page.body);
  const text = $('body').clone().find('script,style,noscript,svg').remove().end().text().replace(/\s+/g, ' ').trim();
  const words = text ? text.split(' ').length : 0;
  const title = $('head title').first().text().trim();
  const desc = $('meta[name="description"]').attr('content')?.trim() || '';
  const robotsMeta = ($('meta[name="robots"]').attr('content') || '') + ' ' + (page.headers['x-robots-tag'] || '');
  const canonical = $('link[rel="canonical"]').attr('href') || '';
  const h1s = $('h1').map((_, e) => $(e).text().trim()).get();
  const h2s = $('h2').map((_, e) => $(e).text().trim()).get();
  const h3s = $('h3').map((_, e) => $(e).text().trim()).get();
  const lang = $('html').attr('lang') || '';
  const viewport = $('meta[name="viewport"]').attr('content') || '';
  const imgs = $('img');
  const noAlt = imgs.filter((_, e) => !($(e).attr('alt') || '').trim()).length;
  const lazy = imgs.filter((_, e) => $(e).attr('loading') === 'lazy').length;
  const links = extractLinks(page.body, page.finalUrl);
  const host = new URL(page.finalUrl).host.replace(/^www\./, '');
  const internal = links.filter(l => { try { return new URL(l.url).host.replace(/^www\./, '') === host; } catch { return false; } });
  const external = links.filter(l => !internal.includes(l));
  const og = ['og:title', 'og:description', 'og:image'].filter(p => $(`meta[property="${p}"]`).attr('content'));
  const twitter = $('meta[name="twitter:card"]').attr('content');
  const hreflang = $('link[rel="alternate"][hreflang]').length;
  const scripts = $('script[src]').length;
  const blockingCss = $('link[rel="stylesheet"]').length;
  const inlineSize = $('script:not([src])').text().length + $('style').text().length;

  // JSON-LD
  const schemas = [];
  let schemaErrors = 0;
  $('script[type="application/ld+json"]').each((_, e) => {
    try {
      const j = JSON.parse($(e).contents().text());
      const walk = o => { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) return o.forEach(walk); if (o['@type']) [].concat(o['@type']).forEach(t => schemas.push(String(t))); if (o['@graph']) walk(o['@graph']); };
      walk(j);
    } catch { schemaErrors++; }
  });
  const microdata = $('[itemtype]').map((_, e) => ($(e).attr('itemtype') || '').split('/').pop()).get();
  const allSchema = [...new Set([...schemas, ...microdata])];

  Object.assign(facts, { title, desc, canonical, h1s, h2Count: h2s.length, h3Count: h3s.length, words, lang, images: imgs.length, imagesNoAlt: noAlt, internalLinks: internal.length, externalLinks: external.length, schema: allSchema, headings: [...h1s.map(h => 'H1: ' + h), ...h2s.slice(0, 25).map(h => 'H2: ' + h), ...h3s.slice(0, 15).map(h => 'H3: ' + h)], textSample: text.slice(0, 6000), internalUrls: internal.map(l => l.url), anchors: internal.slice(0, 40).map(l => l.text).filter(Boolean) });

  // Technical
  checks.push(c('technical', 'status', 'Page loads successfully', 'pass', `HTTP ${page.status}`, '', 5));
  if (page.redirects.length) checks.push(c('technical', 'redirects', 'Redirect chain', page.redirects.length > 1 ? 'warn' : 'info', `${page.redirects.length} redirect(s): ` + page.redirects.map(r => `${r.status} → ${r.to}`).join(', '), 'Link directly to the final URL and keep redirects to a single hop.', 2));
  checks.push(page.finalUrl.startsWith('https://') ? c('technical', 'https', 'Served over HTTPS', 'pass', 'Secure connection', '', 4) : c('technical', 'https', 'Served over HTTPS', 'fail', 'Page is served over plain HTTP', 'Install an SSL certificate and 301 redirect all HTTP URLs to HTTPS.', 4));
  const noindex = /noindex/i.test(robotsMeta);
  checks.push(noindex ? c('technical', 'indexable', 'Page is indexable', 'fail', 'noindex found in meta robots / X-Robots-Tag', 'Remove noindex if this page should rank.', 5) : c('technical', 'indexable', 'Page is indexable', 'pass', 'No noindex directive', '', 5));
  const path = new URL(page.finalUrl).pathname;
  if (ctx.robotsTxt && isBlockedForAgent(ctx.robotsTxt, 'Googlebot', path)) checks.push(c('technical', 'robots-block', 'Not blocked by robots.txt', 'fail', 'robots.txt disallows Googlebot for this path', 'Update robots.txt to allow crawling of this URL.', 5));
  if (!canonical) checks.push(c('technical', 'canonical', 'Canonical tag', 'warn', 'No rel=canonical found', 'Add <link rel="canonical" href="..."> pointing to the preferred URL.', 3));
  else {
    let abs = canonical; try { abs = new URL(canonical, page.finalUrl).toString(); } catch {}
    const self = abs.replace(/\/$/, '') === page.finalUrl.replace(/\/$/, '');
    checks.push(c('technical', 'canonical', 'Canonical tag', self ? 'pass' : 'info', self ? 'Self-referencing canonical' : `Canonical points to ${abs}`, self ? '' : 'Confirm this page is meant to be consolidated into the canonical URL.', 3));
  }
  checks.push(lang ? c('technical', 'lang', 'HTML lang attribute', 'pass', `lang="${lang}"`, '', 1) : c('technical', 'lang', 'HTML lang attribute', 'warn', 'Missing lang attribute', 'Add <html lang="en"> (or the correct language).', 1));
  if (hreflang) checks.push(c('technical', 'hreflang', 'hreflang tags', 'info', `${hreflang} hreflang alternates`, '', 1));

  // On-page
  if (!title) checks.push(c('onpage', 'title', 'Title tag', 'fail', 'Missing <title>', 'Write a unique 50–60 character title with the primary keyword near the start.', 5));
  else checks.push(c('onpage', 'title', 'Title tag', title.length < 30 || title.length > 65 ? 'warn' : 'pass', `"${title}" (${title.length} chars)`, title.length < 30 ? 'Title is short — add the primary keyword and a benefit (aim 50–60 chars).' : title.length > 65 ? 'Title may be truncated in Google — keep it under ~60 characters.' : '', 5));
  if (!desc) checks.push(c('onpage', 'desc', 'Meta description', 'fail', 'Missing meta description', 'Write a compelling 140–160 character description with the keyword and a call to action.', 3));
  else checks.push(c('onpage', 'desc', 'Meta description', desc.length < 70 || desc.length > 165 ? 'warn' : 'pass', `${desc.length} chars: "${desc.slice(0, 170)}"`, desc.length < 70 ? 'Description is short — expand to 140–160 characters.' : desc.length > 165 ? 'Description will be truncated — trim to ~155 characters.' : '', 3));
  if (!h1s.length) checks.push(c('onpage', 'h1', 'Single H1 heading', 'fail', 'No H1 found', 'Add one H1 that states the page topic and contains the primary keyword.', 4));
  else checks.push(c('onpage', 'h1', 'Single H1 heading', h1s.length > 1 ? 'warn' : 'pass', h1s.length > 1 ? `${h1s.length} H1s: ${h1s.slice(0, 3).join(' | ')}` : `"${h1s[0]}"`, h1s.length > 1 ? 'Use one H1 per page; demote the others to H2.' : '', 4));
  checks.push(h2s.length ? c('onpage', 'h2', 'Subheading structure (H2/H3)', 'pass', `${h2s.length} H2, ${h3s.length} H3`, '', 2) : c('onpage', 'h2', 'Subheading structure (H2/H3)', 'warn', 'No H2 subheadings', 'Break content into sections with descriptive H2/H3 headings.', 2));
  checks.push(noAlt ? c('onpage', 'alt', 'Image alt text', noAlt / Math.max(imgs.length, 1) > 0.3 ? 'fail' : 'warn', `${noAlt} of ${imgs.length} images missing alt text`, 'Add descriptive alt text to every meaningful image.', 2) : c('onpage', 'alt', 'Image alt text', 'pass', `${imgs.length} images, all have alt`, '', 2));
  checks.push(internal.length >= 3 ? c('onpage', 'internal', 'Internal linking', 'pass', `${internal.length} internal links`, '', 2) : c('onpage', 'internal', 'Internal linking', 'warn', `Only ${internal.length} internal links`, 'Link to related pages with descriptive anchor text.', 2));
  checks.push(og.length === 3 ? c('onpage', 'og', 'Open Graph / social tags', 'pass', `og:title, og:description, og:image${twitter ? ', twitter:card' : ''}`, '', 1) : c('onpage', 'og', 'Open Graph / social tags', 'warn', `Missing: ${['og:title', 'og:description', 'og:image'].filter(x => !og.includes(x)).join(', ')}`, 'Add Open Graph tags so shares (and some AI previews) show a proper title, description and image.', 1));
  const urlOk = path.length < 90 && !/[A-Z_]|\?.*=.*&.*=/.test(path);
  checks.push(c('onpage', 'url', 'Clean URL', urlOk ? 'pass' : 'warn', path, urlOk ? '' : 'Use short, lowercase, hyphenated URLs without many parameters.', 1));

  // Content
  checks.push(c('content', 'words', 'Content depth', words < 300 ? 'fail' : words < 600 ? 'warn' : 'pass', `${words} words`, words < 600 ? 'Thin content — expand with expert detail, examples, FAQs and data that fully answer the search intent.' : '', 3));
  const dup = title && h1s[0] && title.toLowerCase() === h1s[0].toLowerCase();
  if (dup) checks.push(c('content', 'title-h1', 'Title and H1 differ', 'info', 'Title and H1 are identical', 'Consider varying them to cover a secondary keyword.', 1));

  // Performance
  checks.push(c('performance', 'ttfb', 'Server response time', page.ms > 1800 ? 'fail' : page.ms > 800 ? 'warn' : 'pass', `${page.ms} ms to download HTML`, page.ms > 800 ? 'Improve hosting, enable caching/CDN and reduce server work.' : '', 3));
  checks.push(c('performance', 'size', 'HTML size', page.bytes > 500000 ? 'warn' : 'pass', `${(page.bytes / 1024).toFixed(0)} KB`, page.bytes > 500000 ? 'Large HTML — remove inline bloat and unused markup.' : '', 1));
  checks.push(viewport ? c('performance', 'viewport', 'Mobile viewport', 'pass', viewport, '', 4) : c('performance', 'viewport', 'Mobile viewport', 'fail', 'No viewport meta tag', 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.', 4));
  checks.push(c('performance', 'assets', 'Render-blocking assets', scripts + blockingCss > 25 ? 'warn' : 'pass', `${scripts} scripts, ${blockingCss} stylesheets, ${(inlineSize / 1024).toFixed(0)} KB inline code`, scripts + blockingCss > 25 ? 'Defer non-critical JS, combine CSS, remove unused plugins.' : '', 2));
  if (imgs.length > 5) checks.push(c('performance', 'lazy', 'Lazy-loaded images', lazy ? 'pass' : 'warn', `${lazy}/${imgs.length} images use loading="lazy"`, lazy ? '' : 'Add loading="lazy" to below-the-fold images.', 1));
  const comp = page.headers['content-encoding'];
  checks.push(c('performance', 'compression', 'Text compression', comp ? 'pass' : 'warn', comp ? `Compressed (${comp})` : 'No gzip/brotli detected', comp ? '' : 'Enable gzip or brotli on the server.', 1));

  // Schema
  if (!allSchema.length) checks.push(c('schema', 'schema', 'Structured data present', 'fail', 'No JSON-LD or microdata found', 'Add JSON-LD schema (Organization, WebSite, Article/Product/LocalBusiness, BreadcrumbList, FAQPage as relevant).', 4));
  else checks.push(c('schema', 'schema', 'Structured data present', 'pass', allSchema.join(', '), '', 4));
  if (schemaErrors) checks.push(c('schema', 'schema-err', 'Valid JSON-LD', 'fail', `${schemaErrors} JSON-LD block(s) fail to parse`, 'Fix the JSON syntax; validate at validator.schema.org.', 3));
  const hasOrg = allSchema.some(s => /Organization|LocalBusiness|Person/i.test(s));
  checks.push(c('schema', 'entity', 'Entity schema (Organization/Person)', hasOrg ? 'pass' : 'warn', hasOrg ? 'Entity markup found' : 'No Organization/LocalBusiness/Person schema', hasOrg ? '' : 'Add Organization (or LocalBusiness) schema with name, logo, sameAs social profiles — this anchors your brand as an entity for Google and LLMs.', 3));
  const bc = allSchema.some(s => /Breadcrumb/i.test(s));
  if (path !== '/') checks.push(c('schema', 'breadcrumb', 'Breadcrumb schema', bc ? 'pass' : 'warn', bc ? 'BreadcrumbList found' : 'No BreadcrumbList', bc ? '' : 'Add BreadcrumbList schema to inner pages.', 1));

  // GEO — content signals LLMs use when choosing what to cite
  const questionHeads = [...h2s, ...h3s].filter(h => /\?$|^(what|how|why|when|where|which|who|can|does|is|are|should)\b/i.test(h)).length;
  checks.push(c('geo', 'qa', 'Question-style headings', questionHeads >= 2 ? 'pass' : 'warn', `${questionHeads} headings phrased as questions`, questionHeads >= 2 ? '' : 'Phrase some H2/H3s as the questions people ask ChatGPT/Google, each followed by a direct 40–60 word answer.', 3));
  const faq = allSchema.some(s => /FAQ|QAPage|HowTo/i.test(s)) || /frequently asked|faq/i.test(text);
  checks.push(c('geo', 'faq', 'FAQ / Q&A section', faq ? 'pass' : 'warn', faq ? 'FAQ content detected' : 'No FAQ section found', faq ? '' : 'Add an FAQ block (with FAQPage schema) answering the top follow-up questions.', 2));
  const stats = (text.match(/\b\d+(\.\d+)?\s?(%|percent|million|billion|k\b|x\b)/gi) || []).length;
  checks.push(c('geo', 'stats', 'Statistics & concrete facts', stats >= 3 ? 'pass' : 'warn', `${stats} statistics/figures found`, stats >= 3 ? '' : 'LLMs favour quotable facts — add specific numbers, dates, and original data with sources.', 2));
  checks.push(c('geo', 'citations', 'Cites authoritative sources', external.length >= 2 ? 'pass' : 'warn', `${external.length} outbound links`, external.length >= 2 ? '' : 'Reference authoritative sources (studies, official docs). Cited content is cited more by AI engines.', 2));
  const lists = $('ul li, ol li').length, tables = $('table').length;
  checks.push(c('geo', 'structure', 'Scannable lists & tables', lists >= 5 || tables ? 'pass' : 'warn', `${lists} list items, ${tables} tables`, lists >= 5 || tables ? '' : 'Use bullet lists, numbered steps and comparison tables — easy for AI to extract.', 2));
  const author = $('[rel="author"], .author, [itemprop="author"], .byline').length || allSchema.some(s => /Person/i.test(s)) || /\bby\s+[A-Z][a-z]+\s+[A-Z][a-z]+/.test(text);
  checks.push(c('geo', 'author', 'Author / E-E-A-T signals', author ? 'pass' : 'warn', author ? 'Author or byline detected' : 'No author/byline found', author ? '' : 'Show author name, credentials and an author bio page; add Person schema.', 2));
  const dated = $('time[datetime], meta[property="article:modified_time"], meta[property="article:published_time"]').length || /"dateModified"|"datePublished"/.test(page.body);
  checks.push(c('geo', 'fresh', 'Publish / update date', dated ? 'pass' : 'warn', dated ? 'Date markup present' : 'No visible or machine-readable date', dated ? '' : 'Show "Last updated" dates and add dateModified in schema — AI engines prefer fresh content.', 2));
  const firstPara = $('main p, article p, p').filter((_, e) => $(e).text().trim().length > 60).first().text().trim();
  const fpWords = firstPara.split(/\s+/).length;
  checks.push(c('geo', 'answer-first', 'Answer-first intro', firstPara && fpWords <= 80 ? 'pass' : 'warn', firstPara ? `First paragraph: ${fpWords} words` : 'No clear intro paragraph', 'Open with a concise 1–2 sentence summary that directly answers the main query (the "BLUF").', 2));
  const jsHeavy = words < 150 && scripts > 5;
  if (jsHeavy) checks.push(c('geo', 'js-render', 'Content visible without JavaScript', 'fail', 'Very little text in raw HTML — content likely rendered by JavaScript', 'Most AI crawlers do not run JS. Use server-side rendering or static generation.', 4));
  facts.firstParagraph = firstPara.slice(0, 500);

  return { facts, checks };
}

// ---------- site-level ----------
export function analyzeSite(crawlRes) {
  const checks = [];
  const { robots, llms, sitemap, httpRedirectsToHttps, pages } = crawlRes;
  checks.push(robots.text ? c('technical', 'robots', 'robots.txt', 'pass', 'robots.txt found', '', 2) : c('technical', 'robots', 'robots.txt', 'warn', `No robots.txt (HTTP ${robots.status})`, 'Add a robots.txt that references your XML sitemap.', 2));
  checks.push(sitemap.found.length ? c('technical', 'sitemap', 'XML sitemap', 'pass', `${sitemap.found.length} sitemap(s), ${sitemap.urlCount} URLs`, '', 3) : c('technical', 'sitemap', 'XML sitemap', 'fail', 'No XML sitemap found', 'Generate /sitemap.xml, reference it in robots.txt and submit in Search Console.', 3));
  if (httpRedirectsToHttps === false) checks.push(c('technical', 'http2https', 'HTTP redirects to HTTPS', 'fail', 'http:// version does not redirect to https://', 'Add a site-wide 301 redirect from HTTP to HTTPS.', 3));
  else if (httpRedirectsToHttps) checks.push(c('technical', 'http2https', 'HTTP redirects to HTTPS', 'pass', 'HTTP → HTTPS redirect in place', '', 3));

  const blocked = AI_BOTS.filter(b => robots.text && isBlockedForAgent(robots.text, b.ua, '/'));
  checks.push(c('geo', 'ai-bots', 'AI crawlers allowed in robots.txt', blocked.length ? (blocked.length > 3 ? 'fail' : 'warn') : 'pass', blocked.length ? 'Blocked: ' + blocked.map(b => `${b.ua} (${b.who})`).join(', ') : 'GPTBot, ClaudeBot, PerplexityBot, Google-Extended etc. are not blocked', blocked.length ? 'If you want visibility in ChatGPT, Perplexity, Claude and Gemini answers, allow their bots (at least the search/user agents).' : '', 4));
  checks.push(llms.exists ? c('geo', 'llms', 'llms.txt file', 'pass', '/llms.txt found', '', 1) : c('geo', 'llms', 'llms.txt file', 'info', 'No /llms.txt', 'Optional but cheap: add /llms.txt summarising your key pages for AI agents.', 1));

  if (pages.length > 1) {
    const ok = pages.filter(p => p.ok);
    const broken = pages.filter(p => !p.ok);
    checks.push(c('technical', 'broken', 'Broken pages', broken.length ? 'fail' : 'pass', broken.length ? `${broken.length} pages error: ` + broken.slice(0, 8).map(p => `${p.status} ${p.url}`).join(', ') : `All ${pages.length} crawled pages return 200`, broken.length ? 'Fix or 301-redirect broken URLs and update internal links pointing to them.' : '', 4));
    const titles = {}, descs = {};
    for (const p of ok) {
      const $ = cheerio.load(p.body);
      const t = $('title').first().text().trim(), d = $('meta[name="description"]').attr('content')?.trim();
      if (t) (titles[t] ||= []).push(p.finalUrl);
      if (d) (descs[d] ||= []).push(p.finalUrl);
    }
    const dt = Object.entries(titles).filter(([, v]) => v.length > 1);
    const dd = Object.entries(descs).filter(([, v]) => v.length > 1);
    checks.push(c('onpage', 'dup-title', 'Unique titles across site', dt.length ? 'fail' : 'pass', dt.length ? `${dt.length} duplicated titles, e.g. "${dt[0][0]}" on ${dt[0][1].length} pages` : 'All titles unique', dt.length ? 'Give every page a unique title targeting its own keyword.' : '', 3));
    checks.push(c('onpage', 'dup-desc', 'Unique meta descriptions', dd.length ? 'warn' : 'pass', dd.length ? `${dd.length} duplicated descriptions` : 'All descriptions unique', dd.length ? 'Write unique meta descriptions per page.' : '', 2));
  }
  return checks;
}

export function score(checks) {
  const pts = { pass: 1, info: 1, warn: 0.5, fail: 0 };
  const byCat = {};
  for (const k of Object.keys(CATEGORIES)) {
    const list = checks.filter(x => x.cat === k && x.status !== 'info');
    const w = list.reduce((s, x) => s + x.weight, 0);
    byCat[k] = w ? Math.round(100 * list.reduce((s, x) => s + x.weight * (x.scoreVal ?? pts[x.status]), 0) / w) : null;
  }
  const vals = Object.entries(byCat).filter(([, v]) => v != null);
  const seo = vals.filter(([k]) => k !== 'geo');
  return {
    overall: Math.round(vals.reduce((s, [, v]) => s + v, 0) / vals.length),
    seo: Math.round(seo.reduce((s, [, v]) => s + v, 0) / seo.length),
    geo: byCat.geo,
    byCat
  };
}

// Aggregate many pages into one issue list: each issue lists affected URLs
export function aggregate(pageResults, siteChecks) {
  const map = new Map();
  for (const pr of pageResults) for (const ch of pr.checks) {
    const k = ch.cat + ':' + ch.id;
    if (!map.has(k)) map.set(k, { ...ch, pages: [], counts: { pass: 0, warn: 0, fail: 0, info: 0 } });
    const m = map.get(k);
    m.counts[ch.status]++;
    if (ch.status === 'fail' || ch.status === 'warn') m.pages.push({ url: pr.facts.url, detail: ch.detail });
  }
  const agg = [...map.values()].map(m => {
    const total = pageResults.length;
    const status = m.counts.fail ? 'fail' : m.counts.warn ? 'warn' : m.counts.info && !m.counts.pass ? 'info' : 'pass';
    const detail = total === 1 ? m.detail : (m.pages.length ? `${m.pages.length} of ${total} pages affected` : `OK on all ${total} pages`);
    const n = m.counts.pass + m.counts.warn + m.counts.fail;
    const scoreVal = n ? (m.counts.pass + 0.5 * m.counts.warn) / n : 1;
    return { ...m, status, detail, scoreVal };
  });
  return [...siteChecks, ...agg];
}
