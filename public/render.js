// Shared renderer — used by the browser UI and by the server for downloadable reports.
const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const safeHref = u => /^https?:\/\//i.test(String(u)) ? esc(u) : '#';
const list = (arr, cls = '') => arr?.length ? `<ul class="${cls}">${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
const sec = (title, inner, id = '') => inner ? `<section class="r-sec" ${id ? `id="${id}"` : ''}><h2>${esc(title)}</h2>${inner}</section>` : '';
const pill = s => `<span class="pill ${esc(s)}">${{ pass: 'Pass', warn: 'Warning', fail: 'Error', info: 'Info', high: 'High', medium: 'Medium', low: 'Low' }[s] || esc(s)}</span>`;
const tone = n => n == null ? 'na' : n >= 80 ? 'good' : n >= 55 ? 'mid' : 'bad';

function ring(value, label, big = false) {
  const r = big ? 54 : 34, sw = big ? 11 : 8, size = (r + sw) * 2, C = 2 * Math.PI * r, v = value ?? 0;
  return `<div class="ring ${big ? 'big' : ''} ${tone(value)}"><svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${sw}"/>
<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${(C * v / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>
<b>${value ?? '–'}</b><span>${esc(label)}</span></div>`;
}

const table = (head, rows, cls = 'stack') => rows.length ? `<div class="scroll"><table class="${cls}"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>` : '';

// ================= AUDIT =================
export function renderAudit(r) {
  const a = r.ai || {};
  const cats = Object.entries(r.categories);
  const counts = { fail: 0, warn: 0, pass: 0 };
  r.issues.forEach(i => counts[i.status] != null && counts[i.status]++);

  const head = `<header class="r-head">
<div class="r-title"><p class="kicker">SEO & GEO audit · ${r.mode === 'site' ? `whole website · ${r.pages.length} pages crawled` : 'single page'} · ${esc(new Date(r.date).toLocaleDateString())}</p>
<h1>${esc(r.host)}</h1><a class="r-url" href="${safeHref(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a>
<div class="counts"><span class="c fail">${counts.fail} errors</span><span class="c warn">${counts.warn} warnings</span><span class="c pass">${counts.pass} passed</span></div></div>
<div class="r-scores">${ring(r.scores.overall, 'Overall', true)}<div class="duo">${ring(r.scores.seo, 'SEO')}${ring(r.scores.geo, 'GEO / AI')}</div></div>
</header>
<div class="bars">${cats.map(([k, name]) => r.scores.byCat[k] == null ? '' : `<div class="bar ${tone(r.scores.byCat[k])}"><span>${esc(name)}</span><i><em style="width:${r.scores.byCat[k]}%"></em></i><b>${r.scores.byCat[k]}</b></div>`).join('')}</div>`;

  const summary = a.executiveSummary ? `<p class="lead">${esc(a.executiveSummary)}</p>` : (r.aiError ? `<p class="note">AI analysis failed: ${esc(r.aiError)}</p>` : '<p class="note">AI analysis off — add ANTHROPIC_API_KEY for an executive summary, content/GEO review and Search Console interpretation.</p>');

  const prio = a.topPriorities?.length ? `<ol class="prio">${a.topPriorities.map(p => `<li><div class="ph"><strong>${esc(p.title)}</strong>${pill(p.impact)}<span class="tag">effort: ${esc(p.effort)}</span><span class="tag">${esc(r.categories[p.category] || p.category || '')}</span></div><p>${esc(p.why)}</p><p class="how"><b>How to fix:</b> ${esc(p.how)}</p></li>`).join('')}</ol>` : '';

  const issuesHtml = cats.map(([k, name]) => {
    const items = r.issues.filter(i => i.cat === k).sort((x, y) => ({ fail: 0, warn: 1, info: 2, pass: 3 }[x.status] - { fail: 0, warn: 1, info: 2, pass: 3 }[y.status]));
    if (!items.length) return '';
    return `<details class="cat" ${items.some(i => i.status === 'fail') ? 'open' : ''}><summary><span>${esc(name)}</span><b class="${tone(r.scores.byCat[k])}">${r.scores.byCat[k] ?? '–'}</b></summary>
${items.map(i => `<div class="issue ${i.status}">${pill(i.status)}<div><strong>${esc(i.title)}</strong><p>${esc(i.detail)}</p>${i.fix && i.status !== 'pass' ? `<p class="fix">${esc(i.fix)}</p>` : ''}${i.pages?.length > 1 || (i.pages?.length === 1 && r.pages.length > 1) ? `<details class="aff"><summary>${i.pages.length} affected page(s)</summary><ul>${i.pages.slice(0, 50).map(p => `<li><a href="${safeHref(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a> — ${esc(p.detail)}</li>`).join('')}</ul></details>` : ''}</div></div>`).join('')}</details>`;
  }).join('');

  const geo = a.geoAssessment ? `<div class="grid2"><div class="card"><h3>Summary</h3><p>${esc(a.geoAssessment.summary)}</p><h3>Citability</h3><p>${esc(a.geoAssessment.citability)}</p><h3>Entity clarity</h3><p>${esc(a.geoAssessment.entityClarity)}</p></div><div class="card"><h3>Recommendations</h3>${list(a.geoAssessment.recommendations)}</div></div>` : '';
  const ca = a.contentAssessment ? `<div class="grid2"><div class="card"><h3>Search intent</h3><p>${esc(a.contentAssessment.searchIntentMatch)}</p><h3>E-E-A-T</h3><p>${esc(a.contentAssessment.eeat)}</p></div><div class="card"><h3>Topical coverage</h3><p>${esc(a.contentAssessment.topicalCoverage)}</p><h3>Readability</h3><p>${esc(a.contentAssessment.readability)}</p>${a.contentAssessment.missingTopics?.length ? '<h3>Missing topics</h3>' + list(a.contentAssessment.missingTopics) : ''}</div></div>` : '';

  let gscHtml = '';
  if (r.gsc) {
    const sc = a.searchConsole;
    gscHtml += sc ? `<p class="lead">${esc(sc.summary)}</p><div class="grid2"><div class="card"><h3>What the data shows</h3>${list(sc.observations)}${sc.indexingIssues?.length ? '<h3>Indexing / coverage issues</h3>' + list(sc.indexingIssues) : ''}</div><div class="card"><h3>Quick wins</h3>${sc.quickWins?.length ? `<ul>${sc.quickWins.map(q => `<li><b>${esc(q.query_or_page)}</b> — ${esc(q.action)}</li>`).join('')}</ul>` : ''}</div></div>` : '';
    for (const t of r.gsc.tables.filter(t => t.strikingDistance?.length)) {
      gscHtml += `<h3>Striking-distance ${t.type} (position 4–20) · ${esc(t.source)}</h3>` + table(['' + (t.type === 'pages' ? 'Page' : 'Query'), 'Clicks', 'Impressions', 'CTR', 'Position'], t.strikingDistance.map(x => `<tr><td>${esc(x.key)}</td><td class="n">${x.clicks ?? ''}</td><td class="n">${x.impressions ?? ''}</td><td class="n">${x.ctr ?? ''}%</td><td class="n">${x.position?.toFixed?.(1) ?? ''}</td></tr>`));
    }
    for (const t of r.gsc.tables.filter(t => t.lowCtr?.length)) {
      gscHtml += `<h3>Low CTR — rewrite titles/meta · ${esc(t.source)}</h3>` + table([t.type === 'pages' ? 'Page' : 'Query', 'Impressions', 'CTR', 'Position'], t.lowCtr.map(x => `<tr><td>${esc(x.key)}</td><td class="n">${x.impressions}</td><td class="n">${x.ctr}%</td><td class="n">${x.position?.toFixed?.(1)}</td></tr>`));
    }
    const d = r.gsc.tables.find(t => t.type === 'dates' && t.trendPct != null);
    if (d) gscHtml += `<p class="note">Clicks trend (second half vs first half of period): <b>${d.trendPct > 0 ? '+' : ''}${d.trendPct}%</b></p>`;
    if (r.gsc.screenshots?.length) gscHtml += `<p class="note">Screenshots analysed: ${r.gsc.screenshots.map(esc).join(', ')}</p>`;
    if (r.gsc.errors?.length) gscHtml += `<p class="note">File issues: ${r.gsc.errors.map(esc).join('; ')}</p>`;
  }

  const notes = a.pageNotes?.length ? table(['Page', 'Primary keyword', 'Suggested title', 'Suggested meta description', 'Notes'], a.pageNotes.map(p => `<tr><td><a href="${safeHref(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a></td><td>${esc(p.primaryKeyword)}</td><td>${esc(p.suggestedTitle)}</td><td>${esc(p.suggestedMetaDescription)}</td><td>${esc(p.notes)}</td></tr>`)) : '';
  const pagesT = table(['URL', 'Status', 'Title', 'Words', 'Load', 'Schema', 'Issues'], r.pages.map(p => `<tr><td><a href="${safeHref(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a></td><td class="n">${esc(p.status)}</td><td>${esc(p.title || '—')}</td><td class="n">${p.words ?? ''}</td><td class="n">${p.ms} ms</td><td>${esc((p.schema || []).join(', '))}</td><td class="n">${p.issues}</td></tr>`));

  return `<article class="report">${head}
${sec('Executive summary', summary)}
${sec('Top priorities', prio)}
${sec('All checks by category', issuesHtml)}
${sec('GEO — AI search visibility', geo)}
${sec('Content quality', ca)}
${sec('Search Console insights', gscHtml)}
${sec('Page-by-page recommendations', notes)}
${sec('Pages crawled', pagesT)}
</article>`;
}

// ================= STRATEGY =================
export function renderStrategy(r) {
  const s = r.strategy || {}, g = r.gap || {};
  const pos = v => v ? `<span class="rank ${v.position <= 3 ? 'good' : v.position <= 10 ? 'mid' : 'bad'}">${v.position}</span>` : '<span class="rank na">–</span>';
  const hasRanks = r.matrix.some(m => Object.keys(m.ranks || {}).length);

  const head = `<header class="r-head"><div class="r-title"><p class="kicker">SEO & GEO strategy · ${esc(r.location)} · ${esc(new Date(r.date).toLocaleDateString())}${r.usedAudit ? ' · built on your audit' : ''}</p>
<h1>${esc(r.target)}</h1><p class="lead">${esc(r.business)}</p>${r.serpNote ? `<p class="note">${esc(r.serpNote)}</p>` : ''}</div></header>`;

  const comps = table(['Competitor', 'Top-10 appearances', 'Avg. position', 'SEO', 'GEO', 'Positioning', 'Strengths'], r.competitors.map(c => `<tr><td><a href="${safeHref('https://' + c.domain)}" target="_blank" rel="noopener"><b>${esc(c.domain)}</b></a></td><td class="n">${c.appearances ?? '—'}</td><td class="n">${c.avgPosition ?? '—'}</td><td class="n">${c.scores?.seo ?? '—'}</td><td class="n">${c.scores?.geo ?? '—'}</td><td>${esc(c.positioning || c.why || c.error || '')}</td><td>${esc((c.strengths || []).join('; '))}</td></tr>`));

  const matrix = hasRanks ? table(['Keyword', ...r.domains], r.matrix.map(m => `<tr><td>${esc(m.keyword)}</td>${r.domains.map(d => `<td class="n">${pos(m.ranks?.[d])}</td>`).join('')}</tr>`), 'matrix') : '<p class="note">Live ranking positions need a SERPER_API_KEY.</p>';

  const gaps = g.gaps?.length ? table(['Keyword', 'Competitors ranking', 'You', 'Intent', 'Difficulty', 'Opportunity', 'Page', 'How to win'], g.gaps.map(x => `<tr><td><b>${esc(x.keyword)}</b></td><td>${esc((x.competitorsRanking || []).join(', '))}</td><td class="n">${esc(x.targetPosition ?? '—')}</td><td>${esc(x.intent)}</td><td>${esc(x.difficulty)}</td><td>${pill(x.opportunity)}</td><td>${esc(x.recommendedPage)}</td><td>${esc(x.angle)}</td></tr>`)) : '';

  const kpis = s.northStarKpis?.length ? `<div class="kpis">${s.northStarKpis.map(k => `<div class="kpi"><span>${esc(k.kpi)}</span><b>${esc(k.target)}</b><small>${esc(k.how_to_measure)}</small></div>`).join('')}</div>` : '';
  const qw = s.quickWins?.length ? table(['Action', 'Why', 'Owner', 'Days'], s.quickWins.map(q => `<tr><td><b>${esc(q.action)}</b></td><td>${esc(q.why)}</td><td>${esc(q.owner)}</td><td class="n">${esc(q.days)}</td></tr>`)) : '';
  const road = s.roadmap?.length ? `<div class="road">${s.roadmap.map(p => `<div class="phase"><b>${esc(p.phase)}</b><span>${esc(p.focus)}</span>${list(p.tasks)}</div>`).join('')}</div>` : '';
  const clusters = s.topicClusters?.length ? s.topicClusters.map(c => `<div class="card"><h3>${esc(c.pillar)} <small>· ${esc(c.pillarKeyword)}</small></h3>${table(['Page', 'Keyword', 'Intent', 'Format'], (c.clusterPages || []).map(p => `<tr><td>${esc(p.title)}</td><td>${esc(p.keyword)}</td><td>${esc(p.intent)}</td><td>${esc(p.format)}</td></tr>`))}</div>`).join('') : '';
  const cal = s.contentCalendar?.length ? table(['Week', 'Title', 'Keyword', 'Type'], s.contentCalendar.map(c => `<tr><td class="n">${esc(c.week)}</td><td>${esc(c.title)}</td><td>${esc(c.keyword)}</td><td>${esc(c.type)}</td></tr>`)) : '';
  const geo = s.geoPlan ? `<p class="lead">${esc(s.geoPlan.summary)}</p><div class="grid2"><div class="card"><h3>Tactics</h3>${list(s.geoPlan.tactics)}</div><div class="card"><h3>AI prompts to track</h3>${list(s.geoPlan.promptsToTrack)}</div></div>` : '';
  const ideas = g.newKeywordIdeas?.length ? table(['Keyword idea', 'Intent', 'Why'], g.newKeywordIdeas.map(k => `<tr><td><b>${esc(k.keyword)}</b></td><td>${esc(k.intent)}</td><td>${esc(k.why)}</td></tr>`)) : '';

  return `<article class="report">${head}
${sec('Competitors', comps)}
${sec('Keyword rankings', matrix)}
${sec('Keyword gap', (g.summary ? `<p class="lead">${esc(g.summary)}</p>` : '') + gaps)}
${sec('New keyword opportunities', ideas + (g.questionsToAnswer?.length ? '<h3>Questions to answer (People Also Ask + AI prompts)</h3>' + list(g.questionsToAnswer) : ''))}
${sec('Positioning', s.positioning ? `<p class="lead">${esc(s.positioning)}</p>` : '')}
${sec('KPIs', kpis)}
${sec('Quick wins (first 30 days)', qw)}
${sec('Roadmap', road)}
${sec('Topic clusters', clusters)}
${sec('Content calendar', cal)}
${sec('GEO plan — getting cited by AI', geo)}
${sec('On-page plan', list(s.onPagePlan))}
${sec('Technical plan', list(s.technicalPlan))}
${sec('Link building & digital PR', list(s.linkBuilding))}
${sec('Local SEO', list(s.localSeo))}
${sec('Risks', list(s.risks))}
</article>`;
}

export const REPORT_CSS = `
:root{color-scheme:light dark;--bg:light-dark(#f4f6f8,#121518);--panel:light-dark(#fff,#1b1f23);--ink:light-dark(#111418,#eef1f4);--mute:light-dark(#5b6470,#9aa4ae);--line:light-dark(#e2e6ea,#2b3136);--track:light-dark(#e6eaee,#2b3136);--accent:light-dark(#1d2bd8,#8b95ff);--good:light-dark(#0f8a4b,#3ecf8e);--mid:light-dark(#b86e00,#f0b34a);--bad:light-dark(#d0241a,#ff6b5f)}
:root[data-theme=light]{color-scheme:light}:root[data-theme=dark]{color-scheme:dark}
*{box-sizing:border-box;min-width:0}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 Inter,system-ui,sans-serif;overflow-x:clip}
h1,h2,h3{font-family:'Inter Tight',Inter,sans-serif;line-height:1.1;text-wrap:balance}
a{color:var(--accent)}
.report{display:grid;gap:20px}
.r-head{display:flex;flex-wrap:wrap;gap:24px;align-items:center;justify-content:space-between;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:clamp(18px,3vw,32px)}
.r-title{flex:1 1 320px}.r-title h1{font-size:clamp(30px,4vw,44px);margin:4px 0}
.kicker{color:var(--mute);font-size:14px;margin:0}.r-url{font-size:14px;overflow-wrap:anywhere}
.counts{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.c{font-size:14px;font-weight:600;padding:4px 10px;border-radius:99px;background:var(--bg)}
.c.fail{color:var(--bad)}.c.warn{color:var(--mid)}.c.pass{color:var(--good)}
.r-scores{display:flex;gap:18px;align-items:center;flex-wrap:wrap}.duo{display:grid;gap:10px}
.ring{position:relative;display:grid;place-items:center;text-align:center}.ring svg{display:block}
.ring b{position:absolute;top:50%;left:50%;transform:translate(-50%,-62%);font:600 22px 'Inter Tight',sans-serif;color:var(--ink)}.ring.big b{font-size:38px}
.ring span{position:absolute;top:50%;left:50%;transform:translate(-50%,40%);font-size:11px;color:var(--mute);white-space:nowrap}.ring.big span{font-size:13px;transform:translate(-50%,70%)}
.good{color:var(--good)}.mid{color:var(--mid)}.bad{color:var(--bad)}.na{color:var(--mute)}
.bars{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:8px 24px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px 22px}
.bar{display:grid;grid-template-columns:minmax(0,1fr) 120px 34px;align-items:center;gap:10px;font-size:14px}.bar i{height:8px;border-radius:9px;background:var(--track);overflow:hidden}.bar em{display:block;height:100%;background:currentColor;border-radius:9px}.bar span{color:var(--ink)}.bar b{text-align:right}
.r-sec{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:clamp(18px,3vw,28px)}
.r-sec h2{font-size:24px;margin:0 0 14px}.r-sec h3{font-size:17px;margin:16px 0 6px}
.lead{font-size:17px;margin:0 0 10px;max-width:75ch}.note{color:var(--mute);font-size:14px}
.pill{display:inline-block;font-size:12px;font-weight:600;padding:2px 9px;border-radius:99px;white-space:nowrap;background:var(--bg)}
.pill.pass,.pill.low{color:var(--good)}.pill.warn,.pill.medium{color:var(--mid)}.pill.fail,.pill.high{color:var(--bad)}.pill.info{color:var(--mute)}
.pill.high{background:light-dark(#fde8e6,#3a1d1b)}.pill.fail{background:light-dark(#fde8e6,#3a1d1b)}
.tag{font-size:12px;color:var(--mute)}
.prio{margin:0;padding-left:22px;display:grid;gap:14px}.prio li::marker{font-weight:700}.prio p{margin:4px 0}.ph{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.how{font-size:15px;color:var(--mute)}
details.cat{border-top:1px solid var(--line)}details.cat>summary{display:flex;justify-content:space-between;padding:14px 0;cursor:pointer;font:600 17px 'Inter Tight',sans-serif;list-style:none}details.cat>summary::-webkit-details-marker{display:none}details.cat>summary::before{content:'▸';margin-right:8px;color:var(--mute)}details.cat[open]>summary::before{content:'▾'}details.cat>summary span{flex:1}
.issue{display:grid;grid-template-columns:84px minmax(0,1fr);gap:12px;padding:10px 0;border-top:1px dashed var(--line)}.issue p{margin:2px 0;font-size:15px;overflow-wrap:anywhere}.issue .fix{color:var(--accent)}.issue.pass p{color:var(--mute)}
.aff summary{cursor:pointer;font-size:14px;color:var(--mute)}.aff li{font-size:13px;overflow-wrap:anywhere}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:16px}.card{background:var(--bg);border-radius:10px;padding:14px 18px}.card h3:first-child{margin-top:4px}.card ul{padding-left:18px;margin:6px 0}
table{width:100%;border-collapse:collapse;font-size:14px}th{text-align:left;font-weight:600;color:var(--mute);border-bottom:1px solid var(--line);padding:8px}td{border-bottom:1px solid var(--line);padding:8px;vertical-align:top;overflow-wrap:anywhere}td.n{text-align:right;white-space:nowrap}
.matrix th:not(:first-child),.matrix td:not(:first-child){text-align:center}
.rank{display:inline-block;min-width:30px;padding:2px 6px;border-radius:6px;font-weight:600;background:var(--bg)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:12px}.kpi{background:var(--bg);border-radius:10px;padding:14px}.kpi span{display:block;font-size:14px;color:var(--mute)}.kpi b{display:block;font:600 22px 'Inter Tight',sans-serif;margin:4px 0}.kpi small{font-size:13px;color:var(--mute)}
.road{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:12px}.phase{background:var(--bg);border-radius:10px;padding:14px;border-top:4px solid var(--accent)}.phase b{font:600 18px 'Inter Tight',sans-serif}.phase span{display:block;color:var(--mute);font-size:14px;margin:4px 0}.phase ul{padding-left:18px;font-size:14px}
.scroll{overflow-x:auto}
@media(max-width:600px){table{font-size:13px}.stack thead{display:none}.stack tr{display:grid;padding-block:10px}.stack td{display:flow-root;border:0;padding:3px 0;padding-inline-start:8em;text-align:start}.stack td::before{content:attr(data-l);float:inline-start;width:7.5em;margin-inline-start:-8em;color:var(--mute);white-space:normal}.stack td:empty{display:none}.issue{grid-template-columns:1fr}.bar{grid-template-columns:minmax(0,1fr) 80px 30px}}
@media print{body{background:#fff}.r-sec,.r-head,.bars{break-inside:avoid-page;border-color:#ddd}details{display:block}details>*{display:block}.no-print{display:none!important}}
`;
