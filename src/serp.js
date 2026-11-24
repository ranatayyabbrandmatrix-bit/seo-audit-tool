// Live Google results via Serper.dev (https://serper.dev). Optional — tool degrades gracefully without a key.
const BIG_SITES = /(^|\.)(wikipedia\.org|youtube\.com|facebook\.com|instagram\.com|linkedin\.com|twitter\.com|x\.com|reddit\.com|quora\.com|amazon\.[a-z.]+|pinterest\.com|tiktok\.com|yelp\.com|medium\.com|google\.com|apple\.com|github\.com)$/i;

export const hasSerp = () => !!process.env.SERPER_API_KEY;
export const domainOf = u => { try { return new URL(u).host.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

const cache = new Map();
export async function serpSearch(q, { gl = 'us', hl = 'en', num = 20 } = {}) {
  const key = [q, gl, hl, num].join('|');
  if (cache.has(key)) return cache.get(key);
  const res = await fetch(process.env.SERPER_URL || 'https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, gl, hl, num })
  });
  if (!res.ok) throw new Error(`Serper ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const out = {
    q,
    organic: (j.organic || []).map(o => ({ position: o.position, title: o.title, link: o.link, domain: domainOf(o.link), snippet: o.snippet })),
    paa: (j.peopleAlsoAsk || []).map(p => p.question),
    related: (j.relatedSearches || []).map(r => r.query),
    aiOverview: !!(j.answerBox || j.aiOverview),
    features: Object.keys(j).filter(k => !['searchParameters', 'organic', 'credits'].includes(k))
  };
  cache.set(key, out);
  return out;
}

export const rankOf = (serp, domain) => {
  const hit = serp.organic.find(o => o.domain === domain || o.domain.endsWith('.' + domain));
  return hit ? { position: hit.position, url: hit.link } : null;
};

/** Run keyword list through SERP; find competitors by frequency in top 10. */
export async function discoverCompetitors(keywords, targetDomain, { gl, hl, manual = [], max = 5, includeBig = false, onProgress = () => {} } = {}) {
  const serps = [];
  for (let i = 0; i < keywords.length; i++) {
    onProgress(`Checking Google for "${keywords[i]}"`, i / keywords.length);
    try { serps.push(await serpSearch(keywords[i], { gl, hl })); } catch (e) { serps.push({ q: keywords[i], organic: [], paa: [], related: [], error: e.message }); }
  }
  const freq = {};
  for (const s of serps) for (const o of s.organic.filter(o => o.position <= 10)) {
    if (!o.domain || o.domain === targetDomain || o.domain.endsWith('.' + targetDomain)) continue;
    if (!includeBig && BIG_SITES.test(o.domain)) continue;
    (freq[o.domain] ||= { domain: o.domain, appearances: 0, positions: [], keywords: [] });
    freq[o.domain].appearances++;
    freq[o.domain].positions.push(o.position);
    freq[o.domain].keywords.push(s.q);
  }
  let comps = Object.values(freq).map(f => ({ ...f, avgPosition: +(f.positions.reduce((a, b) => a + b, 0) / f.positions.length).toFixed(1), source: 'serp' }))
    .sort((a, b) => b.appearances - a.appearances || a.avgPosition - b.avgPosition);
  const manualD = manual.map(m => domainOf(/^https?:/.test(m) ? m : 'https://' + m)).filter(Boolean);
  comps = [...manualD.map(d => comps.find(c => c.domain === d) || { domain: d, appearances: 0, positions: [], keywords: [], avgPosition: null, source: 'manual' }), ...comps.filter(c => !manualD.includes(c.domain))].slice(0, Math.max(max, manualD.length));
  return { serps, competitors: comps };
}

/** Build a ranking matrix: keyword × [target, ...competitors] */
export async function rankMatrix(keywords, domains, { gl, hl, onProgress = () => {} } = {}) {
  const rows = [];
  for (let i = 0; i < keywords.length; i++) {
    onProgress(`Ranking check "${keywords[i]}"`, i / keywords.length);
    let s;
    try { s = await serpSearch(keywords[i], { gl, hl, num: 30 }); } catch (e) { rows.push({ keyword: keywords[i], error: e.message, ranks: {} }); continue; }
    const ranks = {};
    for (const d of domains) ranks[d] = rankOf(s, d);
    rows.push({ keyword: keywords[i], ranks, paa: s.paa.slice(0, 4), related: s.related.slice(0, 5), top3: s.organic.slice(0, 3).map(o => o.domain) });
  }
  return rows;
}
