
# PDFSpliter – AI Coding Agent Guide

## Project Overview
PDFSpliter is a modular PDF processing suite targeting Android WebView and browser, with strict per-tool isolation. Each tool (Dividir, UnirPDF, DividirApenas, PDFtoJPG, JPGtoPDF, PDFtoArcgis) is self-contained in its own folder. The app is Portuguese-first, supports i18n, and integrates with an Android bridge for device features.

## Architecture & Patterns
- **Strict module-per-tool**: Each tool (e.g., Dividir, UnirPDF) has its own `index.html`, `script.js`, `style.css`, and Google verification file. No code is shared between tools; utility functions are duplicated by design.
- **Additive-only changes**: Never refactor or remove working logic. Add new strategies as fallbacks (see `parseVertices()` in PDFtoArcgis/script.js for example).
- **Android-first integration**: Always check for `window.Android` before using browser fallbacks for OCR, downloads, and translations.
- **Intentional code duplication**: Functions like `openNav`, `loadScript`, and `displayLogMessage` are copied per tool. Do not centralize utilities.

## Key Data Flows
- **PDF.js + PDFLib**: Use PDF.js for reading, PDFLib for writing. Example ([Dividir/script.js](Dividir/script.js)):
  ```js
  const pdfJsDoc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pdfLibDoc = await PDFLib.PDFDocument.load(buffer);
  ```
- **Encrypted PDFs**: Always load with `{ ignoreEncryption: true }` ([UnirPDF/script.js](UnirPDF/script.js)).
- **Name extraction**: Use `extractNameInfo()` ([Dividir/script.js](Dividir/script.js)) for Brazilian tax docs, with Android OCR fallback.
- **PDFtoArcgis**: Use multi-strategy coordinate extraction (`parseVertices()`, `detectDocIdFromPageText()` in [PDFtoArcgis/script.js](PDFtoArcgis/script.js)).
- **i18n**: Use `data-i18n` attributes in HTML and call `updateUI(translations)` to update UI text.

## Developer Workflows
- **Adding a tool**: Duplicate an existing tool folder, update HTML, add to sidenav in all HTMLs, copy utility functions, implement logic in `script.js`, and duplicate `style.css`.
- **Testing**: Open HTML files directly in the browser (CDN scripts are used). Android-specific code degrades gracefully if `window.Android` is missing.
- **User feedback**: Use `displayLogMessage()` for progress and errors. Prefix logs with `[LogUI]`, `[JS]`, `[PDFtoArcgis]` as appropriate.

## Project Conventions
- **Naming**: Use `nomeIdentificado` for extracted names, "Outros_Documentos" for unknowns, and strip formatting from document IDs.
- **Error handling**: Use try-catch per page; fallback to OCR if text extraction fails; always display user messages.
- **No shared libraries**: All dependencies are loaded via CDN in each tool's HTML.
- **Additive code only**: Never break or refactor working logic—add new code as fallback.

## Integration Points
- **Android bridge**: Use `window.Android.performOCR`, `window.Android.downloadPdf`, `window.Android.getTranslations`, `window.Android.exitApp`.
- **Browser fallback**: Use browser APIs if `window.Android` is not present.
- **External libraries**: PDF.js, PDFLib, jsPDF, Tesseract.js (see each tool's `script.js` for usage).

## Key Files/Examples
- [Dividir/script.js](Dividir/script.js): Name extraction, PDF.js + PDFLib usage
- [UnirPDF/script.js](UnirPDF/script.js): Encrypted PDF merge
- [PDFtoArcgis/script.js](PDFtoArcgis/script.js): Multi-strategy coordinate extraction, document ID detection
- [index.html](index.html): i18n markup, sidenav pattern

---
**If unclear, review the above files for concrete examples. When adding features, always preserve existing logic and add new strategies as fallbacks.**
