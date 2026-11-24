// Parses Google Search Console exports (CSV, XLSX, or the ZIP GSC gives you) and screenshots.
import ExcelJS from 'exceljs';
import { parse as parseCsv } from 'csv-parse/sync';
import AdmZip from 'adm-zip';

const IMG = /\.(png|jpe?g|webp|gif)$/i;

const num = v => {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/[%,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

function rowsFromCsv(buf) {
  const text = buf.toString('utf8').replace(/^﻿/, '');
  return parseCsv(text, { columns: true, skip_empty_lines: true, relax_column_count: true, trim: true });
}

async function sheetsFromXlsx(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const out = [];
  wb.eachSheet(ws => {
    const rows = [];
    let header = null;
    ws.eachRow((row) => {
      const vals = row.values.slice(1).map(v => (v && typeof v === 'object' && 'result' in v) ? v.result : (v && v.text) ? v.text : v);
      if (!header) { header = vals.map(v => String(v ?? '').trim()); return; }
      const o = {}; header.forEach((h, i) => { if (h) o[h] = vals[i]; }); rows.push(o);
    });
    out.push({ name: ws.name, rows });
  });
  return out;
}

// Identify what a table is: queries, pages, countries, devices, dates
function classify(name, rows) {
  if (!rows.length) return 'empty';
  const cols = Object.keys(rows[0]).map(c => c.toLowerCase());
  const n = name.toLowerCase();
  if (cols.some(c => /quer|keyword/.test(c)) || /quer/.test(n)) return 'queries';
  if (cols.some(c => /^(top )?pages?$|url|landing/.test(c)) || /page/.test(n)) return 'pages';
  if (cols.some(c => /countr/.test(c))) return 'countries';
  if (cols.some(c => /device/.test(c))) return 'devices';
  if (cols.some(c => /^date$/.test(c)) || /chart|date/.test(n)) return 'dates';
  return 'other';
}

function normalize(rows) {
  return rows.map(r => {
    const e = Object.entries(r);
    const key = e[0]?.[1];
    const get = re => { const f = e.find(([k]) => re.test(k.toLowerCase())); return f ? f[1] : null; };
    return {
      key: String(key ?? ''),
      clicks: num(get(/click/)),
      impressions: num(get(/impress/)),
      ctr: num(get(/ctr/)),
      position: num(get(/position/))
    };
  }).filter(r => r.key);
}

function summarizeTable(type, rows) {
  const n = normalize(rows);
  const tot = n.reduce((s, r) => ({ clicks: s.clicks + (r.clicks || 0), impressions: s.impressions + (r.impressions || 0) }), { clicks: 0, impressions: 0 });
  const s = { type, rowCount: n.length, totals: tot };
  if (type === 'queries' || type === 'pages') {
    s.top = [...n].sort((a, b) => (b.clicks || 0) - (a.clicks || 0)).slice(0, 25);
    // Striking distance: position 4–20 with impressions — fastest wins
    s.strikingDistance = n.filter(r => r.position >= 4 && r.position <= 20 && r.impressions >= 10).sort((a, b) => b.impressions - a.impressions).slice(0, 25);
    // Low CTR: good position but CTR below expectation
    s.lowCtr = n.filter(r => r.position && r.position <= 10 && r.impressions >= 50 && r.ctr != null && r.ctr < (r.position <= 3 ? 8 : 2.5)).sort((a, b) => b.impressions - a.impressions).slice(0, 15);
  } else if (type === 'dates') {
    const d = [...n].sort((a, b) => a.key.localeCompare(b.key));
    s.series = d;
    if (d.length >= 14) {
      const half = Math.floor(d.length / 2);
      const a = d.slice(0, half).reduce((x, r) => x + (r.clicks || 0), 0), b = d.slice(half).reduce((x, r) => x + (r.clicks || 0), 0);
      s.trendPct = a ? Math.round(((b - a) / a) * 100) : null;
    }
  } else {
    s.top = [...n].sort((a, b) => (b.clicks || 0) - (a.clicks || 0)).slice(0, 10);
  }
  return s;
}

/** files: multer files [{originalname, buffer, mimetype}] → { tables:[], images:[{name, mediaType, base64}] } */
export async function parseGscFiles(files = []) {
  const tables = [], images = [], errors = [];
  const handle = async (name, buf, mime = '') => {
    try {
      if (IMG.test(name) || /^image\//.test(mime)) {
        const ext = name.split('.').pop().toLowerCase();
        images.push({ name, mediaType: mime && mime.startsWith('image/') ? mime : `image/${ext === 'jpg' ? 'jpeg' : ext}`, base64: buf.toString('base64') });
      } else if (/\.zip$/i.test(name)) {
        for (const e of new AdmZip(buf).getEntries()) if (!e.isDirectory) await handle(e.entryName, e.getData());
      } else if (/\.xlsx$/i.test(name)) {
        for (const sh of await sheetsFromXlsx(buf)) { const t = classify(sh.name, sh.rows); if (t !== 'empty') tables.push({ source: `${name} › ${sh.name}`, ...summarizeTable(t, sh.rows) }); }
      } else if (/\.(csv|tsv|txt)$/i.test(name)) {
        const rows = rowsFromCsv(buf); const t = classify(name, rows);
        if (t !== 'empty') tables.push({ source: name, ...summarizeTable(t, rows) });
      } else errors.push(`${name}: unsupported file type`);
    } catch (e) { errors.push(`${name}: ${e.message}`); }
  };
  for (const f of files) await handle(f.originalname, f.buffer, f.mimetype);
  return { tables, images, errors };
}
