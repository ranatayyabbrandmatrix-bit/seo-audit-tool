# SEO + GEO Auditor

A self-hosted web tool with **two independent modules**:

1. **Audit:** paste a page URL or a homepage and audit *this page only* or the *whole website*. Optionally attach Google Search Console screenshots or exports.
2. **Competitors & strategy:** finds competitors on Google, checks keyword rankings for you and each competitor, produces a keyword gap, and writes a full SEO + GEO strategy. It works without an audit. If you ran one, it reuses the audit's results.

Both modules produce a report you can download as HTML or print/save as PDF.

## Quick start

```bash
npm install
cp .env.example .env      # add ANTHROPIC_API_KEY (and SERPER_API_KEY for live rankings)
npm start                 # → http://localhost:3000
```

Requires Node.js 18+.

| Key | Needed for | Without it |
|---|---|---|
| `ANTHROPIC_API_KEY` | AI summary, priorities, content/E-E-A-T and GEO review, reading GSC screenshots, keyword gap, strategy | Audit still runs all automated checks; Strategy is disabled |
| `SERPER_API_KEY` | Live Google positions (any country/language), competitor discovery by SERP overlap, People Also Ask | Competitors come from Claude web search; no exact positions |

## What the audit checks

**Technical:** HTTP status, redirect chains, HTTPS and HTTP→HTTPS redirect, noindex, robots.txt blocking, canonical, lang, hreflang, XML sitemap, broken pages, duplicate titles/descriptions (site mode).
**On-page:** title and meta description length, H1 count, H2/H3 structure, image alt text, internal links, Open Graph, clean URLs.
**Content:** word count/thin content. With AI: search-intent match, E-E-A-T, topical coverage, missing topics.
**Speed & mobile:** server response time, HTML size, viewport, render-blocking assets, lazy loading, compression.
**Structured data:** JSON-LD/microdata presence and validity, Organization/LocalBusiness/Person entity, breadcrumbs.
**GEO (AI search readiness):** whether robots.txt allows GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended and others; llms.txt; question-style headings; FAQ; statistics; outbound citations; lists/tables; author signals; freshness dates; answer-first intro; JavaScript-only content.

Each category gets a 0–100 score, and the report also shows an overall, SEO and GEO score. In whole-site mode every issue lists the affected URLs.

### Search Console uploads
- **Screenshots** (PNG/JPG/WebP): Performance, Pages/Indexing, Core Web Vitals. Claude reads the numbers and charts. You can also paste a screenshot with Ctrl+V.
- **CSV / XLSX / ZIP exports** (Performance → Export): the tool finds *striking-distance* queries and pages (position 4–20), *low-CTR* rows (good position but few clicks, so the title/meta needs rewriting), and the click trend.

## Strategy module output
Competitor table (top-10 appearances, average position, their SEO/GEO scores, positioning) · keyword × domain ranking matrix · keyword gap with intent, difficulty estimate, opportunity and how to win · new keyword ideas and questions to answer · positioning · KPIs · 30-day quick wins · phased roadmap · topic clusters · content calendar · GEO plan (including AI prompts to track) · on-page, technical, link building, local SEO plans · risks.

## Notes
- Jobs and reports are kept in memory for 6 hours. Download reports you want to keep.
- Keyword difficulty is an AI **estimate**. Serper doesn't provide search volumes, so for exact volumes you'd add a provider such as DataForSEO or the Semrush API in `src/serp.js`.
- The crawler fetches raw HTML and doesn't run JavaScript, which is also how most AI crawlers see your site.
- Respect sites' terms. The crawler identifies itself as `SEO-GEO-AuditBot`.

## Project layout
```
server.js          API + job runner (/api/audit, /api/strategy, /api/jobs/:id, /api/report/:id)
src/crawler.js     page fetch, site crawl (BFS + sitemap), robots/llms.txt
src/checks.js      all SEO + GEO checks and scoring
src/gsc.js         Search Console CSV/XLSX/ZIP/screenshot parsing
src/serp.js        Serper.dev Google results, competitor discovery, ranking matrix
src/ai.js          Claude prompts: audit insights, keywords, gap, strategy
public/            UI (index.html, app.js, app.css) + shared report renderer (render.js)
```

## Deploying
It runs anywhere Node runs: Render, Railway, a VPS (with `pm2 start server.js`), etc. Set the env vars there. If other people will use it, add authentication in front of it, because every run spends your API credits.

## Putting it online (Render)
1. Create a GitHub repository and upload the contents of this folder (not `node_modules` or `.env`).
2. On render.com: **New → Blueprint** → choose the repo. Render reads `render.yaml`.
3. Fill in `ANTHROPIC_API_KEY`, `SERPER_API_KEY` and `APP_PASSWORD`, then click **Apply**.
4. Open the `.onrender.com` link and log in as `admin` with your `APP_PASSWORD`.

The free plan sleeps after 15 minutes of no use (the first load then takes ~1 minute) and forgets reports when it restarts. Upgrade to Starter to keep it always on.
A `Dockerfile` is included for Railway, Fly.io, a VPS or any Docker host.
