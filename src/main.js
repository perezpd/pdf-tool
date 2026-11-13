const $ = (id) => document.getElementById(id);
const drop = $('drop');
const input = $('file');
const job = $('job');
const bar = $('bar');
const fill = bar.firstElementChild;
const statusEl = $('status');
const result = $('result');
const download = $('download');

// AGPL: link to this site's source. On <user>.github.io/<repo>/ we can derive the repo URL.
(() => {
  const m = /^([\w-]+)\.github\.io$/i.exec(location.hostname);
  const repo = location.pathname.split('/').filter(Boolean)[0];
  if (m && repo) $('source').href = `https://github.com/${m[1]}/${repo}`;
})();

let worker = null; // created on first file, so the wasm loads lazily
let jobId = 0;
let busy = false;
let lastUrl = null;

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./gs.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = onWorkerMessage;
    worker.onerror = (e) => {
      fail(`Worker error: ${e.message || 'failed to start'}`);
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

const fmtSize = (n) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;

function setProgress(fraction) {
  if (fraction == null) {
    bar.classList.add('indeterminate');
    bar.removeAttribute('aria-valuenow');
  } else {
    bar.classList.remove('indeterminate');
    const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
    fill.style.width = `${pct}%`;
    bar.setAttribute('aria-valuenow', String(pct));
  }
}

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
}

function fail(message) {
  busy = false;
  drop.classList.remove('disabled');
  bar.hidden = true;
  setStatus(message, 'error');
  result.hidden = false;
  download.hidden = true;
}

let current = null; // { name, size, started }

function onWorkerMessage({ data }) {
  if (data.id !== jobId) return;
  switch (data.type) {
    case 'status':
      setStatus(data.text);
      break;
    case 'progress':
      if (data.phase === 'download') {
        const { done, total } = data;
        setProgress(total && done <= total ? done / total : null);
        setStatus(`Downloading Ghostscript (first time only)… ${fmtSize(done)}`);
      } else {
        setProgress(data.total ? data.done / data.total : null);
        if (data.total) setStatus(`Converting text to outlines… page ${data.done} of ${data.total}`);
      }
      break;
    case 'done': {
      busy = false;
      drop.classList.remove('disabled');
      const blob = new Blob([data.bytes], { type: 'application/pdf' });
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = URL.createObjectURL(blob);
      const outName = current.name.replace(/\.pdf$/i, '') + '-traced.pdf';
      download.href = lastUrl;
      download.download = outName;
      download.hidden = false;
      result.hidden = false;
      setProgress(1);
      const secs = ((performance.now() - current.started) / 1000).toFixed(1);
      setStatus(`Done in ${secs}s: ${outName} (${fmtSize(blob.size)}, was ${fmtSize(current.size)})`, 'ok');
      download.focus();
      break;
    }
    case 'error':
      fail(data.message);
      break;
  }
}

async function handleFile(file) {
  if (!file || busy) return;
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const isPdf = new TextDecoder('latin1').decode(head).includes('%PDF-');

  current = { name: file.name, size: file.size, started: performance.now() };
  job.hidden = false;
  $('job-name').textContent = file.name;
  $('job-size').textContent = fmtSize(file.size);
  result.hidden = true;
  bar.hidden = false;
  setProgress(null);

  if (!isPdf) return fail('This does not look like a PDF file.');

  busy = true;
  drop.classList.add('disabled');
  setStatus('Preparing…');
  const bytes = await file.arrayBuffer();
  jobId += 1;
  getWorker().postMessage({ type: 'trace', id: jobId, bytes }, [bytes]);
}

input.addEventListener('change', () => {
  handleFile(input.files[0]);
  input.value = '';
});
drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    input.click();
  }
});
for (const ev of ['dragenter', 'dragover']) {
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    if (!busy) drop.classList.add('over');
  });
}
for (const ev of ['dragleave', 'drop']) {
  drop.addEventListener(ev, () => drop.classList.remove('over'));
}
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  handleFile(e.dataTransfer.files[0]);
});
// Dropping a file elsewhere on the page shouldn't navigate away from it.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

$('again').addEventListener('click', () => input.click());
