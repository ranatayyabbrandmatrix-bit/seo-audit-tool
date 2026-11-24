import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { crawl, normalizeUrl } from './src/crawler.js';
import { analyzePage, analyzeSite, aggregate, score, CATEGORIES } from './src/checks.js';
import { parseGscFiles } from './src/gsc.js';
import * as AI from './src/ai.js';
import { hasSerp, discoverCompetitors, rankMatrix, domainOf } from './src/serp.js';
import { renderAudit, renderStrategy, REPORT_CSS } from './public/render.js';

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 12 } });
app.set('trust proxy', 1);
app.get('/healthz', (_, res) => res.send('ok'));

// Password protection for online use: set APP_PASSWORD (and optionally APP_USER) in the host's env vars.
if (process.env.APP_PASSWORD) {
  const user = process.env.APP_USER || 'admin';
  const expected = Buffer.from(`${user}:${process.env.APP_PASSWORD}`);
  app.use((req, res, next) => {
    const m = (req.headers.authorization || '').match(/^Basic (.+)$/);
    const given = m ? Buffer.from(m[1], 'base64') : Buffer.alloc(0);
    if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return next();
    res.set('WWW-Authenticate', 'Basic realm="SEO + GEO Auditor"').status(401).send('Login required');
  });
} else if (process.env.NODE_ENV === 'production') {
  console.warn('WARNING: APP_PASSWORD is not set — anyone with the link can use your API credits.');
}

app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

// ---------- in-memory job store ----------
const jobs = new Map();
const audits = new Map(); // auditId -> audit result (so Strategy can reuse it)
function startJob(kind, fn) {
  const id = crypto.randomUUID();
  const job = { id, kind, status: 'running', progress: 0, message: 'Starting…', log: [], created: Date.now() };
  jobs.set(id, job);
  const progress = (message, pct) => { job.message = message; if (pct != null) job.progress = Math.min(99, Math.round(pct)); job.log.push(message); };
  fn(progress).then(r => { job.result = r; job.status = 'done'; job.progress = 100; job.message = 'Done'; })
    .catch(e => { console.error(e); job.status = 'error'; job.error = e.message; });
  return id;
}
setInterval(() => { const cut = Date.now() - 6 * 3600e3; for (const [k, j] of jobs) if (j.created < cut) { jobs.delete(k); audits.delete(k); } }, 600e3);

