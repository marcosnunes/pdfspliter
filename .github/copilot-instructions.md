

# PDFSpliter – AI Coding Agent Guide

## Project Overview
PDFSpliter is a modular suite for advanced PDF processing, focused on Brazilian fiscal documents, with Android-first integration and full i18n (Portuguese primary). Each tool is fully isolated in its own directory—no shared code, no central utilities. All processing is 100% local (no server upload).

## Architecture & Patterns
- **Strict per-tool isolation**: Each tool (Dividir, UnirPDF, etc.) has its own `index.html`, `script.js`, `style.css`, and Google verification file. Utility functions are intentionally duplicated per tool—never centralize utilities.
- **Additive-only changes**: Never refactor or remove working logic. Always add new strategies as fallbacks (see `parseVertices()` in PDFtoArcgis/script.js).
- **Android-first**: Always check for `window.Android` before using browser fallbacks for OCR, downloads, and translations.
- **i18n**: Use `data-i18n` in HTML and call `updateUI(translations)` to update UI text. Translations are loaded via `window.Android.getTranslations(lang)` or web fallback.
- **User feedback**: Use `displayLogMessage()` for logs and progress, prefixing with `[LogUI]`, `[JS]`, `[PDFtoArcgis]`.

## Key Data Flows & Examples
- **PDF.js + PDFLib**: Use PDF.js for reading, PDFLib for writing. Example ([Dividir/script.js](Dividir/script.js)):
  ```js
  const pdfJsDoc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pdfLibDoc = await PDFLib.PDFDocument.load(buffer);
  ```
- **Encrypted PDFs**: Always load with `{ ignoreEncryption: true }` ([UnirPDF/script.js](UnirPDF/script.js)).
- **Name extraction**: Use `extractNameInfo()` ([Dividir/script.js](Dividir/script.js)) for Brazilian tax docs, with Android OCR fallback.
- **PDFtoArcgis**: Use multi-strategy coordinate extraction (`parseVertices()`, `detectDocIdFromPageText()` in [PDFtoArcgis/script.js](PDFtoArcgis/script.js)).
- **Exported files**: Each tool outputs files with timestamped names, e.g. `grupos_[timestamp].zip`, `coordenadas_[timestamp].csv`.

## Developer Workflows
- **Adding a tool**: Duplicate an existing tool folder, update HTML, add to sidenav in all HTMLs, copy utility functions, implement logic in `script.js`, and duplicate `style.css`.
- **Testing**: Open any tool's `index.html` directly in the browser (no build or server needed). Android-specific code degrades gracefully if `window.Android` is missing.
- **Debugging**: Use browser console (F12) for troubleshooting extraction/processing issues.

## Project Conventions
- **Naming**: Use `nomeIdentificado` for extracted names, `Outros_Documentos` for unknowns, and strip formatting from document IDs.
- **Error handling**: Use try-catch per page; fallback to OCR if text extraction fails; always display user messages.
- **No shared libraries**: All dependencies are loaded via CDN in each tool's HTML.
- **Additive code only**: Never break or refactor working logic—add new code as fallback.

## Integration Points
- **Android bridge**: Use `window.Android.performOCR`, `window.Android.downloadPdf`, `window.Android.getTranslations`, `window.Android.exitApp`.
- **Browser fallback**: Use browser APIs if `window.Android` is not present.
- **External libraries**: PDF.js, PDFLib, jsPDF, Tesseract.js (see each tool's `script.js`).


## PDFtoArcgis: Strategies & Validation
- Extração de vértices feita exclusivamente por IA local (WebLLM rodando no navegador via CDN). Não há fallback OCR/Tesseract/Android.
- CRS detection, topological validation, memorial comparison e outputs permanecem, mas toda dedução de vértices depende da IA local.

## Troubleshooting & Tips
- **PDF not supported**: Validate in another reader or re-export.
- **Text not extracted**: For scanned PDFs, Dividir uses Android OCR. PDFtoArcgis não faz mais OCR: se não houver texto extraível, a IA local tentará deduzir apenas do texto disponível.
- **Coordinates not found**: Unknown format/poor OCR—check browser console for debug info.
- **Download fails**: Try smaller files or a modern browser.

## Key Files/Examples
- [Dividir/script.js](Dividir/script.js): Name extraction, PDF.js + PDFLib usage
- [UnirPDF/script.js](UnirPDF/script.js): Encrypted PDF merge
- [PDFtoArcgis/script.js](PDFtoArcgis/script.js): Multi-strategy coordinate extraction, document ID detection
- [index.html](index.html): i18n markup, sidenav pattern

---
**If unclear, review the above files for concrete examples. When adding features, always preserve existing logic and add new strategies as fallbacks.**
---
**If unclear, review the above files for concrete examples. When adding features, always preserve existing logic and add new strategies as fallbacks.**
