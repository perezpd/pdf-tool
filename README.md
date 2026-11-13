# pdf-tool

Produces a **traced PDF** (*PDF trazado*): every glyph becomes a vector outline. The pages look
the same and stay sharp at any zoom, but the text can't be selected, copied or searched.

It runs entirely in the browser. Ghostscript is compiled to WebAssembly
([`@okathira/ghostpdl-wasm`](https://github.com/okathira/ghostpdl-wasm), Ghostscript 10.06.0)
and runs in a Web Worker. The PDF never leaves the user's machine. There is no backend.

What runs is the equivalent of:

```sh
gs -o out.pdf -sDEVICE=pdfwrite -dNoOutputFonts in.pdf
```

The site is a static Vite build hosted on GitHub Pages at `https://<user>.github.io/pdf-tool/`.

## How it works

- `index.html` and `src/main.js`: file picker and drop zone, progress bar, download as
  `<original-name>-traced.pdf`.
- `src/gs.worker.js`: the worker is created only when the first file is picked. It then
  downloads the ~15 MB wasm (~11 MB gzipped) with byte progress. The file name is
  content-hashed, so the browser cache serves it on later visits. A single Ghostscript
  instance is reused for every later file.
- Progress per page comes from Ghostscript's own `Page N` output.
- No `SharedArrayBuffer` or special headers are needed, so plain GitHub Pages works.

## Local development

Needs Node 18 or later (CI uses Node 22).

```sh
npm install
npm run dev        # http://localhost:5813/pdf-tool/
npm run build      # outputs to dist/
npm run preview    # serves dist/ at http://localhost:4173/pdf-tool/
```

## Publish on GitHub Pages (one-time setup)

The repo **must be named `pdf-tool`**, because `vite.config.js` sets `base: '/pdf-tool/'`.
If you pick another name, change `base` to match, or the assets will 404.

1. **Create the repo.** On GitHub, go to **New repository**:
   - Name: `pdf-tool`
   - Visibility: **Public** (required for Pages on a free account, and it covers the AGPL
     source requirement; see the License section)
   - Do **not** add a README, .gitignore or license (this folder already has them)
2. **Turn on Pages from Actions.** In the new repo, go to **Settings → Pages → Build and
   deployment → Source** and choose **GitHub Actions**.
3. **Push this folder** from `/home/diego/Projects/PERSONAL/pdf-tool`:

   ```sh
   git init -b main
   git add .
   git commit -m "pdf-tool: trace PDF text to outlines in the browser"
   git remote add origin git@github.com:<your-user>/pdf-tool.git   # or the https URL
   git push -u origin main
   ```

   Commit `package-lock.json` too, because the workflow runs `npm ci`.
4. **Watch the deploy** in the **Actions** tab ("Deploy to GitHub Pages"). When it is green,
   the site is live at `https://<your-user>.github.io/pdf-tool/`.

From then on, every push to `main` redeploys. You can also start a deploy by hand from the
Actions tab (`workflow_dispatch`).

## Checking a result

- Open the output and try to select text. Ctrl+F should find nothing.
- `pdftotext out.pdf -` should print nothing except form-feed characters.
- `pdffonts out.pdf` should list no fonts.

Test with real documents. **Type 3 fonts, form fields and annotations** may not survive
`-dNoOutputFonts` cleanly. The output is usually larger than the input.

## Limitations

This deters copying; it does not secure the text. Screenshots and OCR still recover it.
Search and screen-reader accessibility are lost by design. Password-protected PDFs fail
with a Ghostscript error.

## Possible future work: OCR (the reverse direction)

None of the published Ghostscript WASM builds include the Tesseract OCR devices
(`pdfocr8/24/32`). Making scanned pages selectable again would need either a self-compiled
Ghostscript with Tesseract, or a separate path such as tesseract.js plus an invisible text
layer added with pdf-lib.

## License

AGPL-3.0-or-later (see `LICENSE`), because the bundled Ghostscript is AGPL. Serving it
publicly means the source must be available. The public repo and the "Source code" link in
the page footer cover that. **Check with whoever handles licensing before making the repo
private or putting this into a commercial product.**