app.get('/api/config', (_, res) => res.json({ ai: AI.hasAI(), serp: hasSerp(), model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5', maxPages: +(process.env.MAX_PAGES || 100) }));

app.get('/api/jobs/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j) return res.status(404).json({ error: 'Job not found (server may have restarted)' });
  res.json({ id: j.id, kind: j.kind, status: j.status, progress: j.progress, message: j.message, error: j.error, result: j.status === 'done' ? j.result : undefined });
});

// ---------- AUDIT ----------
app.post('/api/audit', upload.array('gsc', 12), (req, res) => {
  let url;
  try { url = normalizeUrl(req.body.url); } catch (e) { return res.status(400).json({ error: e.message }); }
  const mode = req.body.mode === 'site' ? 'site' : 'page';
  const maxPages = Math.min(+(req.body.maxPages || 25), +(process.env.MAX_PAGES || 100));
  const context = (req.body.context || '').slice(0, 1500);
  const useAI = req.body.useAI !== 'false' && AI.hasAI();
  const files = req.files || [];

  const id = startJob('audit', async progress => {
    const cr = await crawl(url, { mode, maxPages, onProgress: progress });
    if (!cr.pages.length) throw new Error('Could not fetch any HTML page from that URL.');
    progress('Running SEO & GEO checks', 55);
    const ctx = { robotsTxt: cr.robots.text };
    const pageResults = cr.pages.map(p => analyzePage(p, ctx));
    const siteChecks = analyzeSite(cr);
    const issues = aggregate(pageResults, siteChecks);
    const scores = score(issues);

    let gsc = null;
    if (files.length) { progress('Reading Search Console files', 62); gsc = await parseGscFiles(files); }

    let aiRes = null, aiError = null;
    if (useAI) {
      progress(gsc?.images?.length ? 'AI analysis (reading your Search Console screenshots)…' : 'AI content & GEO analysis…', 70);
      try { aiRes = await AI.auditInsights({ url: cr.startUrl, mode, scores, issues, pages: pageResults, gsc, context }); }
      catch (e) { aiError = e.message; }
    }
    const result = {
      type: 'audit', url: cr.startUrl, host: cr.host, mode, date: new Date().toISOString(), categories: CATEGORIES,
      scores, issues, ai: aiRes, aiError,
      pages: pageResults.map(p => ({ ...p.facts, textSample: undefined, internalUrls: undefined, anchors: undefined, issues: p.checks.filter(c => c.status === 'fail' || c.status === 'warn').length })),
      site: { robots: !!cr.robots.text, llms: cr.llms.exists, sitemaps: cr.sitemap.found, sitemapUrls: cr.sitemap.urlCount },
      gsc: gsc ? { tables: gsc.tables, screenshots: gsc.images.map(i => i.name), errors: gsc.errors } : null,
      _pagesForStrategy: pageResults.slice(0, 8).map(p => ({ facts: { ...p.facts, internalUrls: undefined } }))
    };
    audits.set(id, result);
    return result;
  });
  res.json({ jobId: id });
});

// ---------- STRATEGY (independent of audit; reuses it if auditId given) ----------
app.post('/api/strategy', (req, res) => {
  if (!AI.hasAI()) return res.status(400).json({ error: 'Strategy needs ANTHROPIC_API_KEY in .env' });
  let url;
  try { url = normalizeUrl(req.body.url); } catch (e) { return res.status(400).json({ error: e.message }); }
  const b = req.body;
  const gl = (b.country || 'us').toLowerCase(), hl = (b.language || 'en').toLowerCase();
  const location = b.locationName || gl.toUpperCase();
  const manual = String(b.competitors || '').split(/[\s,\n]+/).filter(Boolean).slice(0, 8);
  const userKeywords = String(b.keywords || '').split(/\n|,/).map(s => s.trim()).filter(Boolean).slice(0, 30);
  const kwCount = Math.min(+(b.keywordCount || 12), 30);
  const audit = b.auditId ? audits.get(b.auditId) : null;

  const id = startJob('strategy', async progress => {
    const target = domainOf(url);
    let pages = audit?._pagesForStrategy;
    if (!pages) {
      progress('Reading your website', 4);
      const cr = await crawl(url, { mode: 'site', maxPages: 6, onProgress: m => progress(m, 6) });
      pages = cr.pages.filter(p => p.ok).map(p => analyzePage(p, { robotsTxt: cr.robots.text }));
      if (!pages.length) throw new Error('Could not read the website.');
    }

    progress('Identifying your target keywords', 12);
    const kw = await AI.extractKeywords({ url, pages, context: b.context, count: kwCount, location });
    const seed = [...new Set([...userKeywords, ...(kw.keywords || []).map(k => k.keyword)])].slice(0, 30);

    let competitors = [], serps = [], serpNote = null;
    if (hasSerp()) {
      progress('Finding competitors on Google', 20);
      const d = await discoverCompetitors(seed, target, { gl, hl, manual, max: +(b.maxCompetitors || 5), includeBig: b.includeBig === true, onProgress: (m, f) => progress(m, 20 + f * 20) });
      competitors = d.competitors; serps = d.serps;
    } else {
      progress('Finding competitors with AI web search (add SERPER_API_KEY for exact Google rankings)', 20);
      serpNote = 'No SERPER_API_KEY set: competitors found via AI web search; exact Google positions were not measured.';
      try {
        const w = await AI.competitorsViaWebSearch({ url, business: kw.business, keywords: seed, location, max: +(b.maxCompetitors || 5) });
        competitors = w.competitors.map(c => ({ domain: domainOf('https://' + c.domain.replace(/^https?:\/\//, '')), why: c.why, keywords: c.keywordsSeenRanking || [], source: 'web-search' }));
      } catch (e) { serpNote += ' Web search failed: ' + e.message; }
      for (const m of manual) { const d = domainOf(/^https?:/.test(m) ? m : 'https://' + m); if (d && !competitors.some(c => c.domain === d)) competitors.unshift({ domain: d, source: 'manual', keywords: [] }); }
      competitors = competitors.slice(0, Math.max(+(b.maxCompetitors || 5), manual.length));
    }

    progress('Analysing competitor websites', 45);
    const compInfo = [];
    for (const [i, c] of competitors.entries()) {
      progress(`Reading ${c.domain}`, 45 + (i / Math.max(competitors.length, 1)) * 12);
      try {
        const cr = await crawl(c.domain, { mode: 'site', maxPages: 3 });
        const cp = cr.pages.filter(p => p.ok).map(p => analyzePage(p, { robotsTxt: cr.robots.text }));
        const info = cp.length ? await AI.competitorKeywords({ domain: c.domain, pages: cp, niche: kw.niche }) : { keywords: [] };
        const sc = cp.length ? score(aggregate(cp, analyzeSite(cr))) : null;
        compInfo.push({ domain: c.domain, ...info, scores: sc, appearances: c.appearances, avgPosition: c.avgPosition, why: c.why });
      } catch (e) { compInfo.push({ domain: c.domain, error: e.message, keywords: c.keywords || [] }); }
    }

    const allKw = [...new Set([...seed, ...compInfo.flatMap(c => c.keywords || [])])].slice(0, +(process.env.MAX_RANK_KEYWORDS || 40));
    let matrix = allKw.map(k => ({ keyword: k, ranks: {} }));
    if (hasSerp()) {
      progress('Checking keyword rankings for you and competitors', 60);
      matrix = await rankMatrix(allKw, [target, ...competitors.map(c => c.domain)], { gl, hl, onProgress: (m, f) => progress(m, 60 + f * 15) });
    }

    progress('Calculating keyword gap', 78);
    const gap = await AI.keywordGap({ target, competitors: competitors.map(c => c.domain), matrix, compInfo, niche: kw.niche, location });

    progress('Writing your SEO + GEO strategy', 86);
    const strategy = await AI.buildStrategy({
      target, niche: kw.niche, location, goals: b.goals, timeframe: b.timeframe, audit,
      competitors: compInfo.map(c => ({ domain: c.domain, positioning: c.positioning, strengths: c.strengths, scores: c.scores?.byCat })),
      gap: { summary: gap.summary, gaps: gap.gaps?.slice(0, 15), questions: gap.questionsToAnswer },
      gscSummary: audit?.ai?.searchConsole
    });

    return {
      type: 'strategy', url, target, date: new Date().toISOString(), location, gl, hl, usedAudit: !!audit, serpNote,
      business: kw.business, niche: kw.niche, seedKeywords: kw.keywords, competitors: compInfo, domains: [target, ...competitors.map(c => c.domain)],
      matrix, gap, strategy
    };
  });
  res.json({ jobId: id });
});

// ---------- downloadable standalone report ----------
app.get('/api/report/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j || j.status !== 'done') return res.status(404).send('Report not found');
  const r = j.result;
  const body = r.type === 'audit' ? renderAudit(r) : renderStrategy(r);
  const name = `${r.type}-${(r.host || r.target || 'site').replace(/[^a-z0-9.-]/gi, '')}-${r.date.slice(0, 10)}.html`;
  if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.type('html').send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${r.type === 'audit' ? 'SEO & GEO Audit' : 'SEO & GEO Strategy'} – ${(r.host || r.target)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>${REPORT_CSS} body{max-width:1100px;margin:0 auto;padding:32px 20px}</style></head><body class="report-standalone">${body}<script>for(const c of document.querySelectorAll('.stack td')){let i=0,p=c;while(p=p.previousElementSibling)i+=p.colSpan;c.dataset.l=c.closest('table').rows[0].cells[i]?.textContent||''}addEventListener('beforeprint',()=>document.querySelectorAll('details').forEach(d=>d.open=true))</script></body></html>`);
});

const PORT = +(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`SEO + GEO Audit Tool running → http://localhost:${PORT}\n  AI: ${AI.hasAI() ? 'on' : 'OFF (set ANTHROPIC_API_KEY)'} | SERP: ${hasSerp() ? 'on' : 'OFF (set SERPER_API_KEY)'}`));
