import { renderAudit, renderStrategy, REPORT_CSS } from './render.js';

const $ = s => document.querySelector(s);
const style = document.createElement('style');
style.textContent = REPORT_CSS;
document.head.prepend(style);

// label stacked table cells on mobile
new MutationObserver(() => {
  for (const c of document.querySelectorAll('.stack td:not([data-l])')) { let i = 0, p = c; while ((p = p.previousElementSibling)) i += p.colSpan; c.dataset.l = c.closest('table').rows[0].cells[i]?.textContent || ''; }
}).observe(document.body, { childList: true, subtree: true });

let cfg = {}, lastAudit = null; // {jobId, result}
fetch('/api/config').then(r => r.json()).then(c => {
  cfg = c;
  $('#cfg').innerHTML = `<span class="${c.ai ? 'on' : 'off'}">AI ${c.ai ? 'on' : 'off'}</span><span class="${c.serp ? 'on' : 'off'}">Google rankings ${c.serp ? 'on' : 'off'}</span>`;
  if (!c.ai) $('#a-hint').textContent = 'AI is off: you will get the automated checks only. Add ANTHROPIC_API_KEY for AI insights and screenshot reading.';
  if (!c.ai) $('#s-hint').textContent = 'Strategy needs ANTHROPIC_API_KEY in your .env file.';
  else if (!c.serp) $('#s-hint').textContent = 'No SERPER_API_KEY: competitors will come from AI web search, without exact Google positions.';
  $('[name=maxPages]').max = c.maxPages;
});

// ---------- tabs ----------
function show(tab) {
  document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab));
  $('#view-audit').hidden = tab !== 'audit';
  $('#view-strategy').hidden = tab !== 'strategy';
  if (location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab);
}
document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
show(location.hash === '#strategy' ? 'strategy' : 'audit');

// ---------- countries ----------
const COUNTRIES = [['us', 'United States'], ['pk', 'Pakistan'], ['gb', 'United Kingdom'], ['ae', 'United Arab Emirates'], ['sa', 'Saudi Arabia'], ['in', 'India'], ['ca', 'Canada'], ['au', 'Australia'], ['de', 'Germany'], ['fr', 'France'], ['es', 'Spain'], ['it', 'Italy'], ['nl', 'Netherlands'], ['qa', 'Qatar'], ['kw', 'Kuwait'], ['om', 'Oman'], ['bh', 'Bahrain'], ['eg', 'Egypt'], ['tr', 'Türkiye'], ['za', 'South Africa'], ['ng', 'Nigeria'], ['sg', 'Singapore'], ['my', 'Malaysia'], ['id', 'Indonesia'], ['ph', 'Philippines'], ['bd', 'Bangladesh'], ['nz', 'New Zealand'], ['ie', 'Ireland'], ['br', 'Brazil'], ['mx', 'Mexico']];
$('#country').innerHTML = COUNTRIES.map(([c, n]) => `<option value="${c}">${n}</option>`).join('');

// ---------- audit form ----------
document.querySelectorAll('[name=mode]').forEach(r => r.addEventListener('change', () => { $('#pages-field').hidden = $('[name=mode]:checked').value !== 'site'; }));

let files = [];
const renderFiles = () => {
  $('#files').innerHTML = files.map((f, i) => `<li><span></span><small>${(f.size / 1024).toFixed(0)} KB</small><button type="button" data-rm="${i}" aria-label="Remove file">×</button></li>`).join('');
  [...$('#files').children].forEach((li, i) => { li.firstChild.textContent = files[i].name; });
};
const addFiles = list => { files = [...files, ...list].slice(0, 12); renderFiles(); };
$('#gsc').addEventListener('change', e => { addFiles([...e.target.files]); e.target.value = ''; });
$('#files').addEventListener('click', e => { if (e.target.dataset.rm != null) { files.splice(+e.target.dataset.rm, 1); renderFiles(); } });
const drop = $('#drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => addFiles([...e.dataTransfer.files]));
document.addEventListener('paste', e => { // paste a screenshot straight from clipboard
  if ($('#view-audit').hidden) return;
  const imgs = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
  if (imgs.length) addFiles(imgs.map((f, i) => new File([f], `pasted-screenshot-${Date.now()}-${i}.png`, { type: f.type })));
});

async function poll(jobId, prefix) {
  const box = $(`#${prefix}-progress`);
  box.hidden = false;
  for (;;) {
    await new Promise(r => setTimeout(r, 1200));
    const j = await fetch('/api/jobs/' + jobId).then(r => r.json());
    if (j.error && !j.status) throw new Error(j.error);
    box.querySelector('i').style.width = j.progress + '%';
    box.querySelector('p').textContent = j.message;
    if (j.status === 'done') { box.hidden = true; return j.result; }
    if (j.status === 'error') { box.hidden = true; throw new Error(j.error); }
  }
}

const showError = (el, msg) => { el.innerHTML = '<div class="error"></div>'; el.firstChild.textContent = msg; };

$('#audit-form').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  if (!fd.get('url').trim()) return $('#a-url').focus();
  files.forEach(f => fd.append('gsc', f));
  $('#a-run').disabled = true; $('#a-result').innerHTML = ''; $('#a-actions').hidden = true;
  try {
    const r = await fetch('/api/audit', { method: 'POST', body: fd }).then(r => r.json());
    if (r.error) throw new Error(r.error);
    const result = await poll(r.jobId, 'a');
    lastAudit = { jobId: r.jobId, result };
    $('#a-result').innerHTML = renderAudit(result);
    $('#a-download').href = `/api/report/${r.jobId}?download=1`;
    $('#a-actions').hidden = false;
    $('#a-actions').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    $('#s-url').value = result.url;
    $('#use-audit-host').textContent = result.host;
    $('#use-audit-wrap').hidden = false;
    const sc = $('#strategy-form [name=context]');
    if (!sc.value) sc.value = $('#audit-form [name=context]').value;
  } catch (err) { showError($('#a-result'), err.message); }
  $('#a-run').disabled = false;
});

$('#to-strategy').addEventListener('click', () => { show('strategy'); scrollTo(0, 0); });

// ---------- strategy form ----------
$('#strategy-form').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  if (!fd.url.trim()) return $('#s-url').focus();
  fd.includeBig = !!fd.includeBig;
  fd.locationName = $('#country').selectedOptions[0].textContent;
  if (lastAudit && $('#use-audit').checked && !$('#use-audit-wrap').hidden) fd.auditId = lastAudit.jobId;
  $('#s-run').disabled = true; $('#s-result').innerHTML = ''; $('#s-actions').hidden = true;
  try {
    const r = await fetch('/api/strategy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fd) }).then(r => r.json());
    if (r.error) throw new Error(r.error);
    const result = await poll(r.jobId, 's');
    $('#s-result').innerHTML = renderStrategy(result);
    $('#s-download').href = `/api/report/${r.jobId}?download=1`;
    $('#s-actions').hidden = false;
  } catch (err) { showError($('#s-result'), err.message); }
  $('#s-run').disabled = false;
});

// print: open all collapsibles first
document.querySelectorAll('[data-print]').forEach(b => b.addEventListener('click', () => window.print()));
addEventListener('beforeprint', () => document.querySelectorAll('details').forEach(d => d.open = true));
