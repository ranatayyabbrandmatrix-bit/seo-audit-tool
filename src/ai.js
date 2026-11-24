// Claude API calls: audit insights (incl. reading GSC screenshots), keyword extraction, competitor fallback, strategy.
import Anthropic from '@anthropic-ai/sdk';

export const hasAI = () => !!process.env.ANTHROPIC_API_KEY;
const model = () => process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
let client;
const ai = () => (client ||= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));

function parseJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const t = fenced ? fenced[1] : text;
  const start = t.indexOf('{'), end = t.lastIndexOf('}');
  if (start < 0) throw new Error('AI did not return JSON');
  return JSON.parse(t.slice(start, end + 1));
}

async function ask({ system, content, maxTokens = 8000, webSearch = false }) {
  const params = { model: model(), max_tokens: maxTokens, system, messages: [{ role: 'user', content }] };
  if (webSearch) params.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }];
  const res = await ai().messages.create(params);
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  return parseJson(text);
}

const SYS = `You are a senior technical SEO and GEO (Generative Engine Optimization — visibility in Google AI Overviews, ChatGPT, Perplexity, Claude, Gemini) consultant.
Be specific, evidence-based and actionable. Reference the actual URLs, headings and numbers you were given. Never invent metrics you were not given; when you estimate, label it "estimate".
Reply with ONLY valid JSON, no prose outside JSON.`;

const compactPages = pages => pages.slice(0, 8).map(p => ({
  url: p.facts.url, title: p.facts.title, description: p.facts.desc, h1: p.facts.h1s, headings: (p.facts.headings || []).slice(0, 25),
  words: p.facts.words, schema: p.facts.schema, firstParagraph: p.facts.firstParagraph, textSample: (p.facts.textSample || '').slice(0, p.facts && pages.length > 3 ? 1800 : 4500)
}));

/** Qualitative audit + Search Console interpretation (tables and screenshots). */
export async function auditInsights({ url, mode, scores, issues, pages, gsc, context }) {
  const failing = issues.filter(i => i.status === 'fail' || i.status === 'warn').map(i => ({ cat: i.cat, title: i.title, status: i.status, detail: i.detail, pages: (i.pages || []).length }));
  const content = [];
  for (const img of (gsc?.images || []).slice(0, 6)) {
    content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } });
  }
  content.push({ type: 'text', text: `Audit target: ${url} (${mode === 'site' ? 'whole site, ' + pages.length + ' pages crawled' : 'single page'})
Business context from user: ${context || 'not provided'}

Automated scores: ${JSON.stringify(scores)}
Automated issues found: ${JSON.stringify(failing)}
Page content: ${JSON.stringify(compactPages(pages))}
Search Console data tables (parsed from uploads): ${gsc?.tables?.length ? JSON.stringify(gsc.tables.map(t => ({ ...t, series: t.series ? t.series.slice(-60) : undefined }))) : 'none'}
${gsc?.images?.length ? `${gsc.images.length} Search Console screenshot(s) are attached above — read every number, chart trend, query, page and error you can see in them.` : ''}

Return JSON:
{
 "executiveSummary": "4-6 sentences, plain language, what's good, what's hurting rankings and AI visibility most",
 "topPriorities": [{"title":"", "why":"", "how":"step-by-step fix", "impact":"high|medium|low", "effort":"low|medium|high", "category":"technical|onpage|content|performance|schema|geo"}],   // 6-10, ordered by impact/effort
 "contentAssessment": {"searchIntentMatch":"", "eeat":"", "topicalCoverage":"", "readability":"", "missingTopics":["..."]},
 "geoAssessment": {"summary":"", "citability":"how likely LLMs are to quote this content and why", "entityClarity":"", "recommendations":["..."]},
 "pageNotes": [{"url":"", "primaryKeyword":"best guess", "suggestedTitle":"", "suggestedMetaDescription":"", "notes":""}],
 "searchConsole": ${gsc && (gsc.tables.length || gsc.images.length) ? `{"summary":"what the data shows", "observations":["specific numbers/trends seen"], "quickWins":[{"query_or_page":"", "action":""}], "indexingIssues":["any coverage/indexing/CWV problems visible"]}` : 'null'}
}` });
  return ask({ system: SYS, content, maxTokens: 10000 });
}

/** Seed keywords that describe what this site should rank for. */
export async function extractKeywords({ url, pages, context, count = 10, location }) {
  return ask({
    system: SYS,
    content: `Website: ${url}. Target market: ${location || 'not specified'}. Business context: ${context || 'none'}.
Content: ${JSON.stringify(compactPages(pages).map(p => ({ url: p.url, title: p.title, h1: p.h1, headings: p.headings.slice(0, 12), text: p.textSample.slice(0, 1200) })))}
Return JSON {"business":"one-line description","niche":"","keywords":[{"keyword":"","intent":"informational|commercial|transactional|navigational","type":"head|mid|long-tail"}]} with ${count} realistic Google search queries real customers type to find this kind of business/page (mix commercial and informational; avoid brand name; localize to the market if one is given).`,
    maxTokens: 2000
  });
}

