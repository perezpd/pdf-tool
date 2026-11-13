// Runs Ghostscript (WASM) off the main thread.
//
// Messages in:  { type: 'trace', id, bytes: ArrayBuffer }
// Messages out: { type: 'status', id, text }
//               { type: 'progress', id, phase: 'download' | 'pages', done, total }
//               { type: 'done', id, bytes: ArrayBuffer }
//               { type: 'error', id, message }
//
// The ~15 MB wasm is only fetched when the first file arrives (this worker is
// itself created lazily). Its URL is content-hashed by Vite, so the browser
// HTTP cache serves it on later visits.

import wasmUrl from '@okathira/ghostpdl-wasm/gs.wasm?url';

let gsPromise = null; // one Ghostscript instance, reused across runs
let currentId = null;
let log = [];

async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download Ghostscript (${res.status})`);
  // Content-Length is the compressed size if the server gzips, so treat it as a hint.
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(received, total);
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function onGsLine(line) {
  log.push(line);
  if (log.length > 200) log.shift();
  // pdfwrite prints "Processing pages 1 through N." then "Page k" per page.
  const range = /^Processing pages (\d+) through (\d+)/.exec(line);
  if (range) {
    pagesTotal = Number(range[2]) - Number(range[1]) + 1;
    post({ type: 'progress', phase: 'pages', done: 0, total: pagesTotal });
    return;
  }
  const page = /^Page (\d+)$/.exec(line);
  if (page) post({ type: 'progress', phase: 'pages', done: Number(page[1]), total: pagesTotal });
}
let pagesTotal = 0;

function post(msg, transfer) {
  self.postMessage({ ...msg, id: currentId }, transfer || []);
}

function loadGs() {
  if (!gsPromise) {
    gsPromise = (async () => {
      post({ type: 'status', text: 'Downloading Ghostscript (~15 MB, first time only)…' });
      const [{ default: createModule }, wasmBinary] = await Promise.all([
        import('@okathira/ghostpdl-wasm'),
        fetchWithProgress(wasmUrl, (done, total) =>
          post({ type: 'progress', phase: 'download', done, total })
        ),
      ]);
      post({ type: 'status', text: 'Starting Ghostscript…' });
      return createModule({
        wasmBinary,
        print: onGsLine,
        printErr: onGsLine,
      });
    })();
    gsPromise.catch(() => (gsPromise = null)); // allow a retry after a failed download
  }
  return gsPromise;
}

async function trace(bytes) {
  const gs = await loadGs();
  log = [];
  pagesTotal = 0;
  const IN = '/in.pdf';
  const OUT = '/out.pdf';
  for (const f of [IN, OUT]) {
    try { gs.FS.unlink(f); } catch { /* not there */ }
  }
  gs.FS.writeFile(IN, new Uint8Array(bytes));

  post({ type: 'status', text: 'Converting text to outlines…' });
  // Equivalent of: gs -o out.pdf -sDEVICE=pdfwrite -dNoOutputFonts in.pdf
  let rc;
  try {
    rc = gs.callMain([
      '-dSAFER',
      '-dBATCH',
      '-dNOPAUSE',
      '-sDEVICE=pdfwrite',
      '-dNoOutputFonts',
      `-sOutputFile=${OUT}`,
      IN,
    ]);
  } catch (e) {
    gsPromise = null; // the instance may be in a bad state; start fresh next time
    throw new Error(`Ghostscript crashed: ${e?.message || e}`);
  } finally {
    try { gs.FS.unlink(IN); } catch { /* ignore */ }
  }

  let out = null;
  try { out = gs.FS.readFile(OUT); gs.FS.unlink(OUT); } catch { /* no output */ }
  if (rc !== 0 || !out || out.length === 0) {
    const tail = log.filter((l) => /error|warning|password|unable|cannot/i.test(l)).slice(-5).join('\n');
    throw new Error(`Ghostscript failed (code ${rc}).${tail ? '\n' + tail : ''}`);
  }
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

self.onmessage = async ({ data }) => {
  if (data?.type !== 'trace') return;
  currentId = data.id;
  try {
    const result = await trace(data.bytes);
    post({ type: 'done', bytes: result }, [result]);
  } catch (e) {
    post({ type: 'error', message: e?.message || String(e) });
  }
};
