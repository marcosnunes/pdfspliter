# PDFSpliter – AI Coding Agent Guide

## Project Overview
PDFSpliter is a modular suite for advanced PDF processing, focused on Brazilian fiscal documents, with Android-first integration and full i18n (Portuguese primary). Each tool is fully isolated—no shared utilities, no central libraries. All processing is 100% local (no server upload). Tools run directly in the browser from `index.html`, no build required.

## Core Architecture
- **Strict per-tool isolation**: Each tool (Dividir, UnirPDF, PDFtoArcgis, etc.) has its own `index.html`, `script.js`, `style.css`, and Google verification file. Utility functions are intentionally duplicated per tool—never centralize.
- **Sidenav navigation**: All tools link via `/ToolName/index.html` in the sidenav (present in every tool). Update all sidenavs when adding a new tool.
- **Android-first with graceful fallback**: Always check `window.Android` before calling native methods. Code degrades to browser APIs if bridge is absent.
- **i18n via data-i18n**: Use `data-i18n="key"` in HTML; translations loaded via `window.Android.getTranslations(lang)` or web fallback; call `updateUI(translations)` to refresh UI.

## Critical Data Flows
**PDF reading + manipulation:**
- Use **PDF.js** (`pdfjsLib.getDocument`) for reading/extraction
- Use **PDFLib** for writing/modifying PDFs
- Always decrypt with `{ ignoreEncryption: true }` (example: [UnirPDF/script.js](UnirPDF/script.js#L50))

**Name extraction from tax docs:**
- `extractNameInfo(textToSearch, pageNumber)` ([Dividir/script.js](Dividir/script.js#L110)) matches patterns: "Nome da Fonte Pagadora", "Razão Social", "Beneficiário", etc.
- Falls back to Android OCR via `performAndroidOCR(base64Image)` if text extraction fails
- Groups documents by extracted name; unknowns go to `Outros_Documentos`

**Coordinate extraction (PDFtoArcgis only):**
- **No OCR fallback** — entirely local AI via `/api/llama-3.1-8b-instant` endpoint (Vercel serverless calling Groq API with llama-3.1-8b-instant model)
- Uses `splitTextForAI(text, maxChars=6000)` to chunk large documents
- `mergeVerticesFromChunks()` combines results from parallel chunks with deduplication
- Validates: polygon closure, no self-intersection, CCW orientation, area via Shoelace formula
- CRS auto-detection (UTM zone, datum); comparison with memorial (azimuth/distance)

**Exports:**
- Timestamped zip/csv names: `grupos_YYYYMMDD_HHMMSS.zip`, `coordenadas_[timestamp].csv`
- Use `nativeDownload(fileName, blob)` to send to Android or browser download

## User Feedback Pattern
```javascript
displayLogMessage("[LogUI] Processing page 1/10");  // Updates DOM + console
displayLogMessage("[JS] Text extraction failed, trying OCR...");
displayLogMessage("[PDFtoArcgis] Validating vertices...");
```

## Adding a New Tool
1. Copy an existing tool folder (e.g., `Dividir/`) to `NewTool/`
2. Update `NewTool/index.html`: change title, form IDs, script logic
3. Add link in all sidenavs: `<a href="/NewTool/index.html">New Tool</a>`
4. Copy utility functions from similar tool (e.g., `performAndroidOCR`, `nativeDownload`)
5. Implement core logic in `NewTool/script.js`; follow error handling pattern: try-catch per page, always call `displayLogMessage()`

## Key Anti-Patterns
- **❌ Centralize utilities** → leads to breakage, violates isolation philosophy
- **❌ Refactor working code** → use additive fallbacks instead (see `parseVertices()`)
- **❌ Upload to server** → all processing is local, no cloud calls except coordinated LLM calls
- **❌ Skip `window.Android` check** → code fails on web, works on Android by accident
- **❌ Hardcode strings** → use `data-i18n`

## File Reference Map
| Tool | Key Pattern | File |
|------|-------------|------|
| **Dividir** | Name extraction + grouping | [script.js](Dividir/script.js#L110) |
| **UnirPDF** | Encrypted PDF merge | [script.js](UnirPDF/script.js#L50) |
| **PDFtoArcgis** | LLM-based coordinate extraction | [script.js](PDFtoArcgis/script.js#L1) |
| **Global** | Navigation, i18n, PWA | [script.js](script.js#L1), [index.html](index.html) |

## PWA & Installation
- Service Worker registered in `script.js`; caches tool files for offline use
- Install button logic in each tool; hides if already installed via `isAppInstalled()`
- `manifest.json` defines app metadata; works on Android, iOS, desktop

## Testing & Debugging
- **No server/build needed**: Open `file:///path/to/index.html` in browser or Android WebView
- **Console logs**: Use F12; prefix messages with `[LogUI]`, `[JS]`, `[PDFtoArcgis]` for filtering
- **Android bridge absent**: Fallback code executes silently; check console for missing `window.Android`
- **LLM failures**: Check `/api/llama-3.1-8b-instant.js`; retries with exponential backoff on 429 errors
