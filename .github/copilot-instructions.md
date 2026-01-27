
# PDFSpliter – AI Coding Agent Guide

## Project Overview
PDFSpliter is a multi-tool PDF processing suite (Android WebView + browser) with strict module isolation. Each tool (Dividir, UnirPDF, DividirApenas, PDFtoJPG, JPGtoPDF, PDFtoArcgis) lives in its own folder with **no shared code**. The app is Portuguese-first, with i18n and Android bridge integration.

## Architecture & Patterns
- **Module-per-tool**: Each tool has its own `index.html`, `script.js`, `style.css`, and Google verification file. No cross-module imports.
- **Code duplication is intentional**: Utility functions (e.g., `openNav`, `loadScript`, `displayLogMessage`) are copied per tool.
- **Additive-only changes**: Never replace or refactor existing logic—add new strategies as fallbacks (see `parseVertices()` in PDFtoArcgis/script.js).
- **Android-first**: Always check for `window.Android` before browser fallback for OCR, downloads, and translations.

## Key Data Flows
- **PDF.js + PDFLib**: Use PDF.js for reading, PDFLib for writing. Example in Dividir/script.js:
  ```js
  const pdfJsDoc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pdfLibDoc = await PDFLib.PDFDocument.load(buffer);
  ```
- **Encrypted PDFs**: Always load with `{ ignoreEncryption: true }` (see UnirPDF/script.js).
- **Name extraction**: `extractNameInfo()` in Dividir/script.js uses regexes for Brazilian tax docs, with Android OCR fallback.
- **PDFtoArcgis**: Multi-strategy coordinate extraction (see PDFtoArcgis/script.js, `parseVertices()` and `detectDocIdFromPageText()`).
- **i18n**: Use `data-i18n` attributes and `updateUI(translations)`.

## Developer Workflows
- **Add a tool**: Copy a tool folder, update HTML, add to sidenav in all HTMLs, duplicate utility functions, implement logic in script.js, duplicate style.css.
- **Testing**: Open HTML in browser (CDN scripts). Android code degrades gracefully if `window.Android` is missing.
- **Progress/UI**: Use `displayLogMessage()` for user feedback. Use `[LogUI]`, `[JS]`, `[PDFtoArcgis]` in logs.

## Project Conventions
- **Naming**: Use `nomeIdentificado` for extracted names, "Outros_Documentos" for unknowns, strip formatting from document IDs.
- **Error handling**: Try-catch per page; fallback to OCR if text extraction fails; always show user messages.
- **No shared libraries**: All dependencies loaded via CDN in each tool.
- **Additive code only**: Never break or refactor working logic—add new code as fallback.

## Integration Points
- **Android bridge**: `window.Android.performOCR`, `window.Android.downloadPdf`, `window.Android.getTranslations`, `window.Android.exitApp`.
- **Browser fallback**: Use browser APIs if Android bridge is missing.
- **External libraries**: PDF.js, PDFLib, jsPDF, Tesseract.js (see each tool's script.js for usage).

## Key Files/Examples
- [Dividir/script.js](Dividir/script.js): Name extraction, PDF.js + PDFLib pattern
- [UnirPDF/script.js](UnirPDF/script.js): Encrypted PDF merge
- [PDFtoArcgis/script.js](PDFtoArcgis/script.js): Multi-strategy coordinate extraction, document ID detection
- [index.html](index.html): i18n markup, sidenav pattern

---
**If unclear, review the above files for concrete examples. When adding features, always preserve existing logic and add new strategies as fallbacks.**