/** Extract the keywords a competitor page is targeting. */
export async function competitorKeywords({ domain, pages, niche, count = 8 }) {
  return ask({
    system: SYS,
    content: `Competitor ${domain} in niche "${niche}". Their pages: ${JSON.stringify(compactPages(pages).map(p => ({ url: p.url, title: p.title, h1: p.h1, headings: p.headings.slice(0, 15), text: p.textSample.slice(0, 900) })))}
Return JSON {"positioning":"", "strengths":["..."], "contentTypes":["..."], "keywords":["${count} Google queries this competitor is clearly targeting"]}`,
    maxTokens: 1500
  });
}

/** Fallback when no SERP key: use Claude web search to find competitors. */
export async function competitorsViaWebSearch({ url, business, keywords, location, max = 5 }) {
  return ask({
    system: SYS + ' You can use web search.',
    webSearch: true,
    content: `Find the top ${max} real organic-search competitors of ${url} (${business}) in ${location || 'its main market'}. Search Google-style for these queries and see who ranks: ${keywords.slice(0, 6).join('; ')}.
Return JSON {"competitors":[{"domain":"example.com","why":"", "keywordsSeenRanking":["..."]}], "note":"rankings are observed via web search, not exact Google positions"}`,
    maxTokens: 4000
  });
}

/** Keyword gap analysis + optional ideas, from ranking matrix. */
export async function keywordGap({ target, competitors, matrix, compInfo, niche, location }) {
  return ask({
    system: SYS,
    content: `Target: ${target}. Niche: ${niche}. Market: ${location || 'n/a'}.
Competitors: ${JSON.stringify(compInfo)}
Ranking matrix (null = not in top 30; positions are live Google results${matrix.some(r => r.ranks && Object.keys(r.ranks).length) ? '' : ' — NOT AVAILABLE, infer from competitor content'}): ${JSON.stringify(matrix)}
Return JSON {
 "summary":"",
 "gaps":[{"keyword":"", "competitorsRanking":["domain (pos)"], "targetPosition":null, "intent":"", "difficulty":"estimate: low|medium|high", "opportunity":"high|medium|low", "recommendedPage":"new page / optimize existing URL", "angle":"how to beat them"}],
 "strengths":[{"keyword":"", "note":"where target already wins"}],
 "newKeywordIdeas":[{"keyword":"", "intent":"", "why":""}],
 "questionsToAnswer":["PAA / conversational questions worth targeting for AI answers"]
}
Order gaps by opportunity. Include 10-20 gaps.`,
    maxTokens: 8000
  });
}

/** Full SEO + GEO strategy. Audit is optional. */
export async function buildStrategy({ target, niche, location, goals, timeframe, audit, competitors, gap, gscSummary }) {
  return ask({
    system: SYS,
    content: `Build a complete SEO + GEO growth strategy for ${target} (${niche}). Market: ${location || 'n/a'}. Goals: ${goals || 'grow organic traffic and leads'}. Timeframe: ${timeframe || '6 months'}.
Audit results (may be absent): ${audit ? JSON.stringify({ scores: audit.scores, priorities: audit.ai?.topPriorities, geo: audit.ai?.geoAssessment, issues: audit.issues.filter(i => i.status === 'fail').map(i => i.title) }) : 'not run'}
Search Console insights: ${gscSummary ? JSON.stringify(gscSummary) : 'none'}
Competitors: ${JSON.stringify(competitors)}
Keyword gap: ${JSON.stringify(gap)}
Return JSON {
 "positioning":"how to differentiate vs competitors",
 "northStarKpis":[{"kpi":"", "target":"", "how_to_measure":""}],
 "quickWins":[{"action":"", "why":"", "owner":"dev|content|seo", "days":0}],
 "roadmap":[{"phase":"Month 1", "focus":"", "tasks":["..."]}],
 "topicClusters":[{"pillar":"", "pillarKeyword":"", "clusterPages":[{"title":"", "keyword":"", "intent":"", "format":"guide|comparison|landing|FAQ|tool"}]}],
 "contentCalendar":[{"week":1, "title":"", "keyword":"", "type":"new|update"}],
 "onPagePlan":["..."],
 "technicalPlan":["..."],
 "geoPlan":{"summary":"", "tactics":["specific tactics for ChatGPT/Perplexity/AI Overviews citations: entity building, structured answers, original data, brand mentions, schema, llms.txt, reviews..."], "promptsToTrack":["prompts to monitor brand mentions in AI assistants"]},
 "linkBuilding":["..."],
 "localSeo":["only if relevant, else empty"],
 "risks":["..."]
}`,
    maxTokens: 14000
  });
}
