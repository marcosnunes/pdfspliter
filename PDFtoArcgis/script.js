if (typeof displayLogMessage !== 'function' && window.displayLogMessage) {
  var displayLogMessage = window.displayLogMessage;
}

function getPdfToArcgisConfig() {
  const cfg = window.PDFTOARCGIS_CONFIG;
  return (cfg && typeof cfg === 'object') ? cfg : {};
}

function isLocalPdfToArcgisHost() {
  const host = String(window.location.hostname || '').trim().toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function buildWorkspaceAiExtractorCandidates() {
  const cfg = getPdfToArcgisConfig();
  const configured = String(cfg.workspaceAiExtractorUrl || '').trim() || '/api/pdf-to-geojson';
  const candidates = [configured];

  if (isLocalPdfToArcgisHost() && /^\/api\//.test(configured)) {
    const devOrigin = String(cfg.devApiOrigin || '').trim().replace(/\/$/, '');
    if (devOrigin) candidates.push(`${devOrigin}${configured}`);
  }

  return [...new Set(candidates.filter(Boolean))];
}

function getWorkspaceAiExtractorUrl() {
  return buildWorkspaceAiExtractorCandidates()[0] || '/api/pdf-to-geojson';
}

function getSelectedProcessingMode() {
  return 'complete';
}

async function askLocalAssistivePdfTask(task, ocrText = '', context = {}) {
  const rawText = String(context?.rawText || ocrText || '');
  const body = {
    features: [],
    text: String(ocrText || ''),
    rawText,
    config: { task },
    context: {
      task,
      stage: 'pdf-to-arcgis',
      source: 'pdf-to-arcgis-roi-ocr-or-coordinates',
      ...context
    }
  };

  try {
    const response = await fetch('/api/desktop/assist-inference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    if (!payload?.ok) return null;
    return payload;
  } catch {
    return null;
  }
}

const PROGRESS_HINT_MESSAGES = [
  'Isso pode levar alguns instantes.',
  'Você pode aguardar nesta tela enquanto organizamos o resultado.',
  'Estamos conferindo o documento com calma para evitar retrabalho.',
  'Assim que terminar, a tabela e os downloads serão liberados.'
];

let progressHintTimer = null;
let progressHintIndex = 0;

function stopProgressHintRotation() {
  if (progressHintTimer) {
    clearInterval(progressHintTimer);
    progressHintTimer = null;
  }
}

function startProgressHintRotation() {
  const progressHint = document.getElementById('progressHint');
  if (!progressHint) return;

  stopProgressHintRotation();
  progressHintIndex = 0;
  progressHint.textContent = PROGRESS_HINT_MESSAGES[progressHintIndex];

  progressHintTimer = setInterval(() => {
    progressHintIndex = (progressHintIndex + 1) % PROGRESS_HINT_MESSAGES.length;
    progressHint.textContent = PROGRESS_HINT_MESSAGES[progressHintIndex];
  }, 3200);
}

function setProgressExperience(labelText, progressValue = null) {
  if (progressContainer) progressContainer.style.display = 'block';
  if (labelText) {
    const progressLabel = document.getElementById('progressLabel');
    if (progressLabel) progressLabel.innerText = labelText;
  }
  if (Number.isFinite(progressValue) && progressBar) {
    progressBar.value = progressValue;
  }
}

function buildOcrPlan(totalPagesHint, processingMode = 'complete') {
  const total = Math.max(1, Number.isFinite(Number(totalPagesHint)) ? Number(totalPagesHint) : 1);
  const mode = String(processingMode || 'complete').toLowerCase();

  if (mode === 'complete') {
    return {
      // Em modo completo, prioriza cobertura total de páginas para evitar perda
      // de coordenadas em documentos longos com tabelas distribuídas.
      pass1: { maxPages: total, scale: 2.4, enableDeskew: true, fullScan: true, maxTotalMs: 240000, forceAllPages: true },
      pass2: { maxPages: total, scale: 2.9, enableDeskew: true, fullScan: true, maxTotalMs: 150000, forceAllPages: true },
      runPass2When: (confidence) => {
        const utm = confidence?.utmPairs || 0;
        const latlon = confidence?.latLonPairs || 0;
        const signal = confidence?.signal || 0;
        // Só faz segundo passe completo se ainda estiver sem sinal coordenável.
        return utm < 1 && latlon < 1 && signal < 4;
      }
    };
  }

  const pass1Pages = total <= 6 ? total : Math.min(total, 6);
  const pass2Pages = total <= 12 ? total : 12;

  return {
    // Prioriza um único passe eficiente: amostragem inteligente e tempo limite menor.
    // O passe 2 só entra quando houver indício real de ganho.
    pass1: { maxPages: pass1Pages, scale: 2.4, enableDeskew: true, fullScan: false, maxTotalMs: 90000 },
    pass2: { maxPages: pass2Pages, scale: 2.9, enableDeskew: true, fullScan: true, maxTotalMs: 60000 },
    // pass2DurationMs: tempo em ms do pass1 para avaliar custo × benefício
    runPass2When: (confidence, pass1DurationMs = 0) => {
      const utm = confidence?.utmPairs || 0;
      const latlon = confidence?.latLonPairs || 0;
      const signal = confidence?.signal || 0;
      const chars = confidence?.chars || 0;
      // Já encontrou pares/sinal suficientes → segunda passagem desnecessária.
      if (utm >= 2 || latlon >= 2 || signal >= 10) return false;

      // Pass1 custoso: evita duplicar OCR quando o ganho esperado é baixo.
      if (pass1DurationMs > 45000 && signal < 6) return false;

      // Muito texto administrativo e pouco sinal coordenável: pass2 tende a repetir ruído.
      if (chars > 4500 && signal < 4 && utm === 0 && latlon === 0) return false;

      // Texto muito curto pode indicar OCR fraco na primeira amostragem.
      if (chars < 320) return true;

      // Só roda pass2 quando houver algum indício de coordenada para refinar.
      return signal >= 2 || utm >= 1 || latlon >= 1;
    }
  };
}

function normalizeUiErrorMessage(errorText) {
  const raw = String(errorText || '').trim();
  if (!raw) return 'Falha não especificada.';
  return raw
    .replace(/^Serviço de extração online indisponível:\s*/i, '')
    .replace(/^Error:\s*/i, '');
}

function buildUserFacingDiagMessage(stage, details = {}) {
  switch (stage) {
    case 'start':
      return 'Arquivo recebido. Preparando o documento...';
    case 'pdf-loaded':
      return 'Documento carregado. Organizando as páginas...';
    case 'local-text-extracted':
      return 'Leitura inicial concluída.';
    case 'ocr-decision':
      return 'Continuando a análise do documento...';
    case 'ocr-pass-1':
      return 'Análise em andamento...';
    case 'ocr-pass-2':
      return 'Refinando o resultado...';
    case 'ocr-pass-3':
      return 'Refinando o resultado...';
    case 'api-attempt-1':
      return 'Montando o resultado...';
    case 'api-attempt-1-failed':
      return 'Fazendo um ajuste automático...';
    case 'api-attempt-2':
      return 'Fazendo uma nova tentativa automática...';
    case 'api-attempt-2-failed':
      return 'Tentando concluir com os melhores dados disponíveis...';
    case 'local-fallback-success':
      return 'Aplicando um ajuste final...';
    case 'local-fallback-success-after-retry':
      return 'Aplicando um ajuste final...';
    case 'final-success':
      return 'Processamento concluído.';
    case 'final-error':
      return `Não foi possível concluir o processamento: ${normalizeUiErrorMessage(details?.error)}`;
    default:
      return null;
  }
}

function isPdfDiagVerboseEnabled() {
  try {
    if (window.__PDFTOARCGIS_DEBUG === true) return true;
    return String(localStorage.getItem('pdfToArcgis.debug') || '') === '1';
  } catch {
    return false;
  }
}

function createPdfDiagRunId() {
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 7);
  return `run-${stamp}-${random}`;
}

function beginPdfDiagRun(fileName = '') {
  const runId = createPdfDiagRunId();
  window.__PDFTOARCGIS_LAST_RUN__ = {
    runId,
    fileName: String(fileName || ''),
    startedAt: new Date().toISOString(),
    events: []
  };
  return runId;
}

function appendPdfDiagEvent(payload) {
  const run = window.__PDFTOARCGIS_LAST_RUN__;
  if (!run || !Array.isArray(run.events)) return;
  run.events.push(payload);
  if (run.events.length > 400) {
    run.events.splice(0, run.events.length - 400);
  }
}

function finalizePdfDiagRun(status, extra = {}) {
  const run = window.__PDFTOARCGIS_LAST_RUN__;
  if (!run) return;
  run.finishedAt = new Date().toISOString();
  run.status = String(status || 'unknown');
  run.summary = {
    totalEvents: Array.isArray(run.events) ? run.events.length : 0,
    ...extra
  };

  console.info('[PDFtoArcgis][RunSummary]', {
    runId: run.runId,
    fileName: run.fileName,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    ...run.summary
  });
}

function logPdfDiag(stage, details = {}) {
  const currentRunId = window.__PDFTOARCGIS_LAST_RUN__?.runId || null;
  const eventSeq = Array.isArray(window.__PDFTOARCGIS_LAST_RUN__?.events)
    ? window.__PDFTOARCGIS_LAST_RUN__.events.length + 1
    : 1;
  const payload = {
    stage,
    ts: new Date().toISOString(),
    runId: currentRunId,
    seq: eventSeq,
    ...details
  };
  appendPdfDiagEvent(payload);
  console.log('[PDFtoArcgis][Diag]', payload);

  if (isPdfDiagVerboseEnabled()) {
    const text = details?.msg ? ` | ${details.msg}` : '';
    console.debug(`[PDFtoArcgis][Trace]#${payload.seq} ${stage}${text}`);
  }

  if (typeof displayLogMessage === 'function') {
    const userMsg = buildUserFacingDiagMessage(stage, details);
    if (userMsg) {
      displayLogMessage(`[PDFtoArcgis] ${userMsg}`);
    }
  }
}

function fingerprintText(text = '') {
  const src = String(text || '');
  let hash = 2166136261;
  for (let i = 0; i < src.length; i += 1) {
    hash ^= src.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function isFullTextDumpEnabled() {
  try {
    if (window.__PDFTOARCGIS_DEBUG_FULL_TEXT__ === true) return true;
    return String(localStorage.getItem('pdfToArcgis.debugFullText') || '') === '1';
  } catch {
    return false;
  }
}

function captureExtractedTextSnapshot(kind, text, meta = {}) {
  const payload = {
    kind,
    ts: new Date().toISOString(),
    chars: String(text || '').length,
    fingerprint: fingerprintText(text),
    ...meta,
    text: String(text || '')
  };

  if (!window.__PDFTOARCGIS_TEXT_CAPTURE__) {
    window.__PDFTOARCGIS_TEXT_CAPTURE__ = {};
  }
  window.__PDFTOARCGIS_TEXT_CAPTURE__[kind] = payload;

  if (isFullTextDumpEnabled()) {
    console.groupCollapsed(`[PDFtoArcgis][TextDump] ${kind} | chars=${payload.chars} | fp=${payload.fingerprint}`);
    console.log(payload);
    console.log(payload.text);
    console.groupEnd();
  }

  return payload;
}

function estimateExtractedVerticesFromApiResult(apiResult) {
  const ring = apiResult?.geojson?.features?.[0]?.geometry?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 1) return 0;

  const first = ring[0];
  const last = ring[ring.length - 1];
  const isClosed = Array.isArray(first)
    && Array.isArray(last)
    && first.length >= 2
    && last.length >= 2
    && first[0] === last[0]
    && first[1] === last[1];

  return Math.max(0, isClosed ? ring.length - 1 : ring.length);
}

function summarizeVerticesForDiag(vertices = []) {
  const list = Array.isArray(vertices) ? vertices : [];
  if (list.length === 0) {
    return {
      count: 0,
      bbox: null,
      span: null,
      sampleStart: [],
      sampleEnd: [],
      plausibleUtmScale: false
    };
  }

  const eastVals = list.map((v) => Number(v?.east)).filter(Number.isFinite);
  const northVals = list.map((v) => Number(v?.north)).filter(Number.isFinite);

  const minEast = Math.min(...eastVals);
  const maxEast = Math.max(...eastVals);
  const minNorth = Math.min(...northVals);
  const maxNorth = Math.max(...northVals);
  const spanEast = maxEast - minEast;
  const spanNorth = maxNorth - minNorth;
  const diag = Math.hypot(spanEast, spanNorth);

  return {
    count: list.length,
    bbox: {
      minEast: Number(minEast.toFixed(3)),
      maxEast: Number(maxEast.toFixed(3)),
      minNorth: Number(minNorth.toFixed(3)),
      maxNorth: Number(maxNorth.toFixed(3))
    },
    span: {
      east: Number(spanEast.toFixed(3)),
      north: Number(spanNorth.toFixed(3)),
      diagonal: Number(diag.toFixed(3))
    },
    sampleStart: list.slice(0, 5).map((v) => ({ id: v.id, east: v.east, north: v.north })),
    sampleEnd: list.slice(-5).map((v) => ({ id: v.id, east: v.east, north: v.north })),
    plausibleUtmScale: spanEast <= 250000 && spanNorth <= 250000 && diag <= 300000
  };
}

function summarizeDuplicateVertices(vertices = [], precision = 6) {
  const list = Array.isArray(vertices) ? vertices : [];
  const p = Number.isFinite(Number(precision)) ? Math.max(0, Math.floor(Number(precision))) : 6;
  const roundedMap = new Map();
  const exactMap = new Map();
  const duplicateSamples = [];
  let sequentialRepeats = 0;

  const keyFor = (east, north) => `${Number(east).toFixed(p)}|${Number(north).toFixed(p)}`;
  const keyExact = (east, north) => `${Number(east)}|${Number(north)}`;

  for (let i = 0; i < list.length; i++) {
    const v = list[i] || {};
    const east = Number(v.east);
    const north = Number(v.north);
    if (!Number.isFinite(east) || !Number.isFinite(north)) continue;

    const roundedKey = keyFor(east, north);
    const exactKey = keyExact(east, north);

    const roundedSeen = roundedMap.get(roundedKey) || 0;
    roundedMap.set(roundedKey, roundedSeen + 1);

    const exactSeen = exactMap.get(exactKey) || 0;
    exactMap.set(exactKey, exactSeen + 1);

    if (roundedSeen >= 1 && duplicateSamples.length < 8) {
      duplicateSamples.push({
        index: i,
        id: v.id || null,
        east,
        north,
        roundedKey,
        kind: 'rounded-duplicate'
      });
    }

    if (i > 0) {
      const prev = list[i - 1] || {};
      const sameAsPrevious = Number(prev.east) === east && Number(prev.north) === north;
      if (sameAsPrevious) sequentialRepeats += 1;
    }
  }

  const first = list[0] || {};
  const last = list[list.length - 1] || {};
  const hasClosedRingDuplicate = list.length > 1
    && Number.isFinite(Number(first.east))
    && Number.isFinite(Number(first.north))
    && Number(first.east) === Number(last.east)
    && Number(first.north) === Number(last.north);

  let repeatedRoundedVertices = 0;
  let repeatedExactVertices = 0;
  roundedMap.forEach((count) => {
    if (count > 1) repeatedRoundedVertices += (count - 1);
  });
  exactMap.forEach((count) => {
    if (count > 1) repeatedExactVertices += (count - 1);
  });

  return {
    total: list.length,
    uniqueRounded: roundedMap.size,
    uniqueExact: exactMap.size,
    repeatedRoundedVertices,
    repeatedExactVertices,
    sequentialRepeats,
    hasClosedRingDuplicate,
    precision: p,
    duplicateSamples
  };
}

const ENABLE_TOPOLOGY_VALIDATION = false;

function countCoordinateSignal(text) {
  const src = String(text || '');
  if (!src) return 0;
  let signal = 0;

  // Integers with 6+ consecutive digits in UTM range
  const nums = (src.match(/\d{6,}/g) || [])
    .map((n) => parseInt(n, 10))
    .filter((n) => Number.isFinite(n));
  for (const n of nums) {
    if ((n >= 100000 && n <= 900000) || (n >= 1000000 && n <= 10000000)) {
      signal += 1;
    }
  }

  // Portuguese-formatted large numbers: 7.330.325,634 or 518.485,001
  const ptNums = (src.match(/\d{1,3}(?:\.\d{3})+(?:,\d+)?/g) || []);
  for (const raw of ptNums) {
    const v = parseNumericForSignal(raw);
    if (!Number.isFinite(v)) continue;
    const abs = Math.abs(v);
    if ((abs >= 100000 && abs <= 900000) || (abs >= 1000000 && abs <= 10000000)) {
      signal += 1;
    }
  }

  // DMS coordinates: degree/minute/second patterns indicating geographic location
  const dmsMatches = src.match(/\d{1,3}[°º]\s*\d{1,2}['''′]\s*\d{1,2}[""″]?\s*[NSsOoEeLl]/g) || [];
  signal += dmsMatches.length > 0 ? Math.min(dmsMatches.length, 8) : 0;

  return signal;
}

function parseNumericForSignal(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  let normalized = value
    .trim()
    .replace(/[Oo]/g, '0')
    .replace(/[Il|]/g, '1')
    .replace(/[Ss]/g, '5')
    .replace(/[^\d,.-\s]/g, '')
    .replace(/\s+/g, '');
  if (!normalized) return null;

  const hasComma = normalized.includes(',');
  const hasDot = normalized.includes('.');
  if (hasComma && hasDot) {
    if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (hasComma) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if ((normalized.match(/\./g) || []).length > 1) {
    normalized = normalized.replace(/\./g, '');
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function countLikelyUtmPairs(text) {
  const src = String(text || '');
  if (!src) return 0;
  const tokens = src.match(/-?[\dOIlSB][\dOIlSB\s.,]{4,}/g) || [];
  const isEasting = (v) => v >= 100000 && v <= 900000;
  const isNorthing = (v) => v >= 1000000 && v <= 10000000;
  let pairs = 0;
  for (let i = 0; i + 1 < tokens.length; i++) {
    const a = Math.abs(parseNumericForSignal(tokens[i]) || NaN);
    const b = Math.abs(parseNumericForSignal(tokens[i + 1]) || NaN);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if ((isEasting(a) && isNorthing(b)) || (isNorthing(a) && isEasting(b))) {
      pairs += 1;
    }
  }
  return pairs;
}

function countLikelyLatLonPairs(text) {
  const src = String(text || '');
  if (!src) return 0;
  const pairRegex = /(-?\d{1,3}[.,]\d{4,})[^\d\n\r]{1,20}(-?\d{1,3}[.,]\d{4,})/g;
  let count = 0;
  let match;
  while ((match = pairRegex.exec(src)) !== null) {
    const a = parseNumericForSignal(match[1]);
    const b = parseNumericForSignal(match[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const ab = Math.abs(a);
    const bb = Math.abs(b);
    if ((ab <= 90 && bb <= 180) || (ab <= 180 && bb <= 90)) {
      count += 1;
    }
  }
  return count;
}

function buildTextCoordinateConfidence(text) {
  const src = String(text || '');
  const alphaChars = (src.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || []).length;
  const digitChars = (src.match(/\d/g) || []).length;
  const lineCount = src.split(/\r?\n/).filter(Boolean).length;
  return {
    chars: src.length,
    signal: countCoordinateSignal(src),
    utmPairs: countLikelyUtmPairs(src),
    latLonPairs: countLikelyLatLonPairs(src),
    alphaChars,
    digitChars,
    lineCount
  };
}

function scoreCoordinateText(text) {
  const c = buildTextCoordinateConfidence(text);
  const memorialCue = (String(text || '').match(/\b(azimute|rumo|dist[âa]ncia|confrontando|segue|do ponto|at[eé] o ponto|do v[eé]rtice|at[eé] o v[eé]rtice)\b/gi) || []).length;
  return (c.utmPairs * 9)
    + (c.latLonPairs * 7)
    + (c.signal * 2)
    + Math.min(4, Math.floor(c.chars / 3000))
    + Math.min(12, memorialCue * 2);
}

// Corrige ruídos comuns do OCR cartorial antes de enviar ao parser.
function normalizeOcrArtifacts(rawText) {
  let text = String(rawText || '');
  if (!text.trim()) return text;

  // 1. CASO MAIS IMPORTANTE (com "e")
  text = text.replace(/(\d{6,7}[.,]\d+)\s*e\s*(\d{6}[.,]\d+)/gi, (m, a, b) => {
    const na = parseNumericForSignal(a);
    const nb = parseNumericForSignal(b);

    // N primeiro, E depois
    if (na > 1000000 && nb < 1000000) {
      return `N=${a} E=${b}`;
    }

    // E primeiro, N depois
    if (nb > 1000000 && na < 1000000) {
      return `E=${a} N=${b}`;
    }

    return m;
  }
  );

  // 2. CASO COM "N .... e ..."
  text = text.replace(/N[=\s]*(\d{6,7}[.,]\d+)\s*e\s*(\d{6}[.,]\d+)/gi, 'N=$1 E=$2');

  // 3. NORMALIZAÇÃO CLÁSSICA
  text = text.replace(/N\s*(\d)/gi, 'N=$1');
  text = text.replace(/E\s*(\d)/gi, 'E=$1');

  // 4. limpeza OCR
  text = text.replace(/(\d+[.,]\d+)m\b/gi, '$1');
  text = text.replace(/(\d+[.,]\d+)\s*m\b/gi, '$1');
  text = text.replace(/(\d{6,})\s*m\b/gi, '$1');

  // IMPORTANTE: NÃO remover o "e" antes de tratar coordenadas
  // então esse replace vem DEPOIS
  text = text.replace(/(\d+[.,]\d+)\s*e\s*(\d+[.,]\d+)/gi, '$1 $2');

  text = text.replace(/([NE])\s*(\d{6,})/gi, '$1=$2');

  text = text.replace(/\bU\s*T\s*M\b/gi, 'UTM');
  text = text.replace(/\bS\s*I\s*R\s*G\s*A\s*S\b/gi, 'SIRGAS');

  text = text.replace(/(?<![A-Za-z])[ÉÊËÈéêëè]\s*=/g, 'E=');
  text = text.replace(/(?<![A-Za-z])[Ññ]\s*=/g, 'N=');

  text = text.replace(/\bE\s*[-–—:]\s*(?=[-+]?\d)/g, 'E=');
  text = text.replace(/\bN\s*[-–—:]\s*(?=[-+]?\d)/g, 'N=');

  text = text.replace(/\bE\s+=\s*/g, 'E=');
  text = text.replace(/\bN\s+=\s*/g, 'N=');

  text = text.replace(/\b([EN])=([-+]?\s*(?:\d\s*){2,}(?:[.,]\s*(?:\d\s*)+)*)/g, (_m, lbl, num) => `${lbl}=${num.replace(/\s+/g, '')}`);

  return text;
}

function forceParseLoosePairs(text) {
  const matches = text.match(/(\d{6,7}[.,]\d+)\s*e\s*(\d{6}[.,]\d+)/g) || [];

  return matches.map(m => {
    const res = m.match(/(\d{6,7}[.,]\d+).+?(\d{6}[.,]\d+)/);
    if (!res) return null;

    const n = parseNumericLoose(res[1]);
    const e = parseNumericLoose(res[2]);

    if (!Number.isFinite(n) || !Number.isFinite(e)) return null;

    return { north: n, east: e };
  }).filter(Boolean);
}

function shouldRunOcrEnhancement(text) {
  const confidence = buildTextCoordinateConfidence(text);
  if (!confidence.chars) return true;

  // Sem qualquer sinal de coordenada REAL, força OCR de reforço mesmo em PDF textual.
  // Nota: signal pode incluir números genéricos na faixa UTM; por isso checamos pares reais primeiro.
  const hasRealCoordinates = (confidence.utmPairs > 0) || (confidence.latLonPairs > 0);
  const hasStrongSignal = confidence.signal >= 3; // Múltiplos números de coordenadas, não genéricos
  if (!hasRealCoordinates && !hasStrongSignal) return true;

  // PDF nativo/textual: se já há volume de texto razoável, evita OCR para não introduzir ruído.
  const isLikelyDigitalTextPdf =
    confidence.chars >= 1000
    || (confidence.chars >= 450 && confidence.alphaChars >= 180 && confidence.lineCount >= 8);
  if (isLikelyDigitalTextPdf) return false;

  if (confidence.utmPairs >= 3 || confidence.latLonPairs >= 3) return false;
  return true;
}

function hasCoordinateCandidates(text, minPairs = 1) {
  const confidence = buildTextCoordinateConfidence(text);
  if (confidence.utmPairs >= minPairs) return true;
  if (confidence.latLonPairs >= minPairs) return true;
  return confidence.signal >= Math.max(2, minPairs * 2);
}

function hasUtmCandidates(text, minHits = 3) {
  return countCoordinateSignal(text) >= minHits;
}

function classifyCoordinatePrintPattern(rawText) {
  const text = normalizeOcrArtifacts(String(rawText || '')).toUpperCase();
  const confidence = buildTextCoordinateConfidence(text);

  if (!text.trim() || confidence.chars < 220) {
    return {
      id: 'scan-or-low-text',
      label: 'Imagem/baixo texto',
      confidence,
      signals: {
        utmPairs: confidence.utmPairs,
        latLonPairs: confidence.latLonPairs,
        azDistPairs: 0,
        tableCue: 0,
        memorialCue: 0
      }
    };
  }

  const tableCue = (text.match(/\b(V[ÉE]RTICE|VERTICE|PONTO|COORDENADA|NORTE|LESTE|ESTE|LONGITUDE|LATITUDE)\b/g) || []).length;
  const azDistPairs = (text.match(/\b(AZIMUTE|RUMO|DIST[ÂA]NCIA|DISTANCIA|DO PONTO|CONFRONTANDO|SEGUE)\b/g) || []).length;
  const memorialCue = (text.match(/\b(DO PONTO|CONFRONTANDO|SEGUE|ATE O PONTO|AT[EÉ] O PONTO|DA[IÍ])\b/g) || []).length;
  const hasLatLongWording = /\b(LAT\.?|LATITUDE|LON\.?|LONG\.?|LONGITUDE|GEOD[ÉE]SIC)/.test(text);
  const hasUtmWording = /\b(UTM|SIRGAS|MC-\d{1,2}|MERIDIANO CENTRAL|\bN\s*=\s*\d{5,}|\bE\s*=\s*\d{5,})/.test(text);

  if (confidence.latLonPairs >= 2 || (hasLatLongWording && azDistPairs >= 1)) {
    return {
      id: 'lat-long-table-or-list',
      label: 'Lat/Long em tabela/listagem',
      confidence,
      signals: {
        utmPairs: confidence.utmPairs,
        latLonPairs: confidence.latLonPairs,
        azDistPairs,
        tableCue,
        memorialCue
      }
    };
  }

  if (confidence.utmPairs >= 2 || (hasUtmWording && tableCue >= 2)) {
    return {
      id: 'utm-table-or-list',
      label: 'UTM em tabela/listagem',
      confidence,
      signals: {
        utmPairs: confidence.utmPairs,
        latLonPairs: confidence.latLonPairs,
        azDistPairs,
        tableCue,
        memorialCue
      }
    };
  }

  if (azDistPairs >= 2 || memorialCue >= 2) {
    return {
      id: 'memorial-azimuth-distance',
      label: 'Memorial por rumo/azimute + distância',
      confidence,
      signals: {
        utmPairs: confidence.utmPairs,
        latLonPairs: confidence.latLonPairs,
        azDistPairs,
        tableCue,
        memorialCue
      }
    };
  }

  return {
    id: 'vertex-text-without-clear-coords',
    label: 'Vértices sem coordenadas claras',
    confidence,
    signals: {
      utmPairs: confidence.utmPairs,
      latLonPairs: confidence.latLonPairs,
      azDistPairs,
      tableCue,
      memorialCue
    }
  };
}

/**
 * Retorna amostra diagnóstica do texto OCR com foco em linhas numéricas.
 * Usado para logar nos estágios de falha sem expor o texto completo.
 */
function sampleOcrForDiag(text, maxChars = 1200) {
  const src = String(text || '');
  const head = src.slice(0, 400);
  const lines = src.split(/\r?\n/);
  // Lines with at least one 4+ digit sequence (likely numeric data)
  const numericLines = lines
    .filter((l) => /\d{4,}/.test(l))
    .slice(0, 30)
    .join('\n')
    .slice(0, maxChars);
  return { head, numericLines, totalChars: src.length };
}

function buildBackendRetryTextCandidates(baseText) {
  const original = String(baseText || '').trim();
  if (!original) return [];

  const cleaned = buildCleanOcrStageText(original);
  const coordinateHintRegex = /(coordenad|utm|sirgas|norte|leste|latitude|longitude|vertice|v[\s\-_.]{0,2}\d{1,4}|m[\s\-_.]{0,2}\d{1,4}|pt[\s\-_.]{0,2}\d{1,4}|azimute|rumo|dist[âa]ncia|confront|segue|at[eé]\s+o\s+v[eé]rtice|do\s+v[eé]rtice|\d{4,})/i;
  const focused = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => coordinateHintRegex.test(line))
    .join('\n')
    .trim();

  const mergedFocused = focused ? mergeUniqueTextBlocks(focused, cleaned) : cleaned;
  const candidates = [original, cleaned, focused, mergedFocused]
    .map((text) => String(text || '').trim())
    .filter(Boolean);

  const unique = [];
  for (const candidate of candidates) {
    if (!unique.includes(candidate)) unique.push(candidate);
  }

  return unique;
}

async function callWorkspaceAiExtractor(fileName, totalPagesHint = 0, ocrText = '', retryCount = 0, patternHint = '', flowMode = 'auto', rawOcrText = '') {
  if (!getWorkspaceAiExtractorUrl()) {
    throw new Error('API desativada - usando fallback local');
  }

  // Fluxo principal e único no PDFtoArcGIS: a matrícula deve ser a fonte
  // canônica de contexto textual que alimenta o extrator de geometria.
  const inferenceRawText = String(rawOcrText || ocrText || '');
  const matSelectAssistive = await askLocalAssistivePdfTask('pdf-matricula-choice', inferenceRawText, {
    fileName,
    totalPagesHint: Number.isFinite(Number(totalPagesHint)) ? Number(totalPagesHint) : 0,
    flowMode: String(flowMode || 'auto'),
    rawText: inferenceRawText
  });
  const matChoiceCandidates = Array.isArray(matSelectAssistive?.candidates)
    ? matSelectAssistive.candidates
        .map((item) => String(item?.line || item || '').trim())
        .filter(Boolean)
    : [];

  const coordinateHints = [...new Set(matChoiceCandidates)].join('\n');

  const rawText = inferenceRawText.trim();

  const routes = buildWorkspaceAiExtractorCandidates();
  const cfg = getPdfToArcgisConfig();
  const maxRetries = Number.isFinite(Number(cfg.maxWorkspaceRetries))
    ? Math.max(0, Number(cfg.maxWorkspaceRetries))
    : 1;
  const processingMode = getSelectedProcessingMode();

  let lastError = null;

  for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
    const route = routes[routeIndex];
    try {
      const response = await fetch(route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName,
          totalPagesHint: Number.isFinite(Number(totalPagesHint)) ? Number(totalPagesHint) : 0,
          ocrText: rawText.slice(0, 120000),
          rawText: rawText.slice(0, 120000),
          coordinateHints: coordinateHints.slice(0, 12000),
          processingMode,
          patternHint: String(patternHint || ''),
          flowMode: String(flowMode || 'auto')
        })
      });

      const raw = await response.text().catch(() => '');
      let payload = {};
      if (raw) {
        try {
          payload = JSON.parse(raw);
        } catch {
          payload = { error: raw.slice(0, 600) };
        }
      }

      if (!response.ok) {
        if (response.status === 404 && routeIndex + 1 < routes.length) {
          continue;
        }

        const transient = new Set([429, 500, 503, 504]);
        if (transient.has(response.status) && retryCount < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 1200 * Math.pow(2, retryCount)));
          return callWorkspaceAiExtractor(fileName, totalPagesHint, ocrText, retryCount + 1, patternHint, flowMode, rawOcrText);
        }
      }

      if (!response.ok || !payload?.success) {
        const reason = payload?.error || `HTTP ${response.status}`;
        const handledError = new Error(`Serviço de extração online indisponível: ${reason}`);
        handledError.handledResponse = true;
        throw handledError;
      }

      return payload;
    } catch (error) {
      lastError = error;
      if (!error?.handledResponse && routeIndex + 1 < routes.length) {
        continue;
      }
    }
  }

  throw lastError || new Error('Serviço de extração online indisponível.');
}

function mergeUniqueTextBlocks(baseText, nextText) {
  if (!nextText) return baseText;

  if (nextText.length > baseText.length) {
    return nextText;
  }

  return baseText;
}

function isCoordinateRelevantLine(line) {
  const src = String(line || '').trim();
  if (!src) return false;
  if (/\d{4,}/.test(src)) return true;
  return /(coordenad|utm|sirgas|norte|leste|latitude|longitude|vertice|v\s*[-_.:]?\s*\d{1,4}|m\s*[-_.:]?\s*\d{1,4}|pt\s*[-_.:]?\s*\d{1,4}|azimute|rumo|dist[âa]ncia)/i.test(src);
}

function buildCleanOcrStageText(rawText = '') {
  const raw = String(rawText || '').replace(/\r/g, '\n');
  if (!raw.trim()) return '';

  const normalizedLines = raw
    .split('\n')
    .map((line) => normalizeOcrArtifacts(line).replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const freq = new Map();
  for (const line of normalizedLines) {
    freq.set(line, (freq.get(line) || 0) + 1);
  }

  const lines = normalizedLines.filter((line) => {
    // Remove marcadores de página e cabeçalhos repetitivos sem sinais coordenáveis.
    if (/^---\s*PAGINA\s*\d+\s*---$/i.test(line)) return false;

    const repeated = (freq.get(line) || 0) >= 3;
    if (!repeated) return true;

    // Preserva linhas úteis mesmo que repetidas.
    if (isCoordinateRelevantLine(line)) return true;

    // Linhas longas repetidas de cartório/solicitação são ruído para o parser.
    return line.length < 28;
  });

  const compacted = [];
  for (const line of lines) {
    const prev = compacted[compacted.length - 1];
    if (prev !== line) {
      compacted.push(line);
    }
  }

  return normalizeOcrArtifacts(compacted.join('\n'))
    .replace(/([A-Za-zÀ-ÖØ-öø-ÿ])-\n([A-Za-zÀ-ÖØ-öø-ÿ])/g, '$1$2')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function attachEtlMetadata(apiResult, etl) {
  return {
    ...apiResult,
    etl: etl && typeof etl === 'object'
      ? etl
      : undefined
  };
}

function confidenceToRank(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'high') return 3;
  if (normalized === 'medium') return 2;
  if (normalized === 'low') return 1;
  return 0;
}

function scoreExtractionResult(apiResult, selectorContext = {}) {
  if (!apiResult || apiResult.success !== true) return Number.NEGATIVE_INFINITY;

  const confidenceRank = confidenceToRank(apiResult.extractionConfidence || 'low');
  const extractedVertices = Number.isFinite(Number(apiResult.extractedVertices))
    ? Number(apiResult.extractedVertices)
    : estimateExtractedVerticesFromApiResult(apiResult);
  const sourcePattern = String(apiResult.sourcePattern || '').toLowerCase();
  const extractionMethod = String(apiResult.extractionMethod || '').toLowerCase();
  const projectionKey = String(apiResult.projectionKey || '').toUpperCase();
  const expectedPattern = String(selectorContext?.expectedPattern || '').toLowerCase();

  let score = confidenceRank * 1000;
  score += Math.min(Math.max(extractedVertices, 0), 500) * 5;

  if (sourcePattern.includes('layout')) score += 120;
  if (sourcePattern.includes('utm')) score += 60;
  if (extractionMethod.includes('ranked')) score += 35;
  if (sourcePattern.includes('fallback')) score -= 80;
  if (projectionKey.includes('LOCAL_RELATIVE')) score -= 150;

  if (expectedPattern === 'lat-long-table-or-list') {
    if (projectionKey.includes('WGS84') || sourcePattern.includes('lat') || sourcePattern.includes('lon')) {
      score += 140;
    }
  }

  if (expectedPattern === 'memorial-azimuth-distance') {
    if (projectionKey.includes('LOCAL_RELATIVE') || sourcePattern.includes('azimute') || sourcePattern.includes('rumo')) {
      score += 220;
    }
  }

  if (expectedPattern === 'utm-table-or-list') {
    if (sourcePattern.includes('utm') || projectionKey.includes('SIRGAS') || projectionKey.includes('UTM')) {
      score += 160;
    }
  }

  return score;
}

function choosePreferredExtractionResult(primaryResult, secondaryResult, selectorContext = {}) {
  if (!primaryResult) return secondaryResult || null;
  if (!secondaryResult) return primaryResult;

  const primaryScore = scoreExtractionResult(primaryResult, selectorContext);
  const secondaryScore = scoreExtractionResult(secondaryResult, selectorContext);
  return secondaryScore > primaryScore ? secondaryResult : primaryResult;
}

async function runOcrEtlBranch(fileName, totalPagesHint, baseText, arrayBuffer, ocrPlan, processingMode, runtime = {}) {
  const ocrStages = await runOcrEnhancementFlow(
    arrayBuffer,
    baseText,
    totalPagesHint,
    ocrPlan,
    processingMode,
    runtime
  );

  const stage2Text = String(ocrStages?.stage2Text || '').trim();
  if (!stage2Text) {
    throw new Error('OCR não retornou texto limpo utilizável.');
  }

  const stage2Confidence = buildTextCoordinateConfidence(stage2Text);
  const expectedPattern = String(runtime?.patternHint || '').toLowerCase();
  const stage2Pattern = classifyCoordinatePrintPattern(stage2Text);
  const stage2Signals = stage2Pattern?.signals || {};
  const isMemorialPattern = expectedPattern === 'memorial-azimuth-distance';
  const hasMemorialSignal = stage2Pattern?.id === 'memorial-azimuth-distance'
    || (Number(stage2Signals.azDistPairs || 0) >= 2)
    || (Number(stage2Signals.memorialCue || 0) >= 2);
  const hasCoordinatePairs = stage2Confidence.utmPairs > 0 || stage2Confidence.latLonPairs > 0;
  const weakCoordinateSignal = stage2Confidence.signal < 8;

  // Evita falso positivo quando OCR gera muito texto administrativo sem pares coordenáveis,
  // mas permite o parser backend tentar inferência em textos razoavelmente ricos.
  const normalizedStage2Length = stage2Text.replace(/\s+/g, ' ').trim().length;
  const shouldHardRejectNoCoordinates = !hasCoordinatePairs
    && weakCoordinateSignal
    && !isMemorialPattern
    && !hasMemorialSignal
    && normalizedStage2Length < 180;

  if (shouldHardRejectNoCoordinates) {
    logPdfDiag('ocr-stage2-rejected-no-coordinate-pairs', {
      msg: 'OCR limpo rejeitado por ausência de pares coordenáveis e baixo conteúdo útil antes do parser backend.',
      confidence: stage2Confidence,
      expectedPattern,
      stage2Pattern: stage2Pattern?.id || 'unknown',
      stage2Signals,
      normalizedStage2Length
    });
    throw new Error('Não foi possível localizar coordenadas UTM válidas no OCR enviado.');
  }

  if (!hasCoordinatePairs && weakCoordinateSignal && !isMemorialPattern && !hasMemorialSignal) {
    logPdfDiag('ocr-stage2-soft-pass-no-coordinate-pairs', {
      msg: 'OCR com sinal fraco de coordenadas seguirá para parser backend (modo tolerante).',
      confidence: stage2Confidence,
      expectedPattern,
      stage2Pattern: stage2Pattern?.id || 'unknown',
      stage2Signals,
      normalizedStage2Length
    });
  }

  const apiResult = await runParserLayoutFallbackBranch(
    fileName,
    totalPagesHint,
    stage2Text,
    processingMode,
    {
      branchLabel: 'OCR limpo -> parser/layout + fallback',
      diagPrefix: 'ocr-api',
      suppressUi: true,
      patternHint: String(runtime.patternHint || ''),
      flowMode: 'ocr',
      rawText: ocrStages.stage1RawText
    }
  );

  const extractedVertices = Number.isFinite(Number(apiResult?.extractedVertices))
    ? Number(apiResult.extractedVertices)
    : estimateExtractedVerticesFromApiResult(apiResult);

  return attachEtlMetadata(
    {
      ...apiResult,
      textSourceUsed: 'ocr-stage2-clean',
      __sourceText: stage2Text,
      extractedVertices
    },
    {
      branch: 'ocr-etl',
      stages: {
        stage1: {
          label: 'paddleocr-local-pages',
          textChars: ocrStages.stage1RawText.length,
          confidence: ocrStages.stage1Confidence
        },
        stage2: {
          label: 'ocr-clean-text',
          textChars: ocrStages.stage2Text.length,
          confidence: ocrStages.stage2Confidence
        },
        stage3: {
          label: 'ocr-clean-inference',
          sourcePattern: apiResult.sourcePattern || null,
          extractionMethod: apiResult.extractionMethod || null,
          extractedVertices
        },
        stage4: {
          label: 'utm-to-geojson',
          projectionKey: apiResult.projectionKey || null,
          geometryMode: apiResult.geometryMode || null
        },
        stage5: {
          label: 'geojson-to-shp',
          exportReady: true
        }
      }
    }
  );
}

async function runParserLayoutFallbackBranch(fileName, totalPagesHint, extractedText, processingMode, options = {}) {
  const branchLabel = String(options.branchLabel || 'Pipeline principal');
  const diagPrefix = String(options.diagPrefix || 'api');
  const patternHint = String(options.patternHint || '');
  const flowMode = String(options.flowMode || 'no-ocr');
  const suppressUi = options?.suppressUi === true;
  const updateBranchStatus = (message, type) => {
    if (!suppressUi && message) updateStatus(message, type);
  };

  const parserText = options?.fullText
    ?? (typeof extractedText !== 'undefined' ? extractedText : '');
  const inferenceRawText = String(options?.rawText ?? parserText);

  console.log("TAMANHO:", parserText.length);

  const vertexOccurrences =
    (
      parserText.match(/v[ée]rtice\s+[A-Za-z0-9._/-]+/gi) || []
    );

  console.log(
    "TOTAL DE OCORRENCIAS DE 'VERTICE':",
    vertexOccurrences.length
  );

  const pointIds =
    (
      parserText.match(/\b[A-Z]{1,3}\d+\b/gi) || []
    );

  const uniqueIds =
    [
      ...new Set(
        pointIds.map(v => v.toUpperCase())
      )
    ];

  uniqueIds.forEach(id => {

    const regex =
      new RegExp(id, 'i');

    const idx =
      parserText.search(regex);

    if (idx >= 0) {

      /*console.log(
          "---------- TRECHO DO VERTICE ----------"
      );*/

      console.log(
        parserText.substring(
          Math.max(0, idx - 200),
          idx + 400
        )
      );
    }
  });

  if (!getWorkspaceAiExtractorUrl()) {
    throw new Error('Serviço local de extração não configurado.');
  }

  let apiResult;
  try {
    logPdfDiag(`${diagPrefix}-attempt-1`, {
      msg: `${branchLabel}: primeira tentativa no extrator backend.`,
      routes: buildWorkspaceAiExtractorCandidates(),
      totalPagesHint,
      processingMode,
      textConfidence: buildTextCoordinateConfidence(parserText)
    });
    apiResult = await callWorkspaceAiExtractor(fileName, totalPagesHint, parserText, 0, patternHint, flowMode, inferenceRawText);

    // Refinamento direcionado: em memorial descritivo, se a primeira resposta
    // vier por literal direto, tenta 1-2 variantes de texto normalizado para
    // recuperar vértices de transição eventualmente perdidos na extração local.
    const isMemorialHint = patternHint === 'memorial-azimuth-distance';
    const extractionMethod = String(apiResult?.extractionMethod || '').toLowerCase();
    if (isMemorialHint && extractionMethod.includes('literal')) {
      const retryCandidates = buildBackendRetryTextCandidates(parserText)
        .filter((candidate) => candidate && candidate !== parserText)
        .sort((a, b) => scoreCoordinateText(b) - scoreCoordinateText(a))
        .slice(0, 2);

      for (let i = 0; i < retryCandidates.length; i++) {
        const candidate = retryCandidates[i];
        try {
          const refined = await callWorkspaceAiExtractor(fileName, totalPagesHint, candidate, 0, patternHint, flowMode);
          const selected = choosePreferredExtractionResult(apiResult, refined, {
            expectedPattern: patternHint
          });

          if (selected && selected !== apiResult) {
            const prevVertices = estimateExtractedVerticesFromApiResult(apiResult);
            const nextVertices = estimateExtractedVerticesFromApiResult(selected);
            apiResult = {
              ...selected,
              warnings: Array.isArray(selected.warnings)
                ? [...selected.warnings, `Refinamento automático aplicou variante de texto (memorial) e melhorou de ${prevVertices} para ${nextVertices} vértices.`]
                : [`Refinamento automático aplicou variante de texto (memorial) e melhorou de ${prevVertices} para ${nextVertices} vértices.`]
            };
          }
        } catch {
          // Mantém o melhor resultado já obtido.
        }
      }
    }
  } catch (firstError) {
    const hasCoordinateSigal = hasCoordinateCandidates(parserText, 1);
    const firstErrorMsg = String(firstError?.message || firstError || '');
    const deterministicNoUtm = /não foi possível localizar coordenadas UTM válidas/i.test(firstErrorMsg);

    updateBranchStatus('⏳ Fazendo um ajuste automático no processamento...', 'warning');
    logPdfDiag(`${diagPrefix}-attempt-1-failed`, {
      msg: `${branchLabel}: primeira tentativa falhou: ${firstError?.message || firstError}`,
      error: String(firstError?.message || firstError),
      hasCoordinateSignal: hasCoordinateSigal,
      deterministicNoUtm,
      textConfidence: buildTextCoordinateConfidence(parserText),
      ocrSample: sampleOcrForDiag(parserText)
    });

    if (deterministicNoUtm) {
      const retryCandidates = buildBackendRetryTextCandidates(parserText);
      const baselineScore = scoreCoordinateText(parserText);

      for (let i = 0; i < retryCandidates.length; i++) {
        const candidate = retryCandidates[i];
        if (candidate === parserText) continue;

        const retryScore = scoreCoordinateText(candidate);
        // Evita repetir chamada com texto pior que o baseline.
        if (retryScore < Math.max(1, baselineScore - 1)) continue;

        try {
          logPdfDiag(`${diagPrefix}-attempt-2-transformed`, {
            msg: `${branchLabel}: retry com texto normalizado/focado em coordenadas (variante ${i + 1}/${retryCandidates.length}).`,
            baselineScore,
            retryScore,
            baselineConfidence: buildTextCoordinateConfidence(parserText),
            retryConfidence: buildTextCoordinateConfidence(candidate)
          });
          apiResult = await callWorkspaceAiExtractor(fileName, totalPagesHint, candidate, 0, patternHint, flowMode);
          apiResult.warnings = Array.isArray(apiResult.warnings)
            ? [...apiResult.warnings, 'Processamento ajustado com texto normalizado para coordenadas.']
            : ['Processamento ajustado com texto normalizado para coordenadas.'];
          return apiResult;
        } catch {
          // Continua tentando próximas variantes.
        }
      }

      logPdfDiag(`${diagPrefix}-attempt-2-skipped`, {
        msg: `${branchLabel}: retry da API ignorado por falha determinística de coordenadas com o mesmo texto.`,
        textConfidence: buildTextCoordinateConfidence(parserText)
      });
      throw firstError;
    }

    updateBranchStatus('⏳ Fazendo uma nova tentativa automática...', 'info');
    try {
      logPdfDiag(`${diagPrefix}-attempt-2`, {
        msg: `${branchLabel}: segunda tentativa no extrator backend.`,
        routes: buildWorkspaceAiExtractorCandidates(),
        totalPagesHint,
        processingMode,
        textConfidence: buildTextCoordinateConfidence(parserText)
      });
      apiResult = await callWorkspaceAiExtractor(fileName, totalPagesHint, parserText, 0, patternHint, flowMode);
      apiResult.warnings = Array.isArray(apiResult.warnings)
        ? [...apiResult.warnings, 'Processamento ajustado automaticamente.']
        : ['Processamento ajustado automaticamente.'];
    } catch (secondError) {
      logPdfDiag(`${diagPrefix}-attempt-2-failed`, {
        msg: `${branchLabel}: segunda tentativa falhou: ${secondError?.message || secondError}`,
        error: String(secondError?.message || secondError)
      });
      throw secondError;
    }
  }

  apiResult.engineName = apiResult.engineName || 'Processamento de coordenadas';
  apiResult.warnings = Array.isArray(apiResult.warnings)
    ? apiResult.warnings
    : ['Extração processada com sucesso.'];

  return apiResult;
}

async function inferPdfPageCount(arrayBuffer) {
  try {
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer, enableXfa: true });
    const pdfDoc = await loadingTask.promise;
    return Number.isFinite(pdfDoc?.numPages) ? pdfDoc.numPages : 0;
  } catch {
    return 0;
  }
}

async function extractAcroFormFieldValues(page) {
  try {
    const annotations = await page.getAnnotations();
    return annotations
      .filter((ann) => ann.subtype === 'Widget' && typeof ann.fieldValue === 'string' && ann.fieldValue.trim())
      .map((ann) => ann.fieldValue.trim())
      .join('\n');
  } catch {
    return '';
  }
}

async function extractPdfTextLocally(arrayBuffer, maxPages = 200) {
  try {
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer, enableXfa: true });
    const pdfDoc = await loadingTask.promise;
    const totalPagesDoc = Number(pdfDoc?.numPages || 0);
    const safeMaxPages = Number.isFinite(Number(maxPages)) && Number(maxPages) > 0
      ? Number(maxPages)
      : totalPagesDoc;
    const totalPages = Math.min(totalPagesDoc, safeMaxPages);
    let fullText = '';
    const pageStats = [];

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = buildPageTextWithLines(textContent);
      const annotationText = await extractAcroFormFieldValues(page);
      const combinedPageText = annotationText
        ? `${pageText}\n${annotationText}`
        : pageText;
      pageStats.push({
        page: pageNum,
        chars: combinedPageText.length,
        signal: buildTextCoordinateConfidence(combinedPageText).signal
      });
      fullText += `\n\n--- PAGINA ${pageNum} ---\n`;
      fullText += combinedPageText;
    }

    const finalText = fullText.trim();
    const snapshot = captureExtractedTextSnapshot('local-pdf-text', finalText, {
      pagesInDocument: totalPagesDoc,
      pagesProcessed: totalPages,
      pageStats
    });

    logPdfDiag('local-text-capture', {
      msg: `Texto local capturado em ${totalPages}/${totalPagesDoc} páginas.`,
      chars: snapshot.chars,
      fingerprint: snapshot.fingerprint,
      pagesProcessed: totalPages,
      pagesInDocument: totalPagesDoc,
      pageStats
    });

    return finalText;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// OCR de imagem via PaddleOCR local compartilhado.
// ---------------------------------------------------------------------------

function _projectionVarianceAtAngle(canvas, angleDeg) {
  const W = canvas.width;
  const H = canvas.height;
  if (!W || !H) return 0;

  const scratch = document.createElement('canvas');
  scratch.width = W;
  scratch.height = H;
  const sctx = scratch.getContext('2d', { willReadFrequently: true });
  sctx.fillStyle = '#fff';
  sctx.fillRect(0, 0, W, H);
  sctx.save();
  sctx.translate(W / 2, H / 2);
  sctx.rotate((angleDeg * Math.PI) / 180);
  sctx.drawImage(canvas, -W / 2, -H / 2);
  sctx.restore();

  const d = sctx.getImageData(0, 0, W, H).data;
  const rowSums = new Float64Array(H);
  for (let y = 0; y < H; y++) {
    let count = 0;
    for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * 4;
      if (d[i] < 128) count += 1;
    }
    rowSums[y] = count;
  }

  let mean = 0;
  for (let y = 0; y < H; y++) mean += rowSums[y];
  mean /= Math.max(1, H);
  let variance = 0;
  for (let y = 0; y < H; y++) {
    const diff = rowSums[y] - mean;
    variance += diff * diff;
  }
  return variance / Math.max(1, H);
}

function _deskewCanvasForOcr(canvas) {
  const W = canvas.width;
  const H = canvas.height;
  if (!W || !H) return 0;

  const maxDim = Math.max(W, H);
  const sampleScale = maxDim > 1200 ? (1200 / maxDim) : 1;
  const sample = document.createElement('canvas');
  sample.width = Math.max(1, Math.round(W * sampleScale));
  sample.height = Math.max(1, Math.round(H * sampleScale));
  const pctx = sample.getContext('2d', { willReadFrequently: true });
  pctx.fillStyle = '#fff';
  pctx.fillRect(0, 0, sample.width, sample.height);
  pctx.drawImage(canvas, 0, 0, sample.width, sample.height);

  const angles = [-1.8, -1.2, -0.8, -0.4, 0, 0.4, 0.8, 1.2, 1.8];
  let bestAngle = 0;
  let bestScore = -Infinity;
  for (const angle of angles) {
    const score = _projectionVarianceAtAngle(sample, angle);
    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
    }
  }

  if (Math.abs(bestAngle) < 0.2) return 0;

  const rotated = document.createElement('canvas');
  rotated.width = W;
  rotated.height = H;
  const rctx = rotated.getContext('2d', { willReadFrequently: true });
  rctx.fillStyle = '#fff';
  rctx.fillRect(0, 0, W, H);
  rctx.save();
  rctx.translate(W / 2, H / 2);
  rctx.rotate((bestAngle * Math.PI) / 180);
  rctx.drawImage(canvas, -W / 2, -H / 2);
  rctx.restore();

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(rotated, 0, 0);
  return bestAngle;
}

/**
 * Pré-processamento avançado para OCR de coordenadas:
 * escala de cinza -> contraste local -> binarização adaptativa -> denoise -> deskew leve.
 */
function _preprocessCanvasForOcr(canvas, options = {}) {
  const enableDeskew = options.enableDeskew === true;
  const profile = String(options.profile || 'default').toLowerCase();
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const W = canvas.width;
  const H = canvas.height;
  const imgData = ctx.getImageData(0, 0, W, H);
  const d = imgData.data;

  const gray = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < d.length; i += 4, p += 1) {
    gray[p] = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
  }

  let min = 255;
  let max = 0;
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] < min) min = gray[i];
    if (gray[i] > max) max = gray[i];
  }
  const range = Math.max(1, max - min);

  // Integral image para média local rápida por janela (evita custo quadrático)
  const integral = new Uint32Array((W + 1) * (H + 1));
  for (let y = 1; y <= H; y++) {
    let rowSum = 0;
    const rowOffset = (y - 1) * W;
    for (let x = 1; x <= W; x++) {
      rowSum += gray[rowOffset + (x - 1)];
      integral[y * (W + 1) + x] = integral[(y - 1) * (W + 1) + x] + rowSum;
    }
  }

  const block = profile === 'dense-table' ? 24 : 32;
  const thresholdFactor = profile === 'dense-table' ? 0.84 : 0.9;
  const minThreshold = profile === 'dense-table' ? 70 : 85;
  const maxThreshold = profile === 'dense-table' ? 220 : 210;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      const norm = ((gray[idx] - min) * 255) / range;
      const y0 = Math.max(0, y - block);
      const y1 = Math.min(H - 1, y + block);
      const x0 = Math.max(0, x - block);
      const x1 = Math.min(W - 1, x + block);
      const ia = y0 * (W + 1) + x0;
      const ib = y0 * (W + 1) + (x1 + 1);
      const ic = (y1 + 1) * (W + 1) + x0;
      const id = (y1 + 1) * (W + 1) + (x1 + 1);
      const localSum = integral[id] - integral[ib] - integral[ic] + integral[ia];
      const localCount = Math.max(1, (x1 - x0 + 1) * (y1 - y0 + 1));
      const localAvg = localSum / localCount;
      const threshold = Math.max(minThreshold, Math.min(maxThreshold, localAvg * thresholdFactor));
      gray[idx] = norm < threshold ? 0 : 255;
    }
  }

  // Denoise simples: remove pontos isolados (filtro de maioria 3x3)
  const denoised = new Uint8Array(gray.length);
  denoised.set(gray);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const idx = y * W + x;
      let blackNeighbors = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (gray[(y + dy) * W + (x + dx)] === 0) blackNeighbors += 1;
        }
      }
      if (gray[idx] === 0 && blackNeighbors <= 1) denoised[idx] = 255;
      else if (gray[idx] === 255 && blackNeighbors >= 7) denoised[idx] = 0;
    }
  }

  for (let i = 0, p = 0; i < d.length; i += 4, p += 1) {
    const v = denoised[p];
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);

  return enableDeskew ? _deskewCanvasForOcr(canvas) : 0;
}

function buildPrioritizedPageOrder(totalPages, maxPages) {
  const total = Number.isFinite(Number(totalPages)) ? Math.max(0, Number(totalPages)) : 0;
  const limit = Number.isFinite(Number(maxPages)) ? Math.max(0, Number(maxPages)) : total;
  const target = Math.min(total, limit);
  if (target <= 0) return [];

  const order = [];
  const seen = new Set();
  const push = (p) => {
    if (!Number.isFinite(p)) return;
    const page = Math.max(1, Math.min(total, Math.round(p)));
    if (seen.has(page) || order.length >= target) return;
    seen.add(page);
    order.push(page);
  };

  // Prioriza início/fim (onde memoriais e assinaturas costumam concentrar coordenadas)
  [1, 2, total, total - 1, Math.ceil(total / 2), 3, total - 2].forEach(push);

  for (let p = 1; p <= total && order.length < target; p += 1) push(p);
  return order;
}

function buildSequentialPageOrder(totalPages, maxPages) {
  const total = Number.isFinite(Number(totalPages)) ? Math.max(0, Number(totalPages)) : 0;
  const limit = Number.isFinite(Number(maxPages)) ? Math.max(0, Number(maxPages)) : total;
  const target = Math.min(total, limit);
  const out = [];
  for (let p = 1; p <= target; p += 1) out.push(p);
  return out;
}

function _cloneCanvas(source) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0);
  return canvas;
}

function _cropCanvas(source, xPct, yPct, wPct, hPct) {
  const W = source.width;
  const H = source.height;
  const sx = Math.max(0, Math.floor(W * xPct));
  const sy = Math.max(0, Math.floor(H * yPct));
  const sw = Math.max(1, Math.floor(W * wPct));
  const sh = Math.max(1, Math.floor(H * hPct));

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, sw, sh);
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas;
}

function _buildOcrRoiCandidates(canvas, includeExtraRoi = false) {
  const candidates = [{
    label: 'full',
    canvas: _cloneCanvas(canvas),
    preprocess: { profile: 'default' }
  }];

  if (includeExtraRoi) {
    candidates.push({
      label: 'upper-half',
      canvas: _cropCanvas(canvas, 0.03, 0.05, 0.94, 0.45),
      preprocess: { profile: 'default' }
    });
    candidates.push({
      label: 'middle-band',
      canvas: _cropCanvas(canvas, 0.04, 0.26, 0.92, 0.52),
      preprocess: { profile: 'dense-table' }
    });
    candidates.push({
      label: 'lower-half',
      canvas: _cropCanvas(canvas, 0.03, 0.44, 0.94, 0.54),
      preprocess: { profile: 'dense-table' }
    });
    candidates.push({
      label: 'left-column',
      canvas: _cropCanvas(canvas, 0.02, 0.08, 0.48, 0.86),
      preprocess: { profile: 'dense-table' }
    });
    candidates.push({
      label: 'right-column',
      canvas: _cropCanvas(canvas, 0.50, 0.08, 0.48, 0.86),
      preprocess: { profile: 'dense-table' }
    });
  }

  return candidates.filter((item) => item?.canvas?.width > 10 && item?.canvas?.height > 10);
}

async function extractTextWithLocalOcr(arrayBuffer, maxPages = 10, scale = 5, options = {}) {
  const paddleText = await extractTextWithPaddleOcr(arrayBuffer, maxPages, Math.min(scale, 3.2));
  if (paddleText?.rawText && paddleText.rawText.length > 200) {
    window._OCR_PROVIDER = 'paddleocr-local';
    window._OCR_FULL_TEXT = paddleText.rawText;
    return options?.returnStages === true
      ? paddleText
      : paddleText;
  }

  try {
    setProgressExperience('Executando OCR otimizado...', null);

    if (!paddleText?.rawText) {
      throw new Error('PaddleOCR local não retornou texto.');
    }

    const worker = { recognize: async () => ({ data: { text: '' } }) };

    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdfDoc = await loadingTask.promise;

    const totalPages = Math.min(pdfDoc.numPages, maxPages);

    let fullRawText = '';

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      setProgressExperience(`Processando página ${pageNum}/${totalPages}...`, null);

      const page = await pdfDoc.getPage(pageNum);

      // RENDER EM ALTA RESOLUÇÃO (igual ao outro app)
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({
        canvasContext: ctx,
        viewport: viewport
      }).promise;

      // Usa contraste local, binarização adaptativa, denoise e deskew leve.
      // A limiarização fixa degradava acentos, separadores DMS e dígitos OCR.
      _preprocessCanvasForOcr(canvas, {
        enableDeskew: options.enableDeskew === true,
        profile: 'default'
      });

      const result = await worker.recognize(canvas);

      const text = String(result?.data?.text || '').trim();

      if (text) {
        fullRawText += `\n\n--- PAGINA ${pageNum} ---\n${text}`;
      }
    }

    const rawText = fullRawText.trim();

    // salva o OCR globalmente para uso posterior
    window._OCR_FULL_TEXT = rawText;

    const verticesFinal = buildVerticesTableData(rawText);

    extractedCoordinates = verticesFinal.map(v => ({
      id: v.id,
      north: v.north,
      east: v.east
    }));

    const cleanedText = buildCleanOcrStageText(rawText);

    // mantém compatibilidade com o restante do sistema
    if (options?.returnStages === true) {
      return {
        rawText,
        cleanedText
      };
    }


    return {
      rawText,
      cleanedText
    };

  } catch (e) {
    console.warn('[PDFtoArcgis][OCR] erro:', e?.message || e);

    return options?.returnStages === true
      ? { rawText: '', cleanedText: '' }
      : '';
  }
}

async function extractTextWithPaddleOcr(arrayBuffer, maxPages = 10, scale = 3) {
  const endpoint = 'http://127.0.0.1:11437/api/ocr';
  try {
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdfDoc = await loadingTask.promise;
    const totalPages = Math.min(pdfDoc.numPages, maxPages);
    const images = [];

    for (let pageNum = 1; pageNum <= totalPages; pageNum += 1) {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      images.push(canvas.toDataURL('image/jpeg', 0.9));
    }

    const payload = await window.VetorizadorLocalOcr?.recognizeImages(images);
    if (!payload?.ok || !Array.isArray(payload.pages)) return null;

    const rawText = payload.pages
      .map((page) => `--- PAGINA ${page.page} ---\n${String(page.text || '')}`)
      .filter((text) => text.trim())
      .join('\n\n')
      .trim();
    return {
      rawText,
      cleanedText: buildCleanOcrStageText(rawText),
      stage1RawText: rawText,
      provider: payload.provider,
      meanConfidence: payload.meanConfidence
    };
  } catch (error) {
    console.warn('[PDFtoArcgis][OCR] PaddleOCR local indisponível:', error?.message || error);
    return null;
  }
}

// Stage 1: OCR bruto local (sem normalização semântica).
async function runStage1RawOcr(arrayBuffer, maxPages = 10, scale = 3.0, options = {}) {
  try {
    const staged = await extractTextWithLocalOcr(
      arrayBuffer,
      maxPages,
      scale,
      {
        ...options,
        returnStages: true
      }
    );

    // pega o texto bruto do OCR
    return String(staged?.rawText || '').trim();

  } catch (error) {
    console.warn("OCR local falhou em runStage1RawOcr:", error);
    // garante que não quebra o fluxo
    return '';
  }
}


function runStage2NormalizeText(text) {
  return buildCleanOcrStageText(text);
}

async function runOcrEnhancementFlow(arrayBuffer, localText, totalPagesHint, ocrPlan, processingMode, runtime = {}) {

  console.log('OCR FLOW INPUT:', typeof localText, localText?.length);

  let stage1RawText = localText;

  const setOcrUi = (message, labelText, progressValue) => {
    if (runtime?.suppressUi === true) return;
    if (message) updateStatus(message, 'info');
    setProgressExperience(labelText, progressValue);
  };

  setOcrUi('⏳ Continuando a leitura do documento...', 'Lendo e organizando o conteúdo...', 55);

  const pass1MaxPages = ocrPlan.pass1.maxPages;
  const pass1Start = Date.now();

  let finalText = localText;

  let ocrText = '';

  try {
    ocrText = await runStage1RawOcr(
      arrayBuffer,
      pass1MaxPages,
      ocrPlan.pass1.scale,
      {
        enableDeskew: ocrPlan.pass1.enableDeskew,
        fullScan: ocrPlan.pass1.fullScan,
        maxTotalMs: ocrPlan.pass1.maxTotalMs
      }
    );

  } catch (e) {
    console.warn('OCR falhou:', e);
  }

  if (typeof ocrText === 'string' && ocrText.length > 500) {
    finalText = ocrText;
  }

  console.log('FINAL TEXT SIZE:', finalText.length);

  const pass1DurationMs = Date.now() - pass1Start;

  stage1RawText = finalText || stage1RawText;

  let stage2Text = runStage2NormalizeText(stage1RawText);

  const postPass1 = buildTextCoordinateConfidence(stage2Text);
  const postPass1Pattern = classifyCoordinatePrintPattern(stage2Text);
  const postPass1Signals = postPass1Pattern?.signals || {};
  const hasMemorialSignal = postPass1Pattern?.id === 'memorial-azimuth-distance'
    || Number(postPass1Signals.azDistPairs || 0) >= 2
    || Number(postPass1Signals.memorialCue || 0) >= 2;
  logPdfDiag('ocr-pass-1', {
    msg: `Passo 1 concluído: chars=${postPass1.chars}, UTM=${postPass1.utmPairs}, LatLon=${postPass1.latLonPairs}, duraçãoMs=${pass1DurationMs}.`,
    pass1MaxPages,
    pass1DurationMs,
    totalPagesHint,
    processingMode,
    confidence: postPass1,
    documentPattern: postPass1Pattern?.id || 'unknown',
    documentPatternSignals: postPass1Signals
  });

  let shouldRunPass2 = ocrPlan.runPass2When(postPass1, pass1DurationMs);
  // Para memorial sem par coordenável absoluto, o pass2 longo tende a duplicar ruído.
  if (shouldRunPass2 && hasMemorialSignal && postPass1.utmPairs === 0 && postPass1.latLonPairs === 0) {
    if (pass1DurationMs > 120000 || postPass1.chars > 7000) {
      shouldRunPass2 = false;
      logPdfDiag('ocr-pass-2-skipped-memorial', {
        msg: 'Passo 2 pulado: memorial detectado sem pares absolutos e pass1 já custoso.',
        pass1DurationMs,
        confidence: postPass1,
        documentPattern: postPass1Pattern?.id || 'unknown',
        documentPatternSignals: postPass1Signals
      });
    }
  }

  if (shouldRunPass2) {
    setOcrUi('⏳ Refinando a leitura do documento...', 'Refinando a análise...');
    const pass2MaxPages = ocrPlan.pass2.maxPages;
    const stage1Pass2Raw = await runStage1RawOcr(arrayBuffer, pass2MaxPages, ocrPlan.pass2.scale, {
      enableDeskew: ocrPlan.pass2.enableDeskew,
      fullScan: ocrPlan.pass2.fullScan,
      maxTotalMs: ocrPlan.pass2.maxTotalMs
    });
    stage1RawText = mergeUniqueTextBlocks(stage1RawText, stage1Pass2Raw);
    stage2Text = runStage2NormalizeText(stage1RawText);

    const postPass2 = buildTextCoordinateConfidence(stage2Text);
    logPdfDiag('ocr-pass-2', {
      msg: `Passo 2 concluído: chars=${postPass2.chars}, UTM=${postPass2.utmPairs}, LatLon=${postPass2.latLonPairs}.`,
      pass2MaxPages,
      totalPagesHint,
      processingMode,
      confidence: postPass2
    });

    if (postPass2.utmPairs < 2 && postPass2.latLonPairs < 2) {
      logPdfDiag('ocr-pass-2-low-signal', {
        msg: 'OCR permaneceu com sinal baixo após 2 passos. Prosseguindo com parser e fallback sem novos passes.',
        confidence: postPass2,
        ocrSample: sampleOcrForDiag(stage2Text)
      });
    }
  }

  return {
    stage1RawText,
    stage2Text,
    stage1Confidence: buildTextCoordinateConfidence(stage1RawText),
    stage2Confidence: buildTextCoordinateConfidence(stage2Text)
  };
}

function parseNumericLoose(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  let normalized = value
    .trim()
    .replace(/[Oo]/g, '0')
    .replace(/[Il|]/g, '1')
    .replace(/[Ss]/g, '5')
    .replace(/B/g, '8')
    .replace(/[^\d,.-\s]/g, '')
    .replace(/\s+/g, '');
  if (!normalized) return null;

  const hasComma = normalized.includes(',');
  const hasDot = normalized.includes('.');
  if (hasComma && hasDot) {
    if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (hasComma) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if ((normalized.match(/\./g) || []).length > 1) {
    normalized = normalized.replace(/\./g, '');
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractNumericCandidatesLocal(text) {
  const src = String(text || '');
  const out = [];
  const seen = new Set();
  const push = (token) => {
    const t = String(token || '').trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };

  const tolerant = src.match(/-?[\dOIlSB][\dOIlSB\s.,]{3,}/g) || [];
  for (const m of tolerant) {
    const compact = m.replace(/\s+/g, ' ').trim();
    if (compact.replace(/\D/g, '').length >= 5) push(compact);
  }

  const strict = src.match(/-?\d[\d.,]*/g) || [];
  for (const m of strict) push(m);
  return out;
}

function normalizeUtmPairLocal(a, b) {
  const ax = parseNumericLoose(a);
  const bx = parseNumericLoose(b);
  if (!Number.isFinite(ax) || !Number.isFinite(bx)) return null;
  const absA = Math.abs(ax);
  const absB = Math.abs(bx);
  const isE = (v) => v >= 100000 && v <= 900000;
  const isN = (v) => v >= 1000000 && v <= 10000000;
  if (isE(absA) && isN(absB)) return [ax, bx];
  if (isN(absA) && isE(absB)) return [bx, ax];
  return null;
}

function selectCoherentUtmPointsLocal(points) {
  if (!Array.isArray(points) || points.length === 0) return [];

  const dedup = [];
  const seen = new Set();
  for (const p of points) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const east = Number(p[0]);
    const north = Number(p[1]);
    if (!Number.isFinite(east) || !Number.isFinite(north)) continue;
    const key = `${east.toFixed(2)}|${north.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push([east, north]);
  }

  if (dedup.length < 3) return dedup;

  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const neighborhood = (src, radius) => src.map((point, idx) => {
    let count = 0;
    for (let j = 0; j < src.length; j++) {
      if (j === idx) continue;
      if (distance(point, src[j]) <= radius) count += 1;
    }
    return count;
  });

  let filtered = dedup;
  const strict = neighborhood(dedup, 80000);
  const strictFiltered = dedup.filter((_, idx) => strict[idx] >= 2);
  if (strictFiltered.length >= 3) {
    filtered = strictFiltered;
  } else {
    const loose = neighborhood(dedup, 140000);
    const looseFiltered = dedup.filter((_, idx) => loose[idx] >= 1);
    if (looseFiltered.length >= 3) filtered = looseFiltered;
  }

  if (filtered.length < 3) return dedup;

  const segments = [];
  let current = [filtered[0]];
  for (let i = 1; i < filtered.length; i++) {
    if (distance(filtered[i - 1], filtered[i]) <= 120000) {
      current.push(filtered[i]);
    } else {
      if (current.length >= 3) segments.push(current);
      current = [filtered[i]];
    }
  }
  if (current.length >= 3) segments.push(current);

  return segments.length > 0 ? segments.sort((a, b) => b.length - a.length)[0] : filtered;
}

// Navegação lateral e rolagem para resultados.
function openNav() {
  document.getElementById("mySidenav").style.width = "250px";
}
function closeNav() { document.getElementById("mySidenav").style.width = "0"; }

// Atualiza o painel de validação topológica.
function updateValidationUI(topology, corrections = []) {
  const validationBox = document.getElementById("validationBox");
  const validationTitle = document.getElementById("validationTitle");
  const validationErrors = document.getElementById("validationErrors");
  const validationWarnings = document.getElementById("validationWarnings");
  const validationSuccess = document.getElementById("validationSuccess");
  const validationDetails = document.getElementById("validationDetails");
  const validationActions = document.getElementById("validationActions");
  const errorList = document.getElementById("errorList");
  const warningList = document.getElementById("warningList");

  if (!validationBox) return;

  // Exibe painel.
  validationBox.style.display = "block";

  // Limpa listas.
  if (errorList) errorList.innerHTML = "";
  if (warningList) warningList.innerHTML = "";

  // Atualiza título.
  if (validationTitle) {
    validationTitle.replaceChildren();
    const icon = document.createElement('i');
    icon.className = topology.isValid ? 'fas fa-check-circle' : 'fas fa-exclamation-triangle';
    icon.style.color = topology.isValid ? '#28a745' : '#dc3545';
    validationTitle.appendChild(icon);
    validationTitle.appendChild(document.createTextNode(topology.isValid ? ' Polígono Válido!' : ' Problemas Detectados'));
  }

  // Renderiza erros.
  if (topology.errors && topology.errors.length > 0 && validationErrors && errorList) {
    validationErrors.style.display = "block";
    topology.errors.forEach(err => {
      const li = document.createElement("li");
      li.textContent = err;
      errorList.appendChild(li);
    });
  } else if (validationErrors) {
    validationErrors.style.display = "none";
  }

  // Renderiza avisos.
  if (topology.warnings && topology.warnings.length > 0 && validationWarnings && warningList) {
    validationWarnings.style.display = "block";
    topology.warnings.forEach(warn => {
      const li = document.createElement("li");
      li.textContent = warn;
      warningList.appendChild(li);
    });
  } else if (validationWarnings) {
    validationWarnings.style.display = "none";
  }

  // Renderiza resumo de sucesso.
  if (topology.isValid && validationSuccess && validationDetails) {
    validationSuccess.style.display = "block";

    const areaHa = (topology.area / 10000).toFixed(4);
    const areaM2 = topology.area.toFixed(2);
    const closedText = topology.closed ? "✓ Fechado" : "⚠ Não fechado";
    validationDetails.replaceChildren();

    const summaryLines = [
      ['Área:', `${areaHa} ha (${areaM2} m²)`],
      ['Fechamento:', closedText],
      ['Orientação:', 'Anti-horária (CCW) ✓'],
      ['Auto-intersecções:', topology.hasIntersections ? '❌ Sim' : '✓ Não']
    ];

    summaryLines.forEach(([label, value]) => {
      const line = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = label;
      line.appendChild(strong);
      line.appendChild(document.createTextNode(` ${value}`));
      validationDetails.appendChild(line);
    });

    if (corrections.length > 0) {
      const spacer = document.createElement('div');
      spacer.style.marginTop = '12px';
      validationDetails.appendChild(spacer);

      const heading = document.createElement('strong');
      heading.textContent = 'Correções aplicadas:';
      validationDetails.appendChild(heading);

      const list = document.createElement('ul');
      list.style.margin = '6px 0 0 18px';
      corrections.forEach((corr) => {
        const item = document.createElement('li');
        item.textContent = String(corr || '');
        list.appendChild(item);
      });
      validationDetails.appendChild(list);
    }
  } else if (validationSuccess) {
    validationSuccess.style.display = "none";
  }

  // Controla exibição das ações de correção.
  if (validationActions) {
    if (!topology.isValid && topology.errors.length > 0) {
      validationActions.style.display = "block";
    } else {
      validationActions.style.display = "none";
    }
  }
}

function hideValidationUI() {
  const validationBox = document.getElementById("validationBox");
  if (validationBox) validationBox.style.display = "none";
}

function scrollToResults() {
  const box = document.getElementById("resultBox");
  if (box && box.style.display !== "none") box.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Configuração local do worker do PDF.js.
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "vendor/pdf.worker.min.js";

// Referências de UI e estado.
const fileInput = document.getElementById("fileInput");
const statusDiv = document.getElementById("status");
const progressBar = document.getElementById("progressBar");
const progressContainer = document.getElementById("progressContainer");
const resultBox = document.getElementById("resultBox");
const countDisplay = document.getElementById("countDisplay");
const previewTableBody = document.querySelector("#previewTable tbody");
const downloadBtn = document.getElementById("downloadBtn");
const saveToFolderBtn = document.getElementById("saveToFolderBtn");

const crsDetectedBox = document.getElementById("crsDetectedBox");
const crsDetectedTitle = document.getElementById("crsDetectedTitle");
const crsDetectedReason = document.getElementById("crsDetectedReason");
const advancedCrs = document.getElementById("advancedCrs");
const projectionSelect = document.getElementById("projectionSelect");
const forceCrsBtn = document.getElementById("forceCrsBtn");

const docSelectorBox = document.getElementById("docSelectorBox");
const docSelect = document.getElementById("docSelect");
const docMeta = document.getElementById("docMeta");

let extractedCoordinates = [];
let fileNameBase = "coordenadas_extracao";
let pdfOrigemNomeBase = "";
let pdfOrigemSrc = "";

// Resultados por matrícula no PDF unificado.
let documentsResults = [];
let activeDocIndex = -1;

// Projeções suportadas (WKT).
const PROJECTIONS = {
  SIRGAS2000_25S: {
    name: "SIRGAS 2000 / UTM zone 25S",
    epsg: "EPSG:31985",
    wkt: 'PROJCS["SIRGAS 2000 / UTM zone 25S",GEOGCS["SIRGAS 2000",DATUM["Sistema de Referencia Geocentrico para las Americas 2000",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",-33],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",10000000],UNIT["metre",1]]'
  },
  SIRGAS2000_21S: {
    name: "SIRGAS 2000 / UTM zone 21S",
    epsg: "EPSG:31981",
    wkt: 'PROJCS["SIRGAS 2000 / UTM zone 21S",GEOGCS["SIRGAS 2000",DATUM["Sistema de Referencia Geocentrico para las Americas 2000",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",-57],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",10000000],UNIT["metre",1]]'
  },
  SIRGAS2000_22S: {
    name: "SIRGAS 2000 / UTM zone 22S",
    epsg: "EPSG:31982",
    wkt: 'PROJCS["SIRGAS 2000 / UTM zone 22S",GEOGCS["SIRGAS 2000",DATUM["Sistema de Referencia Geocentrico para las Americas 2000",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",-51],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",10000000],UNIT["metre",1]]'
  },
  SIRGAS2000_23S: {
    name: "SIRGAS 2000 / UTM zone 23S",
    epsg: "EPSG:31983",
    wkt: 'PROJCS["SIRGAS 2000 / UTM zone 23S",GEOGCS["SIRGAS 2000",DATUM["Sistema de Referencia Geocentrico para las Americas 2000",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",-45],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",10000000],UNIT["metre",1]]'
  },
  SIRGAS2000_24S: {
    name: "SIRGAS 2000 / UTM zone 24S",
    epsg: "EPSG:31984",
    wkt: 'PROJCS["SIRGAS 2000 / UTM zone 24S",GEOGCS["SIRGAS 2000",DATUM["Sistema de Referencia Geocentrico para las Americas 2000",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",-39],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",10000000],UNIT["metre",1]]'
  },
  SAD69_22S: {
    name: "SAD69 / UTM zone 22S",
    epsg: "EPSG:29192",
    wkt: 'PROJCS["SAD69 / UTM zone 22S",GEOGCS["SAD69",DATUM["South_American_Datum_1969",SPHEROID["GRS 1967 Modified",6378160,298.25]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",-51],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",10000000],UNIT["metre",1]]'
  },
  SAD69_23S: {
    name: "SAD69 / UTM zone 23S",
    epsg: "EPSG:29193",
    wkt: 'PROJCS["SAD69 / UTM zone 23S",GEOGCS["SAD69",DATUM["South_American_Datum_1969",SPHEROID["GRS 1967 Modified",6378160,298.25]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",-45],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",10000000],UNIT["metre",1]]'
  },
  WGS84: {
    name: "WGS 84",
    epsg: "EPSG:4326",
    wkt: 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]'
  }
};

// Helpers de status e normalizacao
function updateStatus(msg, type) {
  statusDiv.style.display = "block";
  statusDiv.innerText = msg;
  statusDiv.className = "status-" + type;


  const statusEl = document.getElementById("status");

  if (!statusEl) return;

  // foco automático
  statusEl.focus();
}

function sanitizeFileName(name) {
  return (name || "")
    .replace(/\.[^/.]+$/, "")
    .replace(/[\\/:*?"<>\n\r]/g, "")
    .replace(/\s+/g, "_");
}

const LOCAL_RELATIVE_ORIGIN_STORAGE_KEY = 'pdfToArcgis.localRelativeOrigin.latlon';

function parseLatLonInputValue(rawValue) {
  const normalized = String(rawValue || '').trim().replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function readStoredLocalRelativeOrigin() {
  try {
    const raw = localStorage.getItem(LOCAL_RELATIVE_ORIGIN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const lat = Number(parsed?.lat);
    const lon = Number(parsed?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  } catch {
    return null;
  }
}

function persistLocalRelativeOrigin(lat, lon) {
  try {
    localStorage.setItem(LOCAL_RELATIVE_ORIGIN_STORAGE_KEY, JSON.stringify({ lat, lon }));
  } catch {
    // Ignora falha de persistência local.
  }
}

function askLocalRelativeOriginLatLon(defaultValue = null) {
  const fallback = defaultValue && Number.isFinite(defaultValue.lat) && Number.isFinite(defaultValue.lon)
    ? defaultValue
    : { lat: -25.43, lon: -51.94 };

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'background:rgba(0,0,0,0.45)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'padding:16px',
      'z-index:99999'
    ].join(';');

    const modal = document.createElement('div');
    modal.style.cssText = [
      'width:min(96vw,480px)',
      'background:#ffffff',
      'border-radius:14px',
      'padding:16px',
      'box-shadow:0 22px 52px rgba(0,0,0,0.25)',
      'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif'
    ].join(';');

    modal.innerHTML = `
      <h3 style="margin:0 0 8px 0; font-size:18px; color:#102a43;">Definir ponto inicial (Lat/Lon)</h3>
      <p style="margin:0 0 12px 0; font-size:13px; color:#334e68; line-height:1.45;">
        Este documento não trouxe referência absoluta. Informe uma origem em latitude/longitude para posicionar o polígono no mapa.
      </p>
      <label style="display:block; font-size:12px; font-weight:600; margin-bottom:6px; color:#243b53;">Latitude</label>
      <input id="pdfArcgisOriginLat" type="text" value="${fallback.lat.toFixed(6)}" placeholder="Ex.: -25.428954" style="width:100%; box-sizing:border-box; margin-bottom:10px; padding:10px; border:1px solid #bcccdc; border-radius:8px; font-size:14px;" />
      <label style="display:block; font-size:12px; font-weight:600; margin-bottom:6px; color:#243b53;">Longitude</label>
      <input id="pdfArcgisOriginLon" type="text" value="${fallback.lon.toFixed(6)}" placeholder="Ex.: -51.939106" style="width:100%; box-sizing:border-box; margin-bottom:10px; padding:10px; border:1px solid #bcccdc; border-radius:8px; font-size:14px;" />
      <div id="pdfArcgisOriginError" style="display:none; margin-bottom:10px; color:#b42318; font-size:12px;"></div>
      <div style="display:flex; justify-content:flex-end; gap:8px;">
        <button id="pdfArcgisOriginApply" type="button" style="padding:9px 12px; border-radius:8px; border:none; background:#0f6cbd; color:#fff; cursor:pointer;">Aplicar origem</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const latInput = modal.querySelector('#pdfArcgisOriginLat');
    const lonInput = modal.querySelector('#pdfArcgisOriginLon');
    const errBox = modal.querySelector('#pdfArcgisOriginError');
    const applyBtn = modal.querySelector('#pdfArcgisOriginApply');

    const close = (value) => {
      overlay.remove();
      resolve(value);
    };

    const showError = (message) => {
      if (!errBox) return;
      errBox.style.display = 'block';
      errBox.textContent = message;
    };

    const apply = () => {
      const lat = parseLatLonInputValue(latInput?.value);
      const lon = parseLatLonInputValue(lonInput?.value);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        showError('Digite latitude e longitude válidas.');
        return;
      }
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        showError('Latitude deve estar entre -90 e 90 e longitude entre -180 e 180.');
        return;
      }

      close({ lat, lon });
    };

    applyBtn?.addEventListener('click', apply);
    // Fluxo propositalmente estrito: só confirma ao clicar no botão
    // o "Aplicar origem".

    latInput?.focus();
    latInput?.select();
  });
}

function isLocalRelativeApiResult(apiResult) {
  const mode = String(apiResult?.geometryMode || '').toLowerCase();
  const projectionKey = String(apiResult?.projectionKey || '').toUpperCase();
  return mode.includes('local_relative') || projectionKey.includes('LOCAL_RELATIVE');
}

function shiftVerticesToNewOrigin(vertices, targetOrigin) {
  const list = Array.isArray(vertices) ? vertices : [];
  if (!list.length) return list;

  const first = list[0];
  const baseEast = Number(first?.east);
  const baseNorth = Number(first?.north);
  const targetEast = Number(targetOrigin?.east);
  const targetNorth = Number(targetOrigin?.north);
  if (!Number.isFinite(baseEast) || !Number.isFinite(baseNorth) || !Number.isFinite(targetEast) || !Number.isFinite(targetNorth)) {
    return list;
  }

  return list.map((vertex) => ({
    ...vertex,
    east: Number((targetEast + (Number(vertex.east) - baseEast)).toFixed(6)),
    north: Number((targetNorth + (Number(vertex.north) - baseNorth)).toFixed(6))
  }));
}

function detectUtmZoneFromLongitude(lon) {
  const longitude = Number(lon);
  if (!Number.isFinite(longitude)) return 22;

  // Fórmula padrão UTM: zonas de 1 a 60 em faixas de 6 graus.
  const rawZone = Math.floor((longitude + 180) / 6) + 1;
  const zone = Math.max(1, Math.min(60, rawZone));

  // Interface atual suporta explicitamente SIRGAS2000_21S..25S.
  return Math.max(21, Math.min(25, zone));
}

function convertLatLonToAutoUtm(lat, lon) {
  if (typeof proj4 !== 'function') {
    throw new Error('Biblioteca proj4 indisponível para converter latitude/longitude.');
  }

  const zone = detectUtmZoneFromLongitude(lon);
  const projectionKey = `SIRGAS2000_${zone}S`;
  const target = buildProj4FromProjectionKey(projectionKey);
  if (!target) {
    throw new Error(`Não foi possível montar a projeção UTM para ${projectionKey}.`);
  }

  const point = proj4(proj4.WGS84, target, [Number(lon), Number(lat)]);
  const east = Number(point?.[0]);
  const north = Number(point?.[1]);
  if (!Number.isFinite(east) || !Number.isFinite(north)) {
    throw new Error(`Falha ao converter latitude/longitude para ${projectionKey}.`);
  }

  return { east, north, zone, projectionKey };
}

// Calculos para exibicao (distancia/azimute)
function isGeographicCoordinatePair(p) {
  return Number.isFinite(p?.east)
    && Number.isFinite(p?.north)
    && Math.abs(p.east) <= 180
    && Math.abs(p.north) <= 90;
}

function shouldUseGeodesicMath(p1, p2, projectionKey = null) {
  if (projectionKey === "WGS84") return true;
  return isGeographicCoordinatePair(p1) && isGeographicCoordinatePair(p2);
}

function calcularDistancia(p1, p2, options = {}) {
  const projectionKey = options?.projectionKey || null;

  if (shouldUseGeodesicMath(p1, p2, projectionKey)) {
    const R = 6371008.8;
    const lat1 = p1.north * (Math.PI / 180);
    const lat2 = p2.north * (Math.PI / 180);
    const dLat = (p2.north - p1.north) * (Math.PI / 180);
    const dLon = (p2.east - p1.east) * (Math.PI / 180);

    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  return Math.sqrt(Math.pow(p2.east - p1.east, 2) + Math.pow(p2.north - p1.north, 2));
}

function calcularAzimute(p1, p2, options = {}) {
  const projectionKey = options?.projectionKey || null;

  if (shouldUseGeodesicMath(p1, p2, projectionKey)) {
    const lat1 = p1.north * (Math.PI / 180);
    const lat2 = p2.north * (Math.PI / 180);
    const dLon = (p2.east - p1.east) * (Math.PI / 180);

    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2)
      - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    let az = Math.atan2(y, x) * (180 / Math.PI);
    return az < 0 ? az + 360 : az;
  }

  const dE = p2.east - p1.east;
  const dN = p2.north - p1.north;
  let az = Math.atan2(dE, dN) * (180 / Math.PI);
  return az < 0 ? az + 360 : az;
}

// Geodesia e validacao topologica


// Reordena vertices em sequencia CCW usando centroide.
function orderVerticesCCW(vertices) {
  if (vertices.length < 3) return vertices;

  // Centroide
  let centerN = 0, centerE = 0;
  for (const v of vertices) {
    centerN += v.north;
    centerE += v.east;
  }
  centerN /= vertices.length;
  centerE /= vertices.length;

  // Ordenar por angulo polar (CCW a partir do eixo E)
  const ordered = vertices.map(v => {
    const angle = Math.atan2(v.north - centerN, v.east - centerE);
    return { ...v, angle };
  }).sort((a, b) => a.angle - b.angle);

  return ordered;
}

// Valida topologia do poligono (interseccao e orientacao).
function validatePolygonTopology(vertices, projectionKey) {
  if (vertices.length < 3) {
    return {
      isValid: false,
      errors: ["Menos de 3 vértices"],
      warnings: [],
      hasIntersections: false,
      corrected: vertices,
      isCCW: false
    };
  }

  const errors = [];
  const warnings = [];

  // Reordenar se detectar desordem
  let orderedVertices = [...vertices];
  let isDisordered = false;

  // Detectar saltos anormais
  const nValues = vertices.map(v => v.north);
  const eValues = vertices.map(v => v.east);
  const minN = Math.min(...nValues);
  const maxN = Math.max(...nValues);
  const minE = Math.min(...eValues);
  const maxE = Math.max(...eValues);
  const nRange = maxN - minN;
  const eRange = maxE - minE;

  // Saltos > 50% do range sugerem desordem
  const adaptiveNThreshold = Math.max(1000, nRange * 0.5); // Mínimo 1km, ou 50% do range
  const adaptiveEThreshold = Math.max(1000, eRange * 0.5);

  for (let i = 0; i < vertices.length - 1; i++) {
    const nDiff = Math.abs(vertices[i].north - vertices[i + 1].north);
    const eDiff = Math.abs(vertices[i].east - vertices[i + 1].east);

    // Se há salto muito grande (> 50% do range), é desordenado
    if (nDiff > adaptiveNThreshold || eDiff > adaptiveEThreshold) {
      isDisordered = true;
      break;
    }
  }

  if (isDisordered) {
    orderedVertices = orderVerticesCCW(vertices);
    warnings.push("Vertices reordenados em CCW");
  }

  // Duplicados
  const duplicates = [];
  for (let i = 0; i < orderedVertices.length; i++) {
    for (let j = i + 1; j < orderedVertices.length; j++) {
      const dist = Math.hypot(
        orderedVertices[i].north - orderedVertices[j].north,
        orderedVertices[i].east - orderedVertices[j].east
      );
      if (dist < 0.01) { // Tolerância: 1cm
        duplicates.push({ i, j, dist });
      }
    }
  }

  if (duplicates.length > 0) {
    errors.push(`❌ ${duplicates.length} vertice(s) duplicado(s)`);
  }

  // Fechamento
  const first = orderedVertices[0];
  const last = orderedVertices[orderedVertices.length - 1];
  const closureDistance = Math.hypot(
    first.north - last.north,
    first.east - last.east
  );


  if (closureDistance > 1) {
    warnings.push(
      `⚠️ Poligono nao fechado: ${closureDistance.toFixed(1)}m`
    );
  }


  // Auto-interseccao
  let hasIntersections = false;
  const intersectionPairs = [];

  for (let i = 0; i < orderedVertices.length - 1; i++) {
    for (let j = i + 2; j < orderedVertices.length - 1; j++) {
      // Não verificar arestas adjacentes
      if (i === 0 && j === orderedVertices.length - 2) continue;

      const p1 = orderedVertices[i];
      const p2 = orderedVertices[i + 1];
      const p3 = orderedVertices[j];
      const p4 = orderedVertices[j + 1];

      // Cross product test (detecção de intersecção)
      const d1 = (p2.east - p1.east) * (p3.north - p1.north) - (p2.north - p1.north) * (p3.east - p1.east);
      const d2 = (p2.east - p1.east) * (p4.north - p1.north) - (p2.north - p1.north) * (p4.east - p1.east);
      const d3 = (p4.east - p3.east) * (p1.north - p3.north) - (p4.north - p3.north) * (p1.east - p3.east);
      const d4 = (p4.east - p3.east) * (p2.north - p3.north) - (p4.north - p3.north) * (p2.east - p3.east);

      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
        hasIntersections = true;
        intersectionPairs.push({ edge1: i, edge2: j });
      }
    }
  }

  if (hasIntersections) {
    errors.push(`❌ Auto-intersecções detectadas em ${intersectionPairs.length} pares de arestas`);
  }

  // Orientacao CCW
  let signedArea = 0;
  for (let i = 0; i < orderedVertices.length; i++) {
    const curr = orderedVertices[i];
    const next = orderedVertices[(i + 1) % orderedVertices.length];
    signedArea += curr.east * next.north - next.east * curr.north;
  }

  const isCCW = signedArea > 0;
  const area = Math.abs(signedArea) / 2;

  if (!isCCW) {
    warnings.push("⚠️ Ordem CW; convertendo para CCW");
    orderedVertices = [...orderedVertices].reverse();
  }

  // Area fora do esperado
  if (area === 0) {
    errors.push(`❌ Area zero (0 m2)`);
  } else if (area < 1) {
    errors.push(`❌ Area muito pequena (${area.toFixed(2)} m2)`);
  } else if (area > 1e8) {
    errors.push(`❌ Area absurda: ${(area / 1e4).toFixed(1)} ha (${area.toExponential(2)} m2)`);
  } else if (area > 1e7) {
    warnings.push(`⚠️ Area muito grande: ${(area / 1e4).toFixed(1)} ha (${area.toExponential(2)} m2)`);
  }

  // Segmentos longos
  for (let i = 0; i < orderedVertices.length - 1; i++) {
    const v1 = orderedVertices[i];
    const v2 = orderedVertices[i + 1];
    const dist = Math.hypot(v2.north - v1.north, v2.east - v1.east);

    if (dist > 10000) { // Segmentos > 10km são suspeitos
      warnings.push(`⚠️ Segmento ${i}→${i + 1} muito longo: ${(dist / 1000).toFixed(2)}km`);
    }
  }

  return {
    isValid: errors.length === 0 && area > 1,
    errors,
    warnings,
    hasIntersections,
    corrected: orderedVertices,  // Retornar vértices reordenados e corrigidos
    isCCW: true, // Sempre CCW após correção
    area,
    closed: closureDistance < 5,
    duplicates: duplicates.length,
    intersectionPairs
  };
}

// Doc selecionado e CRS
function getSelectedDoc() {
  if (activeDocIndex >= 0 && activeDocIndex < documentsResults.length) return documentsResults[activeDocIndex];
  return null;
}

function getActiveProjectionKey() {
  const doc = getSelectedDoc();
  if (doc) return doc.manualProjectionKey || doc.projectionKey || (projectionSelect?.value) || "SAD69_22S";
  return (projectionSelect?.value) || "SAD69_22S";
}

function showDetectedCrsUI(key, info) {
  if (!crsDetectedBox) return;
  crsDetectedBox.style.display = "block";
  const conf = info?.confidence || "baixa";
  crsDetectedTitle.textContent = `${key || "(não detectado)"} — confiança ${conf}`;
  crsDetectedReason.textContent = info?.reason || "";
  if (projectionSelect && key) {
    const ok = Array.from(projectionSelect.options).some(o => o.value === key);
    if (ok) projectionSelect.value = key;
  }
}

// Reconstrucao de texto por linha
function buildPageTextWithLines(textContent) {
  const items = (textContent.items || [])
    .map(it => ({
      str: it.str || "",
      x: it.transform ? it.transform[4] : 0,
      y: it.transform ? it.transform[5] : 0
    }))
    .sort((a, b) => (b.y - a.y) || (a.x - b.x));

  let out = "";
  let lastY = null;
  const lineThreshold = 2.0;

  for (const it of items) {
    if (!it.str) continue;
    if (lastY === null) lastY = it.y;
    if (Math.abs(it.y - lastY) > lineThreshold) {
      out += "\n";
      lastY = it.y;
    } else {
      out += " ";
    }
    out += it.str;
  }
  return out;
}

// Detecção de CRS.
function inferZoneFromBrazilState(textLower) {
  if (/\b\-pr\b|\bparan[aá]\b/.test(textLower)) return 22;
  if (/\b\-sc\b|\bsanta\s*catarina\b/.test(textLower)) return 22;
  if (/\b\-rs\b|\brio\s*grande\s*do\s*sul\b/.test(textLower)) return 22;
  if (/\b\-sp\b|\bs[aã]o\s*paulo\b/.test(textLower)) return 23;
  if (/\b\-rj\b|\brio\s*de\s*janeiro\b/.test(textLower)) return 23;
  if (/\b\-mg\b|\bminas\s*gerais\b/.test(textLower)) return 23;
  if (/\b\-es\b|\besp[ií]rito\s*santo\b/.test(textLower)) return 24;
  return null;
}

/**
 * Infere o CRS com base na magnitude numérica das coordenadas (Geofencing reverso)
 */
function inferCrsByCoordinates(vertices) {
  if (!vertices || vertices.length === 0) return null;

  // Calcula média das coordenadas extraídas.
  const avgE = vertices.reduce((sum, v) => sum + v.east, 0) / vertices.length;
  const avgN = vertices.reduce((sum, v) => sum + v.north, 0) / vertices.length;

  // Regras heurísticas para UTM no sul do Brasil.
  if (avgN > 7000000 && avgN < 8000000) {
    // Este entre 600k e 800k -> zona 22S.
    if (avgE > 600000 && avgE < 800000) {
      return { zone: 22, reason: "Inferido via coordenadas: Padrão compatível com UTM Zona 22S (Sul do Brasil)." };
    }
    // Este entre 300k e 600k -> zona 23S.
    if (avgE > 300000 && avgE < 600000) {
      return { zone: 23, reason: "Inferido via coordenadas: Padrão compatível com UTM Zona 23S." };
    }
  }
  return null;
}

function isLikelyProjectedCrsKey(key) {
  const k = String(key || '').toUpperCase();
  if (!k) return true;
  if (k.includes('LOCAL_RELATIVE')) return false;
  if (k.includes('WGS84') || k.includes('EPSG:4326')) return false;
  return true;
}

function buildProj4FromProjectionKey(key) {
  const k = String(key || '').toUpperCase();
  const sirgasMatch = k.match(/^SIRGAS2000_(\d{2})S$/);
  if (sirgasMatch) {
    const zone = parseInt(sirgasMatch[1], 10);
    return `+proj=utm +zone=${zone} +south +ellps=GRS80 +units=m +no_defs`;
  }

  const sadMatch = k.match(/^SAD69_(\d{2})S$/);
  if (sadMatch) {
    const zone = parseInt(sadMatch[1], 10);
    return `+proj=utm +zone=${zone} +south +ellps=aust_SA +towgs84=-57,1,-41,0,0,0,0 +units=m +no_defs`;
  }

  return null;
}

function buildProjectionFromPrj(key, prjText = "") {
  const catalogProjection = PROJECTIONS[key];
  if (catalogProjection) return catalogProjection;

  const wkt = String(prjText || "").trim();
  if (!wkt) return null;

  let parsed;
  try {
    parsed = typeof proj4 === "function" ? proj4(wkt) : null;
  } catch {
    parsed = null;
  }
  if (!parsed) return null;

  const nameMatch = wkt.match(/^(?:PROJCS|PROJCRS|GEOGCS|GEODCRS)\s*\[\s*["']([^"']+)/i);
  const epsgMatch = wkt.match(/(?:AUTHORITY|ID)\s*\[\s*["']EPSG["']\s*,\s*["'](\d+)["']/i);
  return {
    name: nameMatch?.[1] || "CRS definido pelo arquivo .prj",
    epsg: epsgMatch ? `EPSG:${epsgMatch[1]}` : "PRJ",
    wkt
  };
}

function maybeReprojectGeographicVertices(vertices = [], projectionKey = null) {
  const list = Array.isArray(vertices) ? vertices : [];
  if (!list.length || !isLikelyProjectedCrsKey(projectionKey)) {
    return { vertices: list, transformed: false, reason: 'projection-not-projected-or-empty' };
  }

  const geographicCount = list.filter((v) => isGeographicCoordinatePair(v)).length;
  const shouldTransform = geographicCount >= Math.max(3, Math.floor(list.length * 0.8));
  if (!shouldTransform) {
    return {
      vertices: list,
      transformed: false,
      reason: `geographic-ratio-low:${geographicCount}/${list.length}`
    };
  }

  if (typeof proj4 !== 'function') {
    return { vertices: list, transformed: false, reason: 'proj4-unavailable' };
  }

  const projTarget = buildProj4FromProjectionKey(projectionKey) || shpProjectionWkt;
  if (!projTarget) {
    return { vertices: list, transformed: false, reason: `unsupported-projection-key:${projectionKey}` };
  }

  const transformed = list.map((v) => {

    const xy = proj4(proj4.WGS84, projTarget, [
      Number(v.east),
      Number(v.north)
    ]);

    return {
      ...v,
      id: (v.id && v.id.trim()) || "SEM_ID", // mantém ID original do documento
      east: Number(xy[0]),
      north: Number(xy[1])
    };

  });

  return {
    vertices: transformed,
    transformed: true,
    reason: `reprojected-from-wgs84-to-${projectionKey}`
  };
}

function validateUtmCoordinateScale(vertices) {
  const minEast = 100000;
  const maxEast = 900000;
  const minNorth = 1000000;
  const maxNorth = 10000000;

  let plausible = 0;
  for (const vertex of vertices) {
    const e = Number(vertex.east);
    const n = Number(vertex.north);
    if (e >= minEast && e <= maxEast && n >= minNorth && n <= maxNorth) {
      plausible += 1;
    }
  }

  const ratio = vertices.length ? (plausible / vertices.length) : 0;
  return {
    plausible,
    ratio,
    ok: plausible >= 3 && ratio >= 0.8
  };
}

function validateUtmGeometryConsistency(vertices = []) {
  const list = Array.isArray(vertices) ? vertices : [];
  if (list.length < 3) {
    return { ok: false, reason: 'Menos de 3 vértices válidos.' };
  }

  const east = list.map((v) => Number(v?.east)).filter(Number.isFinite);
  const north = list.map((v) => Number(v?.north)).filter(Number.isFinite);
  if (east.length < 3 || north.length < 3) {
    return { ok: false, reason: 'Vértices com valores não numéricos.' };
  }

  const spanEast = Math.max(...east) - Math.min(...east);
  const spanNorth = Math.max(...north) - Math.min(...north);

  const countRepeats = (arr) => {
    const map = new Map();
    for (const v of arr) {
      const key = Number(v).toFixed(3);
      map.set(key, (map.get(key) || 0) + 1);
    }
    let repeats = 0;
    for (const n of map.values()) {
      if (n > 1) repeats += (n - 1);
    }
    return repeats;
  };

  const repeatRatioEast = countRepeats(east) / Math.max(1, east.length);
  const repeatRatioNorth = countRepeats(north) / Math.max(1, north.length);

  const distances = [];
  for (let i = 0; i + 1 < list.length; i++) {
    const a = list[i];
    const b = list[i + 1];
    const d = Math.hypot(Number(b.east) - Number(a.east), Number(b.north) - Number(a.north));
    if (Number.isFinite(d)) distances.push(d);
  }

  if (distances.length === 0) {
    return { ok: false, reason: 'Não foi possível calcular distâncias entre vértices.' };
  }

  const sorted = [...distances].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  const maxDist = sorted[sorted.length - 1] || 0;
  const p90 = sorted[Math.floor(sorted.length * 0.9)] || maxDist;

  // Regras conservadoras para detectar polígono claramente corrompido.
  if (spanEast > 400000 || spanNorth > 400000) {
    return {
      ok: false,
      reason: `Amplitude excessiva (E=${Math.round(spanEast)}m, N=${Math.round(spanNorth)}m).`
    };
  }

  if (maxDist > 200000) {
    return {
      ok: false,
      reason: `Segmento máximo incoerente (${Math.round(maxDist)}m).`
    };
  }

  if (median > 0 && (maxDist / median) > 80 && p90 > 25000) {
    return {
      ok: false,
      reason: 'Distribuição de segmentos inconsistente (saltos extremos).'
    };
  }

  if (repeatRatioEast > 0.28 || repeatRatioNorth > 0.28) {
    return {
      ok: false,
      reason: 'Repetição anormal de coordenadas (OCR capturando números não geográficos).'
    };
  }

  return {
    ok: true,
    reason: 'Consistência geométrica plausível.',
    stats: {
      spanEast,
      spanNorth,
      medianDist: median,
      maxDist,
      repeatRatioEast,
      repeatRatioNorth
    }
  };
}

function detectProjectionFromText(fullText, vertices = []) {
  const t = (fullText || "").toLowerCase();
  const hasSAD = /sad[\s\-]?69/.test(t);
  const hasSIRGAS = /sirgas\s*2000/.test(t);
  const hasWGS = /wgs\s*84/.test(t);

  const zoneMatch =
    t.match(/(?:fuso|zona|zone)\s*[:=]?\s*(\d{2})\s*([ns])?/i) ||
    t.match(/utm\s*[:=]?\s*(\d{2})\s*([ns])?/i);

  const mcMatch = t.match(/(?:mc|meridiano\s+central)\s*[:=]?\s*(\d{2})\s*°?\s*([wo])/i);

  let zone = null;
  const reasonParts = [];
  let conf = "baixa";

  if (zoneMatch && zoneMatch[1]) {
    zone = parseInt(zoneMatch[1], 10);
    reasonParts.push(`Encontrado fuso/zona ${zone} no memorial.`);
    conf = "alta";
  }

  if (!zone && mcMatch && mcMatch[1]) {
    const mc = parseInt(mcMatch[1], 10);
    const map = { 57: 21, 51: 22, 45: 23, 39: 24 };
    zone = map[mc] || null;
    if (zone) {
      reasonParts.push(`Encontrado MC ${mc}°W → zona ${zone}.`);
      conf = "alta";
    }
  }

  // Fallback 1: inferência por estado/UF.
  if (!zone) {
    const inferred = inferZoneFromBrazilState(t);
    if (inferred) {
      zone = inferred;
      reasonParts.push(`Zona inferida como ${zone}S pela localidade.`);
      conf = "média";
    }
  }

  // Fallback 2: inferência por padrão numérico das coordenadas.
  if (!zone && vertices && vertices.length > 0) {
    const mathInference = inferCrsByCoordinates(vertices);
    if (mathInference) {
      zone = mathInference.zone;
      reasonParts.push(mathInference.reason);
      conf = "média";
    }
  }

  // Fallback 3: valor padrão.
  if (!zone) {
    zone = 22;
    reasonParts.push(`Zona não encontrada; fallback ${zone}S.`);
  }

  // Resolve datum/projeção final.
  if (hasWGS) return { key: "WGS84", confidence: "alta", reason: "Encontrado 'WGS 84'." };

  if (hasSAD) {
    let key = (zone === 23) ? "SAD69_23S" : "SAD69_22S";
    return { key, confidence: conf, reason: `Encontrado 'SAD-69'. ${reasonParts.join(" ")}` };
  }

  // Se não houver SAD/WGS explícito, assume SIRGAS 2000.
  return {
    key: `SIRGAS2000_${zone}S`,
    confidence: conf,
    reason: (hasSIRGAS ? "Encontrado 'SIRGAS 2000'. " : "Datum assumido SIRGAS 2000. ") + reasonParts.join(" ")
  };
}

function detectProjectionFromAI(iaObj, inferredByCoords = null, projInfo = null) {
  if (!iaObj || typeof iaObj !== "object") return null;

  const rawParts = [
    iaObj.datum,
    iaObj.crs,
    iaObj.epsg,
    iaObj.srid,
    iaObj.projecao,
    iaObj.projection,
    iaObj.sistema,
    iaObj.spatial_reference,
    iaObj.spatialReference,
    iaObj.utm_zone,
    iaObj.utmZone,
    iaObj.zone,
    iaObj.zona,
    iaObj.fuso,
    iaObj.fuso_utm
  ].filter(Boolean);

  const raw = rawParts.join(" ");
  const lower = String(raw || "").toLowerCase();

  let epsgCode = null;
  if (typeof iaObj.epsg === "number" || typeof iaObj.epsg === "string") {
    epsgCode = String(iaObj.epsg).match(/\d{4,6}/)?.[0] || null;
  }
  if (!epsgCode) {
    epsgCode = raw.match(/epsg\s*[:=]?\s*(\d{4,6})/i)?.[1] || null;
  }

  if (epsgCode) {
    const key = Object.keys(PROJECTIONS).find(k => {
      const epsg = PROJECTIONS[k]?.epsg || "";
      return epsg.includes(epsgCode);
    });
    if (key) {
      return { key, confidence: "alta", reason: `EPSG ${epsgCode} informado pela IA.` };
    }
  }

  if (/(wgs\s*84|wgs84|wgs)/i.test(lower)) {
    return { key: "WGS84", confidence: "média", reason: "IA informou WGS84." };
  }

  const hasSad = /sad[\s\-]?69/.test(lower);
  const hasSirgas = /sirgas/.test(lower);
  let base = null;
  if (hasSad) base = "SAD69";
  if (hasSirgas) base = "SIRGAS2000";
  if (!base) return null;

  let zone = null;
  const zoneFields = [iaObj.zone, iaObj.zona, iaObj.fuso, iaObj.utm_zone, iaObj.utmZone, iaObj.fuso_utm].filter(Boolean);
  if (zoneFields.length) {
    const z = parseInt(String(zoneFields[0]).match(/\d{1,2}/)?.[0], 10);
    if (!Number.isNaN(z)) zone = z;
  }
  if (!zone) {
    const rawZone = raw.match(/(?:zona|zone|fuso|utm)\s*[:=]?\s*(\d{1,2})/i);
    if (rawZone?.[1]) zone = parseInt(rawZone[1], 10);
  }
  if (!zone && projInfo?.key) {
    const match = projInfo.key.match(/_(\d{2})S/);
    if (match?.[1]) zone = parseInt(match[1], 10);
  }
  if (!zone && inferredByCoords?.zone) zone = inferredByCoords.zone;
  if (!zone) zone = 22;

  const key = base === "SAD69"
    ? (zone === 23 ? "SAD69_23S" : "SAD69_22S")
    : `SIRGAS2000_${zone}S`;

  return {
    key,
    confidence: zone ? "média" : "baixa",
    reason: `IA informou datum ${base}${zone ? " e zona " + zone : ""}.`
  };
}

function resolveProjectionKeyForOutput(iaObj, projInfo, inferredByCoords) {
  const reasons = [];
  let key = null;
  let confidence = "baixa";

  const aiDetected = detectProjectionFromAI(iaObj, inferredByCoords, projInfo);
  if (aiDetected?.key) {
    key = aiDetected.key;
    confidence = aiDetected.confidence || confidence;
    if (aiDetected.reason) reasons.push(aiDetected.reason);
  }

  if (projInfo?.key) {
    if (!key) {
      key = projInfo.key;
      confidence = projInfo.confidence || confidence;
      if (projInfo.reason) reasons.push(`Texto: ${projInfo.reason}`);
    } else if (projInfo.key !== key && projInfo.confidence === "alta") {
      reasons.push(`Conflito IA vs texto; prevaleceu o CRS do texto (${projInfo.key}).`);
      key = projInfo.key;
      confidence = "alta";
    } else if (projInfo.key === key && projInfo.reason) {
      reasons.push(`Texto confirmou CRS: ${projInfo.reason}`);
    }
  }

  if (!key && inferredByCoords?.zone) {
    key = `SIRGAS2000_${inferredByCoords.zone}S`;
    confidence = "média";
    reasons.push(inferredByCoords.reason);
  }

  if (!key) {
    key = getActiveProjectionKey() || "SIRGAS2000_22S";
    reasons.push("CRS não identificado; usando seleção atual/padrão.");
  }

  return { key, info: { confidence, reason: reasons.join(" ") } };
}

// CSV com metadados
function gerarCsvParaVertices(vertices, epsg, docId = null, topologyInfo = null, memorialInfo = null, relativeInfo = null) {
  let csv = "\ufeffsep=;\n";
  const memorialMatches = Array.isArray(memorialInfo?.matches) ? memorialInfo.matches : [];

  // Cabeçalho profissional com metadados
  csv += `# MATRÍCULA;${docId || "N/A"}\n`;
  csv += `# EPSG;${epsg}\n`;
  if (relativeInfo?.relative) {
    csv += `# CRS_RELATIVO;SIM\n`;
    if (relativeInfo.start) {
      csv += `# ORIGEM_RELATIVA;${relativeInfo.start.east},${relativeInfo.start.north}\n`;
    }
  }
  if (topologyInfo) {
    csv += `# TOPOLOGY_VALID;${topologyInfo.isValid ? "SIM" : "NÃO"}\n`;
    csv += `# AREA_M2;${topologyInfo.area.toFixed(2)}\n`;
    csv += `# POLYGON_CLOSED;${topologyInfo.closed ? "SIM" : "NÃO"}\n`;
  }
  if (memorialMatches.length > 0) {
    const coherentMatches = memorialMatches.filter(m => m?.coherent).length;
    csv += `# MEMORIAL_COHERENCE;${coherentMatches}/${memorialMatches.length}\n`;
  }
  csv += `#\n`;

  // Cabeçalho da tabela
  csv += "Point_ID;Ordem;Norte_Y;Este_X;EPSG;Dist_M;Azimute_Deg;Qualidade;Notas\n";

  const verticesToExport = [...vertices];

  for (let i = 0; i < verticesToExport.length; i++) {
    const c = verticesToExport[i];
    // Determinação de qualidade baseada em validação
    let quality = "✓ OK";
    let notes = "";
    // Verificar coerência com memorial se disponível
    if (memorialMatches[i]) {
      const match = memorialMatches[i];
      if (!match.coherent) {
        quality = "⚠ AVISO";
        notes = `Az ${match.azDiff.toFixed(1)}° diff`;
        if (match.distDiff !== null && match.distDiff > 2) {
          notes += `; Dist ${match.distDiff.toFixed(1)}m diff`;
        }
      }
    }
    // Verificar se há distância "---" (último vértice ou fechamento)
    if (c.distCalc === "---") {
      notes = "Fechamento";
    }
    // Verificar duplicatas ou problemas topológicos
    if (i > 0) {
      const prev = verticesToExport[i - 1];
      if (prev.east === c.east && prev.north === c.north) {
        quality = "❌ ERRO";
        notes = "Duplicado";
      }
    }
    csv += `${c.id};${c.ordem};${c.north};${c.east};${epsg};${c.distCalc || ""};${c.azCalc || ""};${quality};${notes}\n`;
  }

  return csv;
}

// Relatorio de validacao
function gerarRelatorioValidacao(docId, pages, topologyInfo, memorialInfo, warnings, assistiveAnalysis = null) {
  let report = `RELATÓRIO DE VALIDAÇÃO - Matrícula ${docId}\n`;
  report += `Data: ${new Date().toLocaleString("pt-BR")}\n`;
  let safePages = Array.isArray(pages) ? pages.join(", ") : (typeof pages === 'string' ? pages : "(desconhecido)");
  report += `Páginas: ${safePages}\n`;
  report += `${"=".repeat(60)}\n\n`;

  const memorialMatches = Array.isArray(memorialInfo?.matches) ? memorialInfo.matches : [];
  const memorialIssues = Array.isArray(memorialInfo?.issues) ? memorialInfo.issues : [];
  const safeWarnings = Array.isArray(warnings) ? warnings : [];

  if (assistiveAnalysis) {
    report += `ANÁLISE ASSISTIVA DO MEMORIAL:\n`;
    report += `  Tipo identificado: ${assistiveAnalysis.documentType || "não informado"}\n`;
    report += `  Prioridade da fonte: ${assistiveAnalysis.sourcePriority || "não informado"}\n`;
    report += `  Datum: ${assistiveAnalysis.datum || "não informado"}\n`;
    report += `  Zona UTM: ${assistiveAnalysis.utmZone || "não informada"}${assistiveAnalysis.hemisphere ? `/${assistiveAnalysis.hemisphere}` : ""}\n`;
    report += `  EPSG: ${assistiveAnalysis.epsg || "não informado"}\n`;
    if (assistiveAnalysis.confidence !== null && assistiveAnalysis.confidence !== undefined) {
      report += `  Confiança da IA: ${(Number(assistiveAnalysis.confidence) * 100).toFixed(0)}%\n`;
    }
    const auditLines = [
      ...(Array.isArray(assistiveAnalysis.corrections) ? assistiveAnalysis.corrections.map((item) => `Correção: ${item}`) : []),
      ...(Array.isArray(assistiveAnalysis.missingData) ? assistiveAnalysis.missingData.map((item) => `Dado ausente: ${item}`) : []),
      ...(Array.isArray(assistiveAnalysis.notes) ? assistiveAnalysis.notes : [])
    ];
    auditLines.forEach((item) => { report += `  • ${item}\n`; });
    report += `\n`;
  }

  if (topologyInfo) {
    const intersections = Array.isArray(topologyInfo.intersectionPairs)
      ? topologyInfo.intersectionPairs
      : (Array.isArray(topologyInfo.intersections) ? topologyInfo.intersections : []);
    const topoErrors = Array.isArray(topologyInfo.errors) ? topologyInfo.errors : [];
    const topoWarnings = Array.isArray(topologyInfo.warnings) ? topologyInfo.warnings : [];
    const safeArea = Number.isFinite(topologyInfo.area) ? topologyInfo.area : 0;

    report += `VALIDAÇÃO TOPOLÓGICA:\n`;
    report += `  Polígono válido: ${topologyInfo.isValid ? "✓ SIM" : "✗ NÃO"}\n`;
    report += `  Área: ${safeArea.toFixed(2)} m²\n`;
    report += `  Fechado: ${topologyInfo.closed ? "✓ SIM" : "✗ NÃO"}\n`;
    report += `  Auto-intersecções: ${intersections.length > 0 ? `✗ ${intersections.length} encontradas` : "✓ Nenhuma"}\n`;
    report += `  Sentido: ${topologyInfo.isCCW ? "Anti-horário (CCW)" : "Horário (CW)"}\n\n`;

    if (topoErrors.length > 0) {
      report += `  ERROS DETECTADOS:\n`;
      topoErrors.forEach(e => report += `    • ${e}\n`);
      report += `\n`;
    }

    if (topoWarnings.length > 0) {
      report += `  AVISOS:\n`;
      topoWarnings.forEach(w => report += `    • ${w}\n`);
      report += `\n`;
    }
  }

  if (memorialMatches.length > 0) {
    report += `VALIDAÇÃO COM MEMORIAL (Azimutes/Distâncias):\n`;
    const coherent = memorialMatches.filter(m => m?.coherent).length;
    report += `  Correspondência: ${coherent}/${memorialMatches.length} edges coerentes\n`;
    report += `  Confiança: ${Math.round(coherent / memorialMatches.length * 100)}%\n\n`;

    if (memorialIssues.length > 0) {
      report += `  DISCREPÂNCIAS ENCONTRADAS:\n`;
      memorialIssues.forEach(issue => report += `    • ${issue}\n`);
      report += `\n`;
    }
  }

  if (safeWarnings.length > 0) {
    report += `AVISOS GERAIS:\n`;
    safeWarnings.forEach(w => report += `  • ${w}\n`);
  }

  return report;
}

function formatAnalyzedPagesLabel(apiResult, totalPagesHint = 0) {
  const pageNumbers = Array.isArray(apiResult?.pageNumbers)
    ? apiResult.pageNumbers
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value >= 1)
    : [];

  if (pageNumbers.length > 0) {
    const unique = [...new Set(pageNumbers)].sort((a, b) => a - b);
    const ranges = [];
    let start = unique[0];
    let prev = unique[0];

    for (let i = 1; i < unique.length; i += 1) {
      const current = unique[i];
      if (current === prev + 1) {
        prev = current;
        continue;
      }
      ranges.push(start === prev ? String(start) : `${start}-${prev}`);
      start = current;
      prev = current;
    }

    ranges.push(start === prev ? String(start) : `${start}-${prev}`);
    return ranges.join(', ');
  }

  const hintedPages = Number.isFinite(Number(totalPagesHint)) ? Number(totalPagesHint) : 0;
  if (hintedPages > 1) return `1-${hintedPages}`;
  if (hintedPages === 1) return '1';
  return '(desconhecido)';
}

// UI: seletor de documento
function renderDocSelector() {
  if (!docSelectorBox || !docSelect) return;

  if (!documentsResults.length) {
    docSelectorBox.style.display = "none";
    return;
  }

  docSelectorBox.style.display = "block";
  docSelect.innerHTML = "";

  documentsResults.forEach((d, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `MAT ${d.docId} — ${(d.vertices || []).length} vértices`;
    docSelect.appendChild(opt);
  });

  if (activeDocIndex < 0) activeDocIndex = 0;
  docSelect.value = String(activeDocIndex);
  updateActiveDocUI();
}

function updateActiveDocUI() {
  const doc = getSelectedDoc();
  if (!doc) return;

  const projKey = doc.manualProjectionKey || doc.projectionKey || "(não detectado)";
  const epsg = PROJECTIONS[projKey]?.epsg || "";
  // Suportar tanto array de páginas (v2.0) quanto string (v3.0)
  const pages = Array.isArray(doc.pages)
    ? doc.pages.join(", ")
    : (typeof doc.pages === 'string' ? doc.pages : "(desconhecido)");
  const warns = (doc.warnings || []).length;
  const confidence = String(doc.extractionConfidence || 'n/a').toUpperCase();

  if (docMeta) docMeta.textContent = `Páginas: ${pages}\nCRS: ${projKey}${epsg ? " (" + epsg + ")" : ""}\nConfiança: ${confidence}\nAlertas: ${warns}`;

  showDetectedCrsUI(doc.manualProjectionKey || doc.projectionKey || null, doc.projectionInfo);

  if (advancedCrs) advancedCrs.style.display = (doc.manualProjectionKey || doc.projectionKey) ? "none" : "block";

  extractedCoordinates = doc.vertices || [];
  fileNameBase = `MAT_${doc.docId}`;
  displayResults();
}

if (docSelect) {
  docSelect.addEventListener("change", () => {
    activeDocIndex = parseInt(docSelect.value, 10);
    updateActiveDocUI();
  });
}

// UI: tabela de vertices
function displayResults() {
  resultBox.style.display = "block";
  countDisplay.innerText = extractedCoordinates.length;
  renderCoordinatePreviewRows(extractedCoordinates);
  scrollToResults();
}

function renderCoordinatePreviewRows(rows = []) {
  if (!previewTableBody) return;
  previewTableBody.replaceChildren();

  rows.forEach((row) => {
    const tr = document.createElement('tr');
    [
      row?.ordem,
      row?.id,
      row?.north,
      row?.east,
      row?.distCalc,
      row?.azCalc
    ].forEach((value) => {
      const td = document.createElement('td');
      td.textContent = String(value ?? '');
      tr.appendChild(td);
    });
    previewTableBody.appendChild(tr);
  });
}


async function applyExtractionGeoJsonResult(apiResult, sourceFileName, extractedText, totalPagesHint = 0) {
  console.log('APPLY RECEBEU extractedText:', typeof extractedText, extractedText?.length);
  // fallback total quando não há GeoJSON
  if (!apiResult || !apiResult.geojson) {

    let vertices = buildVerticesTableData(extractedText);

    if (!vertices || vertices.length < 3) {
      throw new Error("Não foi possível extrair vértices válidos do OCR.");
    }

    // já retorna direto sem passar pelo GeoJSON
    extractedCoordinates = prepararVerticesComMedidas(vertices, getActiveProjectionKey());
    drawPolygonPreview(extractedCoordinates);
    displayResults();

    updateStatus(`✅ Extração concluída via OCR local (${vertices.length} pontos).`, 'success');

    return;
  }
  const geojson = apiResult?.geojson;

  const ring = geojson?.features?.[0]?.geometry?.coordinates?.[0];

  if (!geojson) {
    throw new Error('O serviço de extração não retornou GeoJSON.');
  }

  const nameBase = (sourceFileName || 'coordenadas_extracao').replace(/\.[^/.]+$/, '');
  const projectionFromApi = String(apiResult?.projectionKey || '').trim();
  let projKey = projectionFromApi || getActiveProjectionKey() || 'SIRGAS2000_22S';
  const extractionConfidence = String(apiResult?.extractionConfidence || 'medium').toLowerCase();

  let baseText =
    (window._OCR_FULL_TEXT && window._OCR_FULL_TEXT.length > 1000)
      ? window._OCR_FULL_TEXT
      : extractedText;

  let vertices = buildVerticesTableData(baseText);

  // fallback
  if (!vertices || vertices.length === 0) {
    console.warn('Parser falhou, tentando fallback...');

    vertices = buildVerticesTableData(extractedText);
  }

  if (typeof extractedText === 'string' && extractedText.length > 0) {
    const verticesFinal = buildVerticesTableData(extractedText);

    verticesFinal.forEach((v, i) => {
      console.log(
        i,
        v.id,
        v.north,
        v.east
      );
    });

    if (verticesFinal.length > vertices.length) {
      console.log(
        "USANDO VERTICES DO EXTRACTEDTEXT:",
        verticesFinal.length
      );

      vertices = verticesFinal;
    }
  }

  // O GeoJSON do backend e a fonte geometrica autoritativa. O OCR pode conter
  // DMS, acentos ou ruido suficiente para o parser de tabela retornar zero,
  // mesmo quando o anel ja foi validado pelo extrator local.
  const geojsonVertices = Array.isArray(ring)
    ? ring
        .slice(0, -1)
        .map((point, index) => ({
          id: `V${String(index + 1).padStart(2, '0')}`,
          east: Number(point?.[0]),
          north: Number(point?.[1])
        }))
        .filter((vertex) => Number.isFinite(vertex.east) && Number.isFinite(vertex.north))
    : [];

  if (geojsonVertices.length >= 3 && geojsonVertices.length > vertices.length) {
    console.log('USANDO VERTICES DO GEOJSON:', geojsonVertices.length);
    vertices = geojsonVertices;
  }

  vertices = vertices
    .map((vertex, idx) => ({
      id: vertex.id || "SEM_ID",
      east: Number(vertex.east),
      north: Number(vertex.north)
    }))
    .filter(v =>
      Number.isFinite(v.east) &&
      Number.isFinite(v.north)
    );

  // remove duplicado de fechamento (se existir)
  if (vertices.length > 1) {
    const first = vertices[0];
    const last = vertices[vertices.length - 1];

    if (first.east === last.east && first.north === last.north) {
      vertices.pop();
    }
  }


  //console.log("DEPOIS DO FILTER:");

  vertices.forEach((v, i) => {
    console.log(
      i,
      v.id,
      v.north,
      v.east
    );
  });


  // proteção final (ESSENCIAL)
  if (!vertices || vertices.length < 3) {
    throw new Error("Não foi possível obter vértices válidos.");
  }

  if (isLocalRelativeApiResult(apiResult)) {
    const storedOrigin = readStoredLocalRelativeOrigin();
    logPdfDiag('local-relative-user-origin-requested', {
      msg: 'Documento em modo local relativo: solicitando origem manual em lat/lon.',
      projectionKey: projKey,
      hasStoredOrigin: Boolean(storedOrigin),
      storedOrigin: storedOrigin
        ? {
          lat: Number(storedOrigin.lat.toFixed(6)),
          lon: Number(storedOrigin.lon.toFixed(6))
        }
        : null,
      beforeShiftSummary: summarizeVerticesForDiag(vertices)
    });
    const userLatLon = await askLocalRelativeOriginLatLon(storedOrigin);

    if (userLatLon) {
      const firstBefore = vertices[0]
        ? {
          east: Number(Number(vertices[0].east).toFixed(6)),
          north: Number(Number(vertices[0].north).toFixed(6))
        }
        : null;
      const utmOrigin = convertLatLonToAutoUtm(userLatLon.lat, userLatLon.lon);
      vertices = shiftVerticesToNewOrigin(vertices, utmOrigin);
      projKey = utmOrigin.projectionKey || 'SIRGAS2000_22S';
      persistLocalRelativeOrigin(userLatLon.lat, userLatLon.lon);
      const firstAfter = vertices[0]
        ? {
          east: Number(Number(vertices[0].east).toFixed(6)),
          north: Number(Number(vertices[0].north).toFixed(6))
        }
        : null;

      const existingWarnings = Array.isArray(apiResult.warnings) ? apiResult.warnings : [];
      apiResult.warnings = [
        ...existingWarnings,
        `Origem definida pelo usuário em lat/lon (${userLatLon.lat.toFixed(6)}, ${userLatLon.lon.toFixed(6)}) e convertida para ${projKey}.`
      ];

      logPdfDiag('local-relative-user-origin-applied', {
        msg: 'Origem manual aplicada ao memorial local relativo e convertida para UTM detectada automaticamente.',
        lat: Number(userLatLon.lat.toFixed(6)),
        lon: Number(userLatLon.lon.toFixed(6)),
        projectionKey: projKey,
        utmZone: utmOrigin.zone,
        utmOrigin: {
          east: Number(utmOrigin.east.toFixed(3)),
          north: Number(utmOrigin.north.toFixed(3))
        },
        firstVertexBefore: firstBefore,
        firstVertexAfter: firstAfter,
        shiftDelta: firstBefore && firstAfter
          ? {
            east: Number((firstAfter.east - firstBefore.east).toFixed(6)),
            north: Number((firstAfter.north - firstBefore.north).toFixed(6))
          }
          : null,
        afterShiftSummary: summarizeVerticesForDiag(vertices)
      });
    } else {
      logPdfDiag('local-relative-user-origin-skipped', {
        msg: 'Usuário manteve origem automática para geometria sem referência absoluta.',
        projectionKey: projKey,
        summary: summarizeVerticesForDiag(vertices)
      });
    }
  }

  logPdfDiag('geojson-raw-vertices', {
    msg: `GeoJSON bruto recebido com ${vertices.length} vértices válidos antes do pós-processamento.`,
    summary: summarizeVerticesForDiag(vertices)
  });

  if (isLikelyProjectedCrsKey(projKey)) {
    const reprojection = maybeReprojectGeographicVertices(vertices, projKey);
    if (reprojection.transformed) {
      vertices = reprojection.vertices;
      logPdfDiag('geojson-reprojected-to-utm', {
        msg: `Coordenadas geográficas detectadas e reprojetadas para ${projKey} antes da validação UTM.`,
        projectionKey: projKey,
        reason: reprojection.reason,
        summary: summarizeVerticesForDiag(vertices),
        duplicates: summarizeDuplicateVertices(vertices)
      });
    } else {
      logPdfDiag('geojson-reprojection-skipped', {
        msg: 'Reprojeção automática não aplicada antes da validação UTM.',
        projectionKey: projKey,
        reason: reprojection.reason
      });
    }
  }

  if (isLikelyProjectedCrsKey(projKey)) {
    const scaleCheck = validateUtmCoordinateScale(vertices);
    if (!scaleCheck.ok) {
      throw new Error('Coordenadas extraídas com escala incompatível para UTM. A extração OCR provavelmente capturou números inválidos (ordem/distância/IDs).');
    }

    const geometryConsistency = validateUtmGeometryConsistency(vertices);
    logPdfDiag('geojson-consistency', {
      msg: geometryConsistency.ok
        ? 'Consistência geométrica aprovada para UTM.'
        : `Consistência geométrica reprovada: ${geometryConsistency.reason}`,
      extractionConfidence,
      consistency: geometryConsistency
    });

    // Em baixa confiança, não aceitar geometrias claramente corrompidas.
    if (extractionConfidence === 'low' && !geometryConsistency.ok) {
      throw new Error(`Extração em baixa confiança rejeitada por inconsistência geométrica: ${geometryConsistency.reason}`);
    }
  }

  vertices = prepararVerticesComMedidas(vertices, projKey);

  logPdfDiag('geojson-final-vertices', {
    msg: `Vértices finais preparados para tela/exportação: ${vertices.length}.`,
    projectionKey: projKey,
    summary: summarizeVerticesForDiag(vertices),
    duplicates: summarizeDuplicateVertices(vertices)
  });

  const topology = null;
  if (
    topology &&
    Array.isArray(topology.corrected)
  ) {
    topology.corrected.forEach((v, i) => {
      console.log(
        i,
        v.id,
        v.east,
        v.north
      );
    });
  }

  const warnings = Array.isArray(apiResult?.warnings) ? apiResult.warnings : [];
  if (extractionConfidence === 'low') {
    warnings.push('Confiança baixa na extração automática. Revise os vértices antes de exportar.');
  }
  const projectionInfo = {
    confidence: projectionFromApi ? 'alta' : 'baixa',
    reason: projectionFromApi
      ? 'CRS informado pelo mecanismo de extração no retorno do GeoJSON.'
      : 'CRS não informado pela IA; aplicado CRS ativo da interface.'
  };
  const pagesLabel = formatAnalyzedPagesLabel(apiResult, totalPagesHint || apiResult?.pagesRequestedHint || 0);

  documentsResults = [{
    docId: apiResult?.matricula || nameBase.toUpperCase(),
    pages: pagesLabel,
    projectionKey: projKey,
    manualProjectionKey: null,
    projectionInfo,
    vertices,
    warnings,
    extractionConfidence,
    topology,
    memorialValidation: { matches: [], issues: [] },
    memorialData: { azimutes: [], distances: [] },
    assistiveAnalysis: apiResult?.assistiveAnalysis || null,
    relativeInfo: null,
    text: ''
  }];

  activeDocIndex = 0;
  window._arcgis_crs_key = projKey;
  extractedCoordinates = vertices;
  fileNameBase = apiResult?.matricula ? `MAT_${apiResult.matricula}` : nameBase;
  drawPolygonPreview(extractedCoordinates);

  showDetectedCrsUI(projKey, projectionInfo);
  if (ENABLE_TOPOLOGY_VALIDATION && topology) {
    updateValidationUI(topology);
  } else {
    hideValidationUI();
  }
  displayResults();
  renderDocSelector();

  if (extractionConfidence === 'low') {
    updateStatus(`⚠️ Processamento concluído. Revise os ${vertices.length} pontos antes de exportar.`, 'warning');
    if (typeof displayLogMessage === 'function') {
      displayLogMessage('[PDFtoArcgis] Sugestão: confirme o início/fim do polígono e compare com o memorial descritivo.');
    }
  } else {
    updateStatus(`✅ Tudo pronto. Encontramos ${vertices.length} pontos para revisão e exportação.`, 'success');
  }
  stopProgressHintRotation();
  progressContainer.style.display = 'none';
}

// Processamento do PDF
fileInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  beginPdfDiagRun(file.name);

  // Reset de UI e estado
  fileNameBase = file.name.replace(/\.[^/.]+$/, "");
  pdfOrigemNomeBase = file.name.replace(/\.[^/.]+$/, "");
  pdfOrigemSrc = file.name;
  document.getElementById("fileNameDisplay").innerText = file.name;
  progressContainer.style.display = "block";
  startProgressHintRotation();
  resultBox.style.display = "none";
  const polygonPreviewCard = document.getElementById("polygonPreviewCard");
  if (polygonPreviewCard) polygonPreviewCard.style.display = "none";
  statusDiv.style.display = "none";
  if (docSelectorBox) docSelectorBox.style.display = "none";
  if (crsDetectedBox) crsDetectedBox.style.display = "none";
  if (crsDetectedTitle) crsDetectedTitle.textContent = "—";
  if (crsDetectedReason) crsDetectedReason.textContent = "";
  hideValidationUI();
  extractedCoordinates = [];
  previewTableBody.innerHTML = "";
  documentsResults = [];
  activeDocIndex = -1;

  try {
    updateStatus('📄 Arquivo recebido. Preparando tudo por aqui...', 'info');
    setProgressExperience('Preparando o documento...', 8);
    logPdfDiag('start', {
      msg: `Arquivo recebido: ${file.name}`,
      fileName: file.name,
      fileSizeBytes: file.size
    });

    const arrayBuffer = await file.arrayBuffer();
    const totalPagesHint = await inferPdfPageCount(arrayBuffer);
    const processingMode = getSelectedProcessingMode();
    const ocrPlan = buildOcrPlan(totalPagesHint || 1, processingMode);
    updateStatus('📚 Documento carregado. Iniciando a leitura...', 'info');
    logPdfDiag('pdf-loaded', {
      msg: `PDF carregado (${totalPagesHint || 0} páginas inferidas).`,
      fileName: file.name,
      totalPagesHint,
      processingMode
    });

    setProgressExperience('Lendo o conteúdo do documento...', 35);

    const localText = await extractPdfTextLocally(arrayBuffer, totalPagesHint || 200);

    const localConfidence = buildTextCoordinateConfidence(localText);
    const docPattern = classifyCoordinatePrintPattern(localText);
    logPdfDiag('local-text-extracted', {
      msg: `Texto local extraído: ${localConfidence.chars} chars, UTM pairs=${localConfidence.utmPairs}, LatLon pairs=${localConfidence.latLonPairs}.`,
      totalPagesHint,
      confidence: localConfidence,
      documentPattern: docPattern.id,
      documentPatternLabel: docPattern.label,
      documentPatternSignals: docPattern.signals
    });

    // OCR robusto: dispara quando não há pares coordenáveis confiáveis.
    const needsOcrEnhancement = shouldRunOcrEnhancement(localText);
    updateStatus(
      needsOcrEnhancement
        ? '⏳ Continuando a leitura para melhorar o resultado...'
        : '⏳ Leitura concluída. Montando o resultado...',
      'info'
    );
    logPdfDiag('ocr-decision', {
      msg: needsOcrEnhancement ? 'OCR de reforço ativado.' : 'OCR de reforço dispensado (sinal de coordenadas suficiente).',
      needsOcrEnhancement,
      confidence: localConfidence,
      documentPattern: docPattern.id
    });

    setProgressExperience(
      needsOcrEnhancement
        ? 'Analisando o documento...'
        : 'Montando o resultado final...',
      75
    );
    updateStatus(
      needsOcrEnhancement
        ? '⏳ Estamos organizando as informações do documento...'
        : '⏳ Finalizando os detalhes do resultado...',
      'info'
    );

    let apiResult;
    if (needsOcrEnhancement) {
      try {
        // OCR e IA formam o caminho principal; o parser nativo só entra se esse caminho falhar.
        apiResult = await runOcrEtlBranch(
          file.name,
          totalPagesHint,
          localText,
          arrayBuffer,
          ocrPlan,
          processingMode,
          { suppressUi: true, patternHint: docPattern.id }
        );
        logPdfDiag('ocr-primary-success', {
          msg: 'OCR local + IA concluídos; parser nativo não foi executado em paralelo.',
          extractedVertices: estimateExtractedVerticesFromApiResult(apiResult)
        });
      } catch (ocrError) {
        logPdfDiag('ocr-primary-failed', {
          msg: `OCR principal falhou; usando texto nativo como fallback: ${ocrError?.message || ocrError}`,
          error: String(ocrError?.message || ocrError)
        });
        apiResult = await runParserLayoutFallbackBranch(
          file.name,
          totalPagesHint,
          localText,
          processingMode,
          {
            branchLabel: 'Fallback de texto nativo',
            diagPrefix: 'native-fallback',
            suppressUi: true,
            patternHint: docPattern.id,
            flowMode: 'no-ocr'
          }
        );
      }
    } else {
      apiResult = await runParserLayoutFallbackBranch(
        file.name,
        totalPagesHint,
        localText,
        processingMode,
        {
          branchLabel: 'Texto nativo + IA',
          diagPrefix: 'native-primary',
          suppressUi: true,
          patternHint: docPattern.id,
          flowMode: 'no-ocr'
        }
      );
    }

    setProgressExperience('Finalizando a preparação dos resultados...', 100);

    if (!apiResult?.success) {
      throw new Error(apiResult?.error || 'Falha na extração local.');
    }

    const selectedSourceText = String(apiResult?.__sourceText || localText || '').trim();
    console.log('CHAMANDO APPLY COM:', typeof selectedSourceText, selectedSourceText.length);
    await applyExtractionGeoJsonResult(apiResult, file.name, selectedSourceText, totalPagesHint);
    logPdfDiag('final-success', {
      msg: `Extração concluída: source=${apiResult.sourcePattern || 'n/a'}, projection=${apiResult.projectionKey || 'n/a'}, vertices=${estimateExtractedVerticesFromApiResult(apiResult)}.`,
      sourcePattern: apiResult.sourcePattern || null,
      projectionKey: apiResult.projectionKey || null,
      extractedVertices: estimateExtractedVerticesFromApiResult(apiResult),
      warnings: Array.isArray(apiResult.warnings) ? apiResult.warnings : [],
      finalVertexSummary: summarizeVerticesForDiag(extractedCoordinates)
    });
    finalizePdfDiagRun('success', {
      sourcePattern: apiResult.sourcePattern || null,
      projectionKey: apiResult.projectionKey || null,
      extractedVertices: estimateExtractedVerticesFromApiResult(apiResult)
    });
    return;

  } catch (e) {
    const uiError = normalizeUiErrorMessage(e?.message || e);
    logPdfDiag('final-error', {
      msg: `Falha final no processamento: ${e?.message || e}`,
      error: String(e?.message || e),
      stack: e?.stack || ''
    });
    finalizePdfDiagRun('error', {
      error: String(e?.message || e)
    });
    const isNoCoordError = /não foi possível localizar coordenadas|no coordinates|coordenadas.*válidas/i.test(String(e?.message || ''));
    if (isNoCoordError) {
      updateStatus(`❌ Não foi possível concluir o processamento: ${uiError}`, 'error');
    } else {
      updateStatus(`❌ Não foi possível concluir o processamento: ${uiError}`, 'error');
    }
    stopProgressHintRotation();
    progressContainer.style.display = 'none';
  }
});


// Exporta CSV e relatório textual de validação.
downloadBtn.onclick = () => {
  if (!extractedCoordinates.length) return;
  try {
    const key = getActiveProjectionKey();
    const doc = getSelectedDoc();
    const epsg = PROJECTIONS[key]?.epsg || (doc?.relativeInfo?.relative ? "RELATIVO" : "");
    const crsName = doc?.relativeInfo?.relative ? "RELATIVO" : (key ? key.replace(/[^\w]/g, "_") : "CRS");

    // Gera CSV com diagnóstico topológico e de memorial.
    const csv = gerarCsvParaVertices(
      extractedCoordinates,
      epsg,
      doc?.docId || "DESCONHECIDA",
      doc?.topology,
      doc?.memorialValidation,
      doc?.relativeInfo
    );

    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    // Inclui origem do PDF e identificador da fonte no nome do arquivo.
    link.download = `${pdfOrigemNomeBase || fileNameBase}_${crsName}_Validado_${pdfOrigemSrc || "src"}.csv`;
    link.click();

    // Exporta relatório textual quando houver validação disponível.
    if (doc?.topology || doc?.memorialValidation) {
      const relatorio = gerarRelatorioValidacao(
        doc.docId,
        doc.pages,
        doc.topology,
        doc.memorialValidation,
        doc.warnings
      );
      const linkRel = document.createElement("a");
      linkRel.href = URL.createObjectURL(new Blob([relatorio], { type: "text/plain;charset=utf-8;" }));
      // Mantém padrão de nome com origem e identificador da fonte.
      linkRel.download = `${pdfOrigemNomeBase || fileNameBase}_${crsName}_Relatorio_${pdfOrigemSrc || "src"}.txt`;
      linkRel.click();
    }
  } catch (e) {
    // Ignora cancelamento explícito do usuário.
    if (e && e.name !== "AbortError") {
      updateStatus("Erro ao baixar arquivo: " + e.message, "error");
    }
  }
};

// Salva lote de arquivos (SHP + CSV) em diretório escolhido.
const toArrayBufferFS = (view, fileLabel = "arquivo") => {
  if (!view || typeof view.byteOffset !== "number" || typeof view.byteLength !== "number" || !view.buffer) {
    throw new Error(`Saída SHP inválida para ${fileLabel}.`);
  }
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
};

saveToFolderBtn.onclick = async () => {
  const hasDocs = Array.isArray(documentsResults) && documentsResults.length > 0;
  if (!hasDocs && !extractedCoordinates.length) return alert("⚠️ Processe um arquivo primeiro.");

  if (!("showDirectoryPicker" in window)) {
    updateStatus("❌ Seu navegador não suporta showDirectoryPicker. Use Edge/Chrome em HTTPS.", "error");
    return;
  }

  try {
    let handle = await window.showDirectoryPicker({ mode: "readwrite" });

    // Helper local de logging (fallback se displayLogMessage não estiver disponível)
    const logWrite = (msg) => {
      if (typeof displayLogMessage === "function") {
        displayLogMessage(msg);
      } else {
        console.log(msg);
      }
    };

    const writeFile = async (name, data) => {
      try {
        logWrite(`[PDFtoArcgis] 📝 Gravando ${name}...`);

        // Usar keepExistingData: false para sobrescrever se o arquivo já existe
        const fh = await handle.getFileHandle(name, { create: true });
        const w = await fh.createWritable({ keepExistingData: false });
        await w.write(data);
        await w.close();
        logWrite(`[PDFtoArcgis] ✓ ${name} gravado`);
      } catch (err) {
        // Se o usuário cancelar, não mostrar erro
        if (err && err.name === "AbortError") return;

        // Se falhar por estado inválido, indicar problema
        if (err && (err.name === "InvalidStateError" || err.message.includes("state cached"))) {
          logWrite("[PDFtoArcgis] ⚠️ Diretório desincronizado. Re-selecionando...");
          // Tentar re-selecionar e fazer retry uma única vez
          try {
            handle = await window.showDirectoryPicker({ mode: "readwrite" });
            const fhRetry = await handle.getFileHandle(name, { create: true });
            const wRetry = await fhRetry.createWritable({ keepExistingData: false });
            await wRetry.write(data);
            await wRetry.close();
            logWrite(`[PDFtoArcgis] ✓ ${name} gravado (após re-sincronizar)`);
            return;
          } catch (retryErr) {
            logWrite(`[PDFtoArcgis] ❌ Falha após re-sincronizar: ${retryErr.message}`);
            throw new Error("Diretório permanentemente desincronizado. Selecione a pasta novamente.", { cause: retryErr });
          }
        }

        logWrite(`[PDFtoArcgis] ❌ Erro ao salvar ${name}: ${err.message}`);
        throw err;
      }
    };

    // Caso PDF simples (sem split)
    if (!hasDocs) {
      const key = getActiveProjectionKey();
      const projection = buildProjectionFromPrj(key, shpProjectionWkt);
      if (!projection) throw new Error("CRS não suportado.");

      const base = sanitizeFileName(fileNameBase);
      const ring = extractedCoordinates.map(c => [c.east, c.north]);
      ring.push([ring[0][0], ring[0][1]]);
      ring.forEach((p, i) => {
        console.log(i, p[0], p[1]);
      });

      function ringArea(r) {
        let area = 0;

        for (let i = 0; i < r.length - 1; i++) {
          area +=
            r[i][0] * r[i + 1][1] -
            r[i + 1][0] * r[i][1];
        }

        return area / 2;
      }

      ring.push([ring[0][0], ring[0][1]]);

      const pointGeoms = extractedCoordinates.map(c => [c.east, c.north]);
      const pointProps = extractedCoordinates.map(c => ({
        ID: String(c.id).slice(0, 20),
        ORDEM: c.ordem,
        NORTH: c.north,
        EAST: c.east,
        EPSG: projection.epsg
      }));

      updateStatus("🗂️ Gravando SHP + CSV na pasta...", "info");

      let crsName = projection && projection.epsg ? projection.epsg : "CRS";
      crsName = String(crsName).replace(/[^\w\d]/g, "_");

      await new Promise((resolve, reject) => {
        window.shpwrite.write(
          [{ NOME: base, VERTICES: extractedCoordinates.length, EPSG: projection.epsg, TIPO: "LIMITE" }],
          "POLYGON",
          [[[ring]]],
          async (err, files) => {
            if (err) return reject(err);
            try {
              // Apenas gravando a versão limpa
              await writeFile(`${base}_${crsName}_limite.shp`, toArrayBufferFS(files.shp));
              await new Promise(r => setTimeout(r, 100));
              await writeFile(`${base}_${crsName}_limite.shx`, toArrayBufferFS(files.shx));
              await new Promise(r => setTimeout(r, 100));
              await writeFile(`${base}_${crsName}_limite.dbf`, toArrayBufferFS(files.dbf));
              await new Promise(r => setTimeout(r, 100));
              await writeFile(`${base}_${crsName}_limite.prj`, projection.wkt);
              resolve();
            } catch (e) { reject(e); }
          }
        );
      });

      await new Promise((resolve, reject) => {
        window.shpwrite.write(
          pointProps,
          "POINT",
          pointGeoms,
          async (err, files) => {
            if (err) return reject(err);
            try {
              // Apenas gravando a versão limpa
              await writeFile(`${base}_${crsName}_vertices.shp`, toArrayBufferFS(files.shp));
              await new Promise(r => setTimeout(r, 100));
              await writeFile(`${base}_${crsName}_vertices.shx`, toArrayBufferFS(files.shx));
              await new Promise(r => setTimeout(r, 100));
              await writeFile(`${base}_${crsName}_vertices.dbf`, toArrayBufferFS(files.dbf));
              await new Promise(r => setTimeout(r, 100));
              await writeFile(`${base}_${crsName}_vertices.prj`, projection.wkt);
              resolve();
            } catch (e) { reject(e); }
          }
        );
      });

      const csv = gerarCsvParaVertices(extractedCoordinates, projection.epsg, fileNameBase);
      await writeFile(`${base}_${crsName}_Validado.csv`, csv);

      updateStatus("✅ Gravado: limite + vertices + CSV (com .prj)!", "success");
      return;
    }

    // Caso PDF unificado (todas as matrículas)
    updateStatus(`🗂️ Gravando ${documentsResults.length} matrículas (SHP + CSV)...`, "info");

    let saved = 0;
    const skipped = [];

    for (const doc of documentsResults) {
      const vertices = Array.isArray(doc.vertices) ? doc.vertices : [];
      const docId = doc.docId || "SEM_ID";

      if (vertices.length < 3) {
        skipped.push(`Arquivo ${pdfOrigemSrc || "src"}: vértices insuficientes (${vertices.length})`);
        continue;
      }

      const projKey = doc.manualProjectionKey || doc.projectionKey || getActiveProjectionKey();
      const projection = PROJECTIONS[projKey];
      const isRelative = doc.relativeInfo?.relative === true;
      if (!projection && !isRelative) {
        skipped.push(`Arquivo ${pdfOrigemSrc || "src"}: CRS não suportado (${projKey})`);
        continue;
      }

      const base = sanitizeFileName(pdfOrigemNomeBase || fileNameBase);
      const ring = vertices.map(c => [c.east, c.north]);


      console.log(
        "VERTICES EXPORTADOS:",
        vertices.map(v => v.id)
      );


      if (
        ring.length > 2 &&
        (
          ring[0][0] !== ring[ring.length - 1][0] ||
          ring[0][1] !== ring[ring.length - 1][1]
        )
      ) {
        ring.push([
          ring[0][0],
          ring[0][1]
        ]);
      }

      console.log("ANEL EXPORTADO SHP");

      ring.forEach((p, i) => {
        console.log(i, p[0], p[1]);
      });

      function ringArea(r) {
        let area = 0;

        for (let i = 0; i < r.length - 1; i++) {
          area +=
            r[i][0] * r[i + 1][1] -
            r[i + 1][0] * r[i][1];
        }

        return area / 2;
      }

      let crsName = projection && projection.epsg ? projection.epsg : (isRelative ? "RELATIVO" : "CRS");
      crsName = String(crsName).replace(/[^\w\d]/g, "_");

      // Limite (POLYGON)
      await new Promise((resolve, reject) => {
        window.shpwrite.write(
          [{ NOME: base, VERTICES: vertices.length, EPSG: projection?.epsg || (isRelative ? "RELATIVO" : ""), TIPO: "LIMITE" }],
          "POLYGON",
          [[[ring]]],
          async (err, files) => {
            if (err) return reject(err);
            try {
              // Apenas gravando a versão limpa
              await writeFile(`${base}_${crsName}_limite.shp`, toArrayBufferFS(files.shp));
              await new Promise(r => setTimeout(r, 100));
              await writeFile(`${base}_${crsName}_limite.shx`, toArrayBufferFS(files.shx));
              await new Promise(r => setTimeout(r, 100));
              await writeFile(`${base}_${crsName}_limite.dbf`, toArrayBufferFS(files.dbf));
              await new Promise(r => setTimeout(r, 100));
              if (projection?.wkt) {
                await writeFile(`${base}_${crsName}_limite.prj`, projection.wkt);
              }
              resolve();
            } catch (e) { reject(e); }
          }
        );
      });

      // Vertices (POINT)
      const pointGeoms = vertices.map(c => [c.east, c.north]);
      const pointProps = vertices.map(c => ({
        ID: String(c.id).slice(0, 20),
        ORDEM: c.ordem,
        NORTH: c.north,
        EAST: c.east,
        EPSG: projection?.epsg || (isRelative ? "RELATIVO" : "")
      }));

      await new Promise((resolve, reject) => {
        window.shpwrite.write(
          pointProps,
          "POINT",
          pointGeoms,
          async (err, files) => {
            if (err) return reject(err);
            try {
              // Apenas gravando a versão limpa
              await writeFile(`${base}_${crsName}_vertices.shp`, toArrayBufferFS(files.shp));
              await new Promise(r => setTimeout(r, 100));
              await writeFile(`${base}_${crsName}_vertices.shx`, toArrayBufferFS(files.shx));
              await new Promise(r => setTimeout(r, 100));
              await writeFile(`${base}_${crsName}_vertices.dbf`, toArrayBufferFS(files.dbf));
              await new Promise(r => setTimeout(r, 100));
              if (projection?.wkt) {
                await writeFile(`${base}_${crsName}_vertices.prj`, projection.wkt);
              }
              resolve();
            } catch (e) { reject(e); }
          }
        );
      });

      // CSV
      const csv = gerarCsvParaVertices(vertices, projection?.epsg || (isRelative ? "RELATIVO" : ""), docId, doc.topology, doc.memorialValidation, doc.relativeInfo);
      await writeFile(`${base}_${crsName}_Validado.csv`, csv);

      // Relatório de validação
      if (doc.topology || doc.memorialValidation) {
        let safePages = Array.isArray(doc.pages) ? doc.pages : (typeof doc.pages === 'string' ? doc.pages : '(desconhecido)');
        const relatorio = gerarRelatorioValidacao(docId, safePages, doc.topology, doc.memorialValidation, doc.warnings, doc.assistiveAnalysis);
        await writeFile(`${base}_${crsName}_Relatorio.txt`, relatorio);
      }

      saved++;
    }

    if (skipped.length) {
      updateStatus(`✅ Concluído. Matrículas salvas: ${saved}\n⚠️ Ignoradas: ${skipped.length}\n- ${skipped.join("\n- ")}`, "warning");
    } else {
      updateStatus(`✅ Concluído. Matrículas salvas: ${saved}`, "success");
    }

  } catch (e) {
    if (e && (e.name === "InvalidStateError" || e.message.includes("state cached"))) {
      updateStatus("❌ Erro ao salvar na pasta: Diretório foi modificado. Selecione a pasta novamente.", "error");
    } else if (e && e.name === "NotAllowedError") {
      updateStatus("❌ Erro: Permissão negada ao acessar a pasta. Verifique as permissões do navegador.", "error");
    } else {
      updateStatus("❌ Erro ao salvar na pasta: " + (e.message || String(e)), "error");
    }
  }
};

// Modo avancado: forcar CRS
if (forceCrsBtn) {
  forceCrsBtn.addEventListener("click", () => {
    if (!projectionSelect) return;
    const key = projectionSelect.value;
    const doc = getSelectedDoc();

    if (doc) {
      doc.manualProjectionKey = key;
      doc.projectionInfo = { confidence: "manual", reason: "CRS forçado manualmente para a matrícula selecionada." };
      updateStatus(`ℹ️ CRS aplicado manualmente (MAT ${doc.docId}): ${key}`, "info");
      updateActiveDocUI();
    } else {
      updateStatus(`ℹ️ CRS aplicado manualmente: ${key}`, "info");
      showDetectedCrsUI(key, { confidence: "manual", reason: "CRS forçado manualmente." });
    }
  });
}


// Elementos do memorial
const shpInput = document.getElementById("shpInput");
const memorialMetaBox = document.getElementById("memorialMetaBox");
const respTecnicoInput = document.getElementById("respTecnico");
const respCreaInput = document.getElementById("respCrea");
const cidadeDetectadaInput = document.getElementById("cidadeDetectada");
const generateDocxBtn = document.getElementById("generateDocxBtn");

// Estado
let shpVertices = [];
let shpMemorialVertices = [];
let shpCrsKey = null;
let shpCrsText = "";
let shpProjectionWkt = "";
let shpMemorialProjectionWkt = "";
let shpMemorialCrsText = "";
let shpPoligonoNome = "";
let shpCityName = "";
const MEMORIAL_COORD_DECIMALS = 6;

// Formatadores (pt-BR)
const BRNumber2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function fmtMeters2(v) { return BRNumber2.format(v); }
function formatCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(MEMORIAL_COORD_DECIMALS) : "-";
}
function toDMS(az) {
  az = ((az % 360) + 360) % 360;
  const d = Math.floor(az);
  const mFloat = (az - d) * 60;
  const m = Math.floor(mFloat);
  const s = Math.round((mFloat - m) * 60);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(d, 3)}°${pad(m)}'${pad(s)}"`;
}
function crsKeyToText(key) {
  if (!key) return "CRS não identificado";
  const p = PROJECTIONS[key];
  if (!p) return key;
  return `${p.name.replace('zone', 'Zona').replace('zone ', 'Zona ')} (${p.epsg})`;
}
function inferCityFromVertices(vertices, key) {
  if (!vertices || vertices.length === 0) return "";
  const avgE = vertices.reduce((s, v) => s + v.east, 0) / vertices.length;
  const avgN = vertices.reduce((s, v) => s + v.north, 0) / vertices.length;

  let lonlat = null, lat = null, lon = null;
  try {
    if (key && key.startsWith("SIRGAS2000_")) {
      const zone = parseInt(key.match(/_(\d{2})S$/)?.[1] || "22", 10);
      const projStr = `+proj=utm +zone=${zone} +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`;
      lonlat = proj4(projStr, proj4.WGS84, [avgE, avgN]); // [lon, lat]
    }
  } catch (e) { }

  if (lonlat && Array.isArray(lonlat)) { lon = lonlat[0]; lat = lonlat[1]; }

  const isCuritiba = (lat && lon)
    ? (lat >= -25.60 && lat <= -25.25 && lon >= -49.45 && lon <= -49.10)
    : (avgN >= 7.170e6 && avgN <= 7.220e6 && avgE >= 660000 && avgE <= 710000);

  const isPiraquara = (lat && lon)
    ? (lat >= -25.60 && lat <= -25.35 && lon >= -49.25 && lon <= -48.95)
    : (avgN >= 7.180e6 && avgN <= 7.200e6 && avgE >= 680000 && avgE <= 705000);

  if (isPiraquara) return "Piraquara-PR";
  if (isCuritiba) return "Curitiba-PR";
  return "Município não identificado";
}
async function extractPrjFromZip(file) {
  try {
    const ab = await file.arrayBuffer();
    const zip = new PizZip(ab);
    const names = Object.keys(zip.files);
    const prjName = names.find(n => n.toLowerCase().endsWith(".prj"));
    if (!prjName) return null;
    return zip.files[prjName].asText();
  } catch (e) { return null; }
}
function resolveCrsKeyFromPrj(prjText) {
  if (!prjText) return null;
  const t = String(prjText).toUpperCase().replace(/[\r\n]+/g, " ");
  const compact = t.replace(/[\s_]+/g, " ").trim();
  const isUtm = /\bUTM\b|TRANSVERSE[_ ]MERCATOR|TRANSVERSE MERCATOR/.test(compact);
  if (!isUtm) {
    if (/WGS\s*[_ ]?84|WGS[_ ]?1984/.test(compact)) return "WGS84";
    try {
      if (typeof proj4 === "function" && proj4(String(prjText))) return "CUSTOM_CRS";
    } catch {
      // Mantém a rejeição abaixo para WKT inválido.
    }
    return null;
  }

  const datum = /SIRGAS\s*2000|SISTEMA DE REFERENCIA GEOCENTRICO PARA LAS AMERICAS 2000/.test(compact)
    ? "SIRGAS2000"
    : (/SAD\s*69|SOUTH AMERICAN DATUM 1969|SOUTH_AMERICAN_DATUM_1969/.test(compact)
      ? "SAD69"
      : null);
  if (!datum) {
    try {
      if (typeof proj4 === "function" && proj4(String(prjText))) return "CUSTOM_CRS";
    } catch {
      // Mantém a rejeição abaixo para WKT inválido.
    }
    return null;
  }

  const zoneMatch = compact.match(/(?:UTM\s*(?:ZONE|ZONA)?|ZONE|ZONA)\s*0?(\d{1,2})\s*([NS])?/)
    || compact.match(/(?:ZONE|ZONA)[^0-9]{0,12}0?(\d{1,2})\s*([NS])?/);
  let zone = zoneMatch ? Number.parseInt(zoneMatch[1], 10) : null;
  if (!zone) {
    const centralMeridianMatch = compact.match(/(?:CENTRAL[_ ]MERIDIAN|LONGITUDE OF (?:NATURAL )?ORIGIN|PARAMETER\["CENTRAL_MERIDIAN")\s*[,=: ]+(-?\d+(?:\.\d+)?)/);
    const centralMeridian = centralMeridianMatch ? Number(centralMeridianMatch[1]) : NaN;
    if (Number.isFinite(centralMeridian)) {
      zone = Math.round((centralMeridian + 183) / 6);
    }
  }
  if (!Number.isInteger(zone) || zone < 1 || zone > 60) return null;

  const suffix = datum === "SIRGAS2000" ? `SIRGAS2000_${zone}S` : `SAD69_${zone}S`;
  return PROJECTIONS[suffix] ? suffix : "CUSTOM_CRS";
}
function getExteriorRingFromGeoJSON(apiResult) {
  const feature = apiResult?.geojson?.features?.[0] || apiResult?.features?.[0];
  const geometry = feature?.geometry;
  const coordinates = geometry?.coordinates;

  if (!Array.isArray(coordinates)) return [];
  if (geometry.type === "Polygon" || geometry.type === "LineString") {
    return geometry.type === "Polygon" ? (coordinates[0] || []) : coordinates;
  }
  if (geometry.type === "MultiPolygon") {
    return coordinates[0]?.[0] || [];
  }
  if (geometry.type === "MultiLineString") {
    return coordinates[0] || [];
  }
  return [];
}

function verticesFromGeoJSON(apiResult) {
  const coords = getExteriorRingFromGeoJSON(apiResult);

  if (!Array.isArray(coords)) return [];

  return coords.map((coord, i) => ({
    id: `V${String(i + 1).padStart(3, '0')}`,
    east: Number(coord[0]),
    north: Number(coord[1])
  }));
}

function assertSingleSimplePolygon(geojson) {
  const features = Array.isArray(geojson?.features) ? geojson.features : [];
  if (features.length !== 1) {
    throw new Error(`O ZIP contém ${features.length} feições. Esta ferramenta gera um memorial por vez; envie um SHP com exatamente um polígono.`);
  }

  const geometry = features[0]?.geometry;
  if (geometry?.type !== "Polygon") {
    throw new Error(`Geometria ${geometry?.type || "desconhecida"} não suportada sem perda de dados. Envie um Polygon simples.`);
  }
  if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length !== 1) {
    throw new Error("O polígono contém anéis internos. A geração de um único memorial não pode omitir esses anéis.");
  }
}

// shpjs sempre retorna GeoJSON em WGS84 (lon/lat); reprojeta para o CRS original do .prj (ex.: SIRGAS2000_25S) antes de gerar o memorial.
function reprojectGeoJsonVerticesToOriginalCrs(vertices = [], crsKey = null) {
  const list = Array.isArray(vertices) ? vertices : [];
  if (!list.length) return list;

  const allGeographic = list.every((v) => isGeographicCoordinatePair(v));
  if (!allGeographic) return list;

  if (typeof proj4 !== "function") {
    console.warn("[SHP] proj4 indisponível; não foi possível reprojetar vértices geográficos para o CRS original.");
    return list;
  }

  const target = buildProj4FromProjectionKey(crsKey) || (shpProjectionWkt || null);
  if (!target) {
    console.warn(`[SHP] Não foi possível determinar a projeção de destino para o CRS "${crsKey}". Vértices permanecem em lon/lat.`);
    return list;
  }

  return list.map((vertex) => {
    const xy = proj4(proj4.WGS84, target, [Number(vertex.east), Number(vertex.north)]);
    return { ...vertex, east: Number(xy[0]), north: Number(xy[1]) };
  });
}

function buildAutoUtmProjection(vertices, sourceWkt = "") {
  const avgLon = vertices.reduce((sum, vertex) => sum + Number(vertex.east), 0) / vertices.length;
  const avgLat = vertices.reduce((sum, vertex) => sum + Number(vertex.north), 0) / vertices.length;
  const zone = Math.min(60, Math.max(1, Math.floor((avgLon + 180) / 6) + 1));
  const hemisphere = avgLat < 0 ? "S" : "N";
  const centralMeridian = zone * 6 - 183;
  const isSirgas2000 = /SIRGAS[ _]?2000/i.test(String(sourceWkt || ""));
  const datumName = isSirgas2000 ? "SIRGAS 2000" : "WGS 84";
  const datumWkt = isSirgas2000
    ? 'GEOGCS["SIRGAS 2000",DATUM["Sistema de Referencia Geocentrico para las Americas 2000",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]'
    : 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]';
  const epsgCode = isSirgas2000 && hemisphere === "S"
    ? 31960 + zone
    : (hemisphere === "S" ? 32700 + zone : 32600 + zone);
  const ellipsoid = isSirgas2000 ? "+ellps=GRS80" : "+datum=WGS84";
  const wkt = `PROJCS["${datumName} / UTM zone ${zone}${hemisphere}",${datumWkt},PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",${centralMeridian}],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",${hemisphere === "S" ? 10000000 : 0}],UNIT["metre",1],AUTHORITY["EPSG","${epsgCode}"]]`;
  return {
    zone,
    hemisphere,
    wkt,
    epsg: `EPSG:${epsgCode}`,
    proj4: `+proj=utm +zone=${zone} ${hemisphere === "S" ? "+south " : ""}${ellipsoid} +units=m +no_defs`
  };
}

function convertVerticesToMemorialUtm(vertices, sourceWkt) {
  if (!Array.isArray(vertices) || vertices.length < 3 || typeof proj4 !== "function") {
    throw new Error("Não foi possível preparar as coordenadas UTM do memorial.");
  }

  const geographic = vertices.every(isGeographicCoordinatePair);
  const source = sourceWkt || (geographic ? "EPSG:4326" : null);
  if (!source) throw new Error("O CRS original do SHP é necessário para converter o memorial para UTM.");

  const lonLat = vertices.map((vertex) => {
    const point = geographic
      ? [Number(vertex.east), Number(vertex.north)]
      : proj4(source, proj4.WGS84, [Number(vertex.east), Number(vertex.north)]);
    return { ...vertex, east: Number(point[0]), north: Number(point[1]) };
  });
  const target = buildAutoUtmProjection(lonLat, sourceWkt);
  return {
    vertices: lonLat.map((vertex) => {
      const point = proj4(proj4.WGS84, target.proj4, [vertex.east, vertex.north]);
      return { ...vertex, east: Number(point[0]), north: Number(point[1]) };
    }),
    wkt: target.wkt,
    text: `${/SIRGAS/i.test(target.wkt) ? "SIRGAS 2000" : "WGS 84"} / UTM zone ${target.zone}${target.hemisphere} (${target.epsg})`
  };
}

function normalizeShpVertices(vertices = [], tolerance = 0.001) {
  const source = Array.isArray(vertices) ? vertices : [];
  const isSamePoint = (a, b) => (
    Math.abs(Number(a?.east) - Number(b?.east)) <= tolerance
    && Math.abs(Number(a?.north) - Number(b?.north)) <= tolerance
  );

  const normalized = source
    .filter((vertex) => Number.isFinite(Number(vertex?.east)) && Number.isFinite(Number(vertex?.north)))
    .map((vertex) => ({ ...vertex }));

  if (normalized.length > 1 && isSamePoint(normalized[0], normalized[normalized.length - 1])) {
    normalized.pop();
  }

  return normalized.map((vertex, index) => ({
    ...vertex,
    id: `V${String(index + 1).padStart(3, '0')}`
  }));
}

function ensureClosedVertices(vertices = [], tolerance = 0.001) {
  const list = Array.isArray(vertices) ? vertices : [];
  if (list.length < 3) return list;

  const first = list[0];
  const last = list[list.length - 1];
  if (!first || !last) return list;

  const firstEast = Number(first.east);
  const firstNorth = Number(first.north);
  const lastEast = Number(last.east);
  const lastNorth = Number(last.north);
  const alreadyClosed = Number.isFinite(firstEast)
    && Number.isFinite(firstNorth)
    && Number.isFinite(lastEast)
    && Number.isFinite(lastNorth)
    && Math.abs(firstEast - lastEast) <= tolerance
    && Math.abs(firstNorth - lastNorth) <= tolerance;

  if (alreadyClosed) return list;

  return [
    ...list,
    {
      id: `V${String(list.length + 1).padStart(3, '0')}`,
      east: firstEast,
      north: firstNorth
    }
  ];
}

function prepararVerticesComMedidas(vertices, projectionKey = null) {
  const sourceVertices = Array.isArray(vertices) ? vertices : [];
  if (sourceVertices.length === 0) return [];

  const out = [];
  for (let i = 0; i < sourceVertices.length; i++) {
    const current = sourceVertices[i];
    const next = sourceVertices[(i + 1) % sourceVertices.length];
    const v = { ...current, ordem: i + 1 };
    if (sourceVertices.length > 1 && next) {
      v.distCalc = fmtMeters2(calcularDistancia(current, next, { projectionKey }));
      v.azCalc = toDMS(calcularAzimute(current, next, { projectionKey }));
    } else {
      v.distCalc = '---';
      v.azCalc = '---';
    }
    out.push(v);
  }
  return out;
}

// Evento: carregar SHP
if (shpInput) {
  shpInput.addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;

    try {
      updateStatus("🔄 Lendo SHP...", "info");
      console.log('[PDFtoArcgis][Diag][SHP->Memorial][start]', {
        ts: new Date().toISOString(),
        fileName: file.name,
        fileSizeBytes: file.size
      });

      // Nome amigavel
      shpPoligonoNome = file.name
        .replace(/\.[^/.]+$/, "")
        .replace(/_/g, " ")
        .trim();

      // Extensao
      const isZip = file.name.toLowerCase().endsWith(".zip");

      let geojson = null;
      let prjText = null;

      if (!isZip) {
        throw new Error("Formato não suportado. Para a ferramenta inversa, envie apenas .zip com o shapefile completo (.shp, .shx, .dbf, .prj).");
      }

      if (isZip) {
        // ZIP -> leitor tolerante
        const ab = await file.arrayBuffer();
        geojson = await readZipAsFeatureCollection(ab);
        // .prj do ZIP
        prjText = await extractPrjFromZip(file);
      }
      shpProjectionWkt = String(prjText || "").trim();

      // Diagnostico GeoJSON
      logGeojsonSummary(geojson);
      assertSingleSimplePolygon(geojson);

      // CRS
      shpCrsKey = resolveCrsKeyFromPrj(prjText);
      // Vertices no CRS de entrada (shpjs entrega sempre em lon/lat WGS84)
      let vertsRaw = verticesFromGeoJSON(geojson, shpCrsKey);

      console.log('[SHP][CRS CHECK]', {
        shpCrsKey,
        firstVertex: vertsRaw[0]
      });
      if (vertsRaw[0] && Math.abs(vertsRaw[0].east) <= 180 && Math.abs(vertsRaw[0].north) <= 90) {
        console.warn('[SHP] Coordenadas geográficas detectadas. Reprojetando para CRS original.');
      }

      console.log('[PDFtoArcgis][Diag][SHP->Memorial][raw-vertices]', {
        ts: new Date().toISOString(),
        shpCrsKey,
        vertexSummary: summarizeVerticesForDiag(vertsRaw),
        duplicateStats: summarizeDuplicateVertices(vertsRaw),
        prjDetected: Boolean(prjText)
      });

      if (!shpCrsKey) {
        throw new Error("Não foi possível identificar o CRS do SHP. Confirme que o ZIP contém um arquivo .prj válido com datum e zona UTM.");
      }

      // A tabela respeita o CRS original; o memorial recebe uma cópia sempre em UTM.
      const originalVertices = normalizeShpVertices(reprojectGeoJsonVerticesToOriginalCrs(vertsRaw, shpCrsKey));
      const memorialUtm = convertVerticesToMemorialUtm(originalVertices, shpProjectionWkt);
      shpVertices = prepararVerticesComMedidas(
        originalVertices,
        shpCrsKey
      );
      shpMemorialVertices = prepararVerticesComMedidas(
        normalizeShpVertices(memorialUtm.vertices),
        "CUSTOM_CRS"
      );
      shpMemorialProjectionWkt = memorialUtm.wkt;
      shpMemorialCrsText = memorialUtm.text;

      console.log('[PDFtoArcgis][Diag][SHP->Memorial][utm-vertices]', {
        ts: new Date().toISOString(),
        shpCrsKey,
        vertexSummary: summarizeVerticesForDiag(shpMemorialVertices),
        duplicateStats: summarizeDuplicateVertices(shpMemorialVertices),
        reprojection: {
          transformed: true,
          reason: `memorial-utm-${memorialUtm.text}`
        }
      });

      if (!Array.isArray(shpVertices) || shpVertices.length < 3) {
        console.warn("[SHP] Menos de 3 vertices apos parse.");
        updateStatus("⚠️ O SHP foi lido, mas não há polígono com 3+ vértices. Verifique se o layer é POLYGON/MULTIPOLYGON (ou se a linha está realmente fechada).", "warning");
        return;
      }

      // Cidade aproximada
      shpCityName = inferCityFromVertices(originalVertices, shpCrsKey);
      if (cidadeDetectadaInput) cidadeDetectadaInput.value = shpCityName;

      console.log('[PDFtoArcgis][Diag][SHP->Memorial][prepared-vertices]', {
        ts: new Date().toISOString(),
        shpCrsKey,
        vertexSummary: summarizeVerticesForDiag(shpVertices),
        duplicateStats: summarizeDuplicateVertices(shpVertices),
        cityGuess: shpCityName
      });

      // UI (tabela)
      extractedCoordinates = shpMemorialVertices.slice();
      countDisplay.innerText = extractedCoordinates.length;
      renderCoordinatePreviewRows(extractedCoordinates.map((c) => ({
        ...c,
        north: formatCoordinate(c.north),
        east: formatCoordinate(c.east)
      })));
      resultBox.style.display = "block";
      scrollToResults();

      // UI CRS
      const detectedProjection = buildProjectionFromPrj(shpCrsKey, shpProjectionWkt);
      shpCrsText = detectedProjection?.epsg && detectedProjection.epsg !== "PRJ"
        ? `${detectedProjection.name} (${detectedProjection.epsg})`
        : (detectedProjection?.name || crsKeyToText(shpCrsKey));
      showDetectedCrsUI(shpMemorialCrsText, {
        confidence: "alta",
        reason: `CRS original lido do .prj (${shpCrsText}); coordenadas convertidas para UTM em metros para o memorial.`
      });

      // UI memorial
      if (memorialMetaBox) memorialMetaBox.style.display = "block";

      updateStatus("✅ SHP carregado e processado. Pronto para gerar o DOCX.", "success");
    } catch (e) {
      updateStatus("Erro ao ler SHP: " + e.message, "error");
    }
  });
}


// Gerar DOCX

if (generateDocxBtn) {
  generateDocxBtn.addEventListener("click", async () => {
    try {
      // Verificar libs
      if (!window.docx || !window.docx.Document) {
        updateStatus("❌ Biblioteca DOCX não carregada. Verifique a tag do 'docx.umd.js'.", "error");
        return;
      }
      if (typeof window.saveAs !== "function") {
        updateStatus("❌ FileSaver não carregado. Inclua FileSaver.min.js antes do script.", "error");
        return;
      }

      // Preferir shpVertices; fallback extractedCoordinates
      let vertsBase =
        (Array.isArray(shpMemorialVertices) && shpMemorialVertices.length >= 3) ? shpMemorialVertices :
          (Array.isArray(extractedCoordinates) ? extractedCoordinates : []);

      if (!Array.isArray(vertsBase) || vertsBase.length < 3) {
        updateStatus("⚠️ Carregue um SHP válido (polígono com 3+ vértices) antes.", "warning");
        return;
      }

      // Normalizar tipos e IDs
      vertsBase = vertsBase
        .map((v, i) => ({
          id: v.id ?? `V${String(i + 1).padStart(3, "0")}`,
          east: typeof v.east === "string" ? parseFloat(v.east) : v.east,
          north: typeof v.north === "string" ? parseFloat(v.north) : v.north,
          ordem: v.ordem ?? (i + 1),
          distCalc: v.distCalc,
          azCalc: v.azCalc
        }))
        .filter(v => Number.isFinite(v.east) && Number.isFinite(v.north));

      console.log('[PDFtoArcgis][Diag][SHP->Memorial][docx-base-vertices]', {
        ts: new Date().toISOString(),
        vertexSummary: summarizeVerticesForDiag(vertsBase),
        duplicateStats: summarizeDuplicateVertices(vertsBase)
      });

      if (vertsBase.length < 3) {
        updateStatus("⚠️ As coordenadas contêm valores inválidos (NaN).", "warning");
        return;
      }

      // Trabalhar com anel aberto para evitar duplicidade do vértice inicial
      // quando o SHP já vem fechado (último ponto == primeiro ponto).
      let vertsOpen = vertsBase.slice();
      if (vertsOpen.length >= 2) {
        const first = vertsOpen[0];
        const last = vertsOpen[vertsOpen.length - 1];
        const alreadyClosed = Math.hypot(last.east - first.east, last.north - first.north) <= 0.01;
        if (alreadyClosed) {
          vertsOpen = vertsOpen.slice(0, -1);
        }
      }

      if (vertsOpen.length < 3) {
        updateStatus("⚠️ O polígono possui menos de 3 vértices úteis após normalização.", "warning");
        return;
      }

      const vertsForDoc = [...vertsOpen, { ...vertsOpen[0], id: vertsOpen[0]?.id || `V${String(vertsOpen.length + 1).padStart(3, "0")}` }];

      console.log('[PDFtoArcgis][Diag][SHP->Memorial][docx-ring-closure]', {
        ts: new Date().toISOString(),
        ringWasClosed: vertsOpen.length !== vertsBase.length,
        beforeCount: vertsBase.length,
        openCount: vertsOpen.length,
        afterCount: vertsForDoc.length,
        duplicateStatsAfterClosure: summarizeDuplicateVertices(vertsForDoc)
      });

      // Gerar dist/az se faltar
      const precisaMedidas = (v) => v.distCalc === undefined || v.azCalc === undefined;
      if (vertsOpen.some(precisaMedidas)) {
        vertsOpen = prepararVerticesComMedidas(
          vertsOpen.map(v => ({ east: v.east, north: v.north, id: v.id })),
          "CUSTOM_CRS"
        );
      }

      console.log('[PDFtoArcgis][Diag][SHP->Memorial][docx-final-vertices]', {
        ts: new Date().toISOString(),
        crsKey: `UTM convertido (${shpMemorialProjectionWkt ? 'WKT original preservado' : 'automático'})`,
        vertexSummary: summarizeVerticesForDiag(vertsForDoc),
        duplicateStats: summarizeDuplicateVertices(vertsForDoc)
      });

      // Metadados UI
      const resp = (respTecnicoInput?.value ?? "").trim();
      const crea = (respCreaInput?.value ?? "").trim();
      let cidade = (cidadeDetectadaInput?.value ?? "").trim();

      // CRS textual
      const crsKey = "CUSTOM_CRS";
      const crsText = shpMemorialCrsText || "WGS 84 / UTM";

      // Cidade (inferir se vazio)
      if (!cidade || cidade === "Município não identificado") {
        cidade = inferCityFromVertices(
          vertsOpen.map(v => ({ east: v.east, north: v.north })),
          crsKey
        ) || "Curitiba-PR";
      }

      const nomeArea = shpPoligonoNome || "gleba";
      // Data por extenso
      function formatarDataPorExtenso(date) {
        const meses = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
        const d = date.getDate();
        const m = meses[date.getMonth()];
        const y = date.getFullYear();
        return `${d} de ${m} de ${y}`;
      }
      const dataBR = formatarDataPorExtenso(new Date());

      // Area (ha) e perimetro (m)
      let signed = 0;
      for (let i = 0; i < vertsOpen.length; i++) {
        const a = vertsOpen[i], b = vertsOpen[(i + 1) % vertsOpen.length];
        signed += a.east * b.north - b.east * a.north;
      }
      const areaHa = Math.abs(signed) / 2 / 10000;

      let per = 0;
      for (let i = 0; i < vertsOpen.length; i++) {
        const a = vertsOpen[i];
        const b = vertsOpen[(i + 1) % vertsOpen.length];
        per += calcularDistancia(a, b, { projectionKey: crsKey });
      }

      const BRNumber2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const areaTxt = BRNumber2.format(areaHa);
      const perTxt = BRNumber2.format(per);

      // Geracao do DOCX
      const { Document, Packer, Paragraph, TextRun, AlignmentType, LineSpacingType } = window.docx;

      // Espacamento entre letras
      function espacarLetras(texto) {
        return texto.split("").join(" ");
      }

      console.log("MEMORIAL COMPLETO:", "gerado a partir dos vértices normalizados");

      console.log("TRECHOS IDENTIFICADOS:", vertsOpen.length);

      // Garantir numero valido
      function safeNumber(val, casas = 2) {
        const n = Number(val);
        return Number.isFinite(n) ? n.toFixed(casas) : "0.00";
      }

      function parsePtBrNumber(value) {
        if (typeof value === "number") return value;
        if (typeof value !== "string") return NaN;
        return Number(value.replace(/\./g, "").replace(",", "."));
      }

      // Incluir todos os segmentos
      const memorialRuns = [];
      for (let i = 0; i < vertsOpen.length; i++) {
        const vAtual = vertsOpen[i];
        const vProx = vertsOpen[(i + 1) % vertsOpen.length];
        let dist = parsePtBrNumber(vAtual.distCalc);
        if (!Number.isFinite(dist)) {
          dist = calcularDistancia(vAtual, vProx, { projectionKey: crsKey });
        }
        let azimute = vAtual.azCalc;
        if (!azimute) {
          azimute = toDMS(calcularAzimute(vAtual, vProx, { projectionKey: crsKey }));
        }
        // Coordenadas entre parênteses
        memorialRuns.push(
          new TextRun({
            text: ` Do vértice ${i + 1} segue até o vértice ${((i + 1) % vertsOpen.length) + 1}, com coordenadas `,
            size: 24, font: "Arial"
          }),
          new TextRun({
            text: `U T M (E=${safeNumber(vProx.east, MEMORIAL_COORD_DECIMALS)} e N=${safeNumber(vProx.north, MEMORIAL_COORD_DECIMALS)})`,
            bold: true, size: 24, font: "Arial"
          }),
          new TextRun({
            text: `, no azimute de ${azimute}, na extensão de ${safeNumber(dist)} m;`,
            size: 24, font: "Arial"
          })
        );
      }

      const spacing15 = { line: 360, lineRule: (window.docx && window.docx.LineSpacingType && window.docx.LineSpacingType.AUTO) ? window.docx.LineSpacingType.AUTO : "AUTO" };
      const doc = new Document({
        sections: [{
          properties: { page: { margin: { top: 1417, right: 1134, bottom: 1134, left: 1134 } } },
          headers: {
            default: new window.docx.Header({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: spacing15,
                  children: [
                    new TextRun({
                      text: espacarLetras("MEMORIAL DESCRITIVO"),
                      bold: true,
                      size: 28, // Times New Roman 14pt = 28 half-points
                      font: "Times New Roman",
                      allCaps: true
                    })
                  ]
                }),
                // Linha vazia abaixo do título no cabeçalho
                new Paragraph({ spacing: spacing15, children: [new TextRun({ text: "", size: 24, font: "Arial" })] })
              ]
            })
          },
          children: [
            // ITEM 1 - DESCRIÇÃO
            new Paragraph({
              alignment: AlignmentType.JUSTIFIED,
              spacing: spacing15,
              children: [
                new TextRun({ text: "1. Descrição da Área: ", bold: true, size: 24, font: "Arial" }),
                new TextRun({
                  text: `A referida gleba é delimitada por um polígono irregular cuja descrição se inicia no vértice 1, seguindo sentido horário com coordenadas planas no sistema U T M (E=${safeNumber(vertsOpen[0].east, MEMORIAL_COORD_DECIMALS)} e N=${safeNumber(vertsOpen[0].north, MEMORIAL_COORD_DECIMALS)}), como segue:`,
                  size: 24, font: "Arial"
                })
              ]
            }),

            // CRS
            new Paragraph({
              alignment: AlignmentType.JUSTIFIED,
              spacing: spacing15,
              children: [
                new TextRun({ text: "Sistema de Referência (CRS): ", bold: true, size: 24, font: "Arial" }),
                new TextRun({ text: ` ${crsText}`, size: 24, font: "Arial" })
              ]
            }),

            // LINHA VAZIA ANTES DO ITEM 2
            new Paragraph({ spacing: spacing15, children: [new TextRun({ text: "", size: 24, font: "Arial" })] }),

            // ITEM 2 - MEMORIAL (BLOCO ÚNICO)
            new Paragraph({
              alignment: AlignmentType.JUSTIFIED,
              spacing: spacing15,
              children: [
                new TextRun({ text: "2. Memorial da Área: ", bold: true, size: 24, font: "Arial" }),
                ...memorialRuns
              ]
            }),

            // FECHAMENTO
            new Paragraph({
              alignment: AlignmentType.JUSTIFIED,
              spacing: spacing15,
              children: [
                new TextRun({
                  text: `Finalmente, fechando o polígono acima descrito, abrangendo uma área de ${areaTxt} ha e um perímetro de ${perTxt} m.`,
                  size: 24, font: "Arial"
                })
              ]
            }),

            // 3 LINHAS VAZIAS ANTES DA CIDADE/DATA
            new Paragraph({ spacing: spacing15, children: [new TextRun({ text: "", size: 24, font: "Arial" })] }),
            new Paragraph({ spacing: spacing15, children: [new TextRun({ text: "", size: 24, font: "Arial" })] }),
            new Paragraph({ spacing: spacing15, children: [new TextRun({ text: "", size: 24, font: "Arial" })] }),

            // DATA E ASSINATURA
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: spacing15,
              children: [new TextRun({ text: `${cidade}, ${dataBR}`, size: 24, font: "Arial" })]
            }),

            // 3 LINHAS VAZIAS ANTES DA ASSINATURA
            new Paragraph({ spacing: spacing15, children: [new TextRun({ text: "", size: 24, font: "Arial" })] }),
            new Paragraph({ spacing: spacing15, children: [new TextRun({ text: "", size: 24, font: "Arial" })] }),
            new Paragraph({ spacing: spacing15, children: [new TextRun({ text: "", size: 24, font: "Arial" })] }),

            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: spacing15,
              children: [
                new TextRun({ text: "______________________________________________", size: 24, font: "Arial" }),
                new TextRun({ text: resp || "Responsável Técnico", break: 1, size: 24, font: "Arial" }),
                crea ? new TextRun({ text: crea, break: 1, size: 24, font: "Arial" }) : null
              ].filter(Boolean)
            })
          ]
        }]
      });

      const blob = await Packer.toBlob(doc);
      const outName = `${(shpPoligonoNome || "Memorial").replace(/\s+/g, "_")}_Memorial.docx`;
      saveAs(blob, outName);

      updateStatus("✅ DOCX gerado com sucesso.", "success");
    } catch (e) {
      console.error(e);
      updateStatus("Erro ao gerar DOCX: " + e.message, "error");
    }
  });
}

// Promove LineString para Polygon quando ja estiver fechada
function lineToPolygonIfClosed(coords, tol = 0.5) {
  if (!Array.isArray(coords) || coords.length < 3) return null;

  const first = coords[0];
  const last = coords[coords.length - 1];
  if (!Array.isArray(first) || !Array.isArray(last)) return null;

  const d = Math.hypot(last[0] - first[0], last[1] - first[1]);
  if (d > tol) return null; // não está fechada (longe demais)

  const isPreciselyClosed = d <= Number.EPSILON;
  const ring = isPreciselyClosed ? coords.slice() : [...coords, [first[0], first[1]]];

  return { type: "Polygon", coordinates: [ring] };
}

// Forca geometry a virar Polygon quando possivel
function coerceGeometryToPolygon(geometry, tol = 0.5) {
  if (!geometry || !geometry.type) return null;

  const t = geometry.type;
  if (t === "Polygon") return geometry;

  if (t === "MultiPolygon") {
    if (Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0) {
      const firstPoly = geometry.coordinates[0];
      if (Array.isArray(firstPoly) && firstPoly.length > 0) {
        return { type: "Polygon", coordinates: firstPoly };
      }
    }
    return null;
  }

  if (t === "LineString") {
    return lineToPolygonIfClosed(geometry.coordinates, tol);
  }

  if (t === "MultiLineString") {
    const mls = geometry.coordinates;
    if (Array.isArray(mls)) {
      for (const line of mls) {
        const poly = lineToPolygonIfClosed(line, tol);
        if (poly) return poly;
      }
    }
    return null;
  }

  // Point/MultiPoint etc. não são promovíveis sem regras adicionais
  return null;
}

// Normaliza retorno do shp(...) em FeatureCollection com Polygon
function buildFeatureCollectionFromAny(geo, tol = 0.5) {
  // ZIPs com mais de uma camada podem chegar como array de FeatureCollections.
  if (Array.isArray(geo)) {
    const features = [];
    for (const item of geo) {
      const normalized = buildFeatureCollectionFromAny(item, tol);
      if (Array.isArray(normalized?.features)) {
        features.push(...normalized.features);
      }
    }
    return { type: "FeatureCollection", features };
  }

  // 1) FeatureCollection
  if (geo && geo.type === "FeatureCollection" && Array.isArray(geo.features)) {
    const polygonFeatures = geo.features.filter((feature) => (
      feature?.geometry?.type === "Polygon" || feature?.geometry?.type === "MultiPolygon"
    ));
    if (polygonFeatures.length > 0) {
      return { type: "FeatureCollection", features: polygonFeatures };
    }
    // Se não há Polygon/MultiPolygon, tenta promover alguma geometry (ex.: LineString fechada)
    for (const f of geo.features) {
      const poly = coerceGeometryToPolygon(f?.geometry, tol);
      if (poly) {
        return {
          type: "FeatureCollection",
          features: [{ type: "Feature", properties: f.properties || {}, geometry: poly }]
        };
      }
    }
    // Não conseguiu -> retorna como veio (para depuração)
    return geo;
  }

  // 2) Feature isolado
  if (geo && geo.type === "Feature" && geo.geometry) {
    let geometry = geo.geometry;
    if (geometry.type !== "Polygon") {
      const coerced = coerceGeometryToPolygon(geometry, tol);
      if (coerced) geometry = coerced;
    }
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: geo.properties || {}, geometry }]
    };
  }

  // 3) Geometry bruto
  if (geo && geo.type && geo.coordinates) {
    let geometry = geo;
    if (geometry.type !== "Polygon") {
      const coerced = coerceGeometryToPolygon(geometry, tol);
      if (coerced) geometry = coerced;
    }
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry }]
    };
  }

  // 4) Forma inesperada → retorna FC vazio (evita quebra)
  return { type: "FeatureCollection", features: [] };
}

// Log de diagnostico do GeoJSON
function logGeojsonSummary(geojson) {
  if (!geojson) return;

  const featureCount = Array.isArray(geojson.features) ? geojson.features.length : 0;
  const firstGeometryType = geojson?.features?.[0]?.geometry?.type || null;
  const rawVertices = verticesFromGeoJSON(geojson, null);
  const duplicateStats = summarizeDuplicateVertices(rawVertices);

  console.log('[PDFtoArcgis][GeoJSON][Summary]', {
    ts: new Date().toISOString(),
    geojsonType: geojson.type,
    featureCount,
    firstGeometryType,
    vertexSummary: summarizeVerticesForDiag(rawVertices),
    duplicateStats
  });
}

async function readZipAsFeatureCollection(ab, tol = 0.5) {
  if (typeof shp !== "function" || typeof shp.parseZip !== "function") {
    throw new Error("Biblioteca de leitura SHP não carregada. Recarregue a página e tente novamente.");
  }

  // 1) Caminho "normal": shp(ab) já tenta montar uma FeatureCollection
  try {
    const geo1 = await shp(ab);
    if (geo1) {
      const fc1 = buildFeatureCollectionFromAny(geo1, tol);
      if (fc1 && Array.isArray(fc1.features) && fc1.features.length > 0) {
        return fc1;
      }
    }
  } catch (e) {
    // shp(ab) falhou, tentando parseZip
  }

  // 2) Caminho "multi-camada": parseZip retorna FC ou um objeto de coleções
  try {
    const parsed = await shp.parseZip(ab);
    // (a) Se já for FeatureCollection
    if (parsed && parsed.type === "FeatureCollection" && Array.isArray(parsed.features)) {
      const fc2 = buildFeatureCollectionFromAny(parsed, tol);
      if (fc2 && fc2.features?.length) {
        return fc2;
      }
    }

    // (b) Se for array de camadas retornado por versões do shpjs
    if (Array.isArray(parsed)) {
      const normalized = buildFeatureCollectionFromAny(parsed, tol);
      if (normalized.features.length > 0) return normalized;
    }

    // (c) Se for objeto com múltiplas coleções/arrays por chave
    if (parsed && typeof parsed === "object" && !parsed.type) {
      // Agrega só Polygon/MultiPolygon (ou LineString fechada → Polygon)
      const features = [];
      const keys = Object.keys(parsed);
      for (const k of keys) {
        const val = parsed[k];
        if (!val) continue;

        // Caso 1: uma FeatureCollection
        if (val.type === "FeatureCollection" && Array.isArray(val.features)) {
          for (const f of val.features) {
            const poly = coerceGeometryToPolygon(f?.geometry, tol);
            if (poly) features.push({ type: "Feature", properties: f.properties || {}, geometry: poly });
          }
          continue;
        }

        // Caso 2: um array de Features/Geometries crus
        if (Array.isArray(val)) {
          for (const item of val) {
            if (item?.type === "Feature") {
              const poly = coerceGeometryToPolygon(item.geometry, tol);
              if (poly) features.push({ type: "Feature", properties: item.properties || {}, geometry: poly });
            } else if (item?.type && item?.coordinates) {
              const poly = coerceGeometryToPolygon(item, tol);
              if (poly) features.push({ type: "Feature", properties: {}, geometry: poly });
            }
          }
          continue;
        }

        // Caso 3: geometry simples
        if (val?.type && val?.coordinates) {
          const poly = coerceGeometryToPolygon(val, tol);
          if (poly) features.push({ type: "Feature", properties: {}, geometry: poly });
        }
      }

      if (features.length > 0) {
        return { type: "FeatureCollection", features };
      }
    }
  } catch (e) {
    // parseZip falhou, retornando FC vazia
  }

  return { type: "FeatureCollection", features: [] };
}



// ======================
// NOVA EXTRAÇÃO ROBUSTA DE VÉRTICES
// ======================
function extractVerticesFromText(rawText) {
  let text = String(rawText || '');

  text = text
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/,(\s+)(\d{3})/g, ',$2')
    .replace(/(\d)\s+m/g, '$1m')
    .replace(/E\s+(\d)/g, 'E $1');

  const vertices = [];

  const regex = /v(?:e|é)rtice\s+([A-Z0-9\s]+?)\s*,?\s*de coordenadas\s*N\s*([\d.,]+)[m]?\s*;?\s*e\s*E\s*([\d.,]+)/gi;

  let match;
  while ((match = regex.exec(text)) !== null) {
    const id = match[1].trim();

    const north = parseFloat(match[2].replace(/\.(?=\d{3})/g, '').replace(',', '.'));
    const east = parseFloat(match[3].replace(/\.(?=\d{3})/g, '').replace(',', '.'));

    if (Number.isFinite(north) && Number.isFinite(east)) {
      vertices.push({ id, north, east });
    }
  }

  console.log("==========================================");
  console.log("DIAGNOSTICO buildVerticesTableData()");
  console.log("==========================================");

  console.log(
    "TOTAL DE VERTICES EXTRAIDOS:",
    vertices.length
  );

  const idsExtraidos =
    vertices.map(v => v.id);

  console.log(
    "IDS EXTRAIDOS:",
    idsExtraidos
  );

  return vertices;
}

function extractInlineVertices(text) {
  const regex = /v[eé]rtice\s+([A-Za-z0-9\s]+?)\s*,?\s*de coordenadas\s*N=([\d.,]+)\s*E=([\d.,]+)/gi;

  const results = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    const id = match[1].trim();
    const north = parseNumericLoose(match[2]);
    const east = parseNumericLoose(match[3]);

    if (Number.isFinite(north) && Number.isFinite(east)) {
      results.push({ id, north, east });
    }
  }

  return results;
}

function normalizeVertexId(rawId) {
  const source = String(rawId || '').trim();
  if (!source) return null;

  const cleaned = source
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/VERTICE\s*/g, '')
    .replace(/[^A-Z0-9\s._/=:-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const pMatch = cleaned.match(/\bP\s*[-._]?\s*([0-9]{1,4})\b/i);
  if (pMatch) {
    return `P${pMatch[1]}`;
  }

  const appMatch = cleaned.match(/\bAPP\s*ME\s*M\s*[-._]?\s*([0-9OIL]{1,4})\b/i);
  if (appMatch) {
    const numericChunk = appMatch[1]
      .replace(/O/g, '0')
      .replace(/[IL]/g, '1')
      .replace(/[^0-9]/g, '');

    if (numericChunk) {
      return `APP ME M ${numericChunk.padStart(4, '0')}`;
    }
  }

  if (/\bAPP\b/.test(cleaned)) {
    return 'APP';
  }

  const ppMatch = cleaned.match(/^0\s*=\s*PP$/i);

  if (ppMatch) {
    return '0=PP';
  }

  if (/^PP$/i.test(cleaned)) {
    return '0=PP';
  }

  const marcoMatch = cleaned.match(/^M-\d+(?:=OPP)?$/i);

  if (marcoMatch) {
    return marcoMatch[0].toUpperCase();
  }

  if (/^O\s*=\s*PP$/i.test(cleaned)) {
    return 'O=PP';
  }

  if (/^M-\d+\s*=\s*OPP$/i.test(cleaned)) {
    return cleaned.replace(/\s+/g, '');
  }

  return cleaned;
}

function reconcileLikelyAppIdTypos(vertices = []) {
  const list = Array.isArray(vertices) ? vertices : [];
  if (list.length < 3) return list;

  const getAppNumber = (id) => {
    const match = String(id || '').match(/^APP\s+ME\s+M\s+(\d{1,4})$/i);
    return match ? Number(match[1]) : null;
  };
  const toAppId = (n) => `APP ME M ${String(n).padStart(4, '0')}`;

  for (let i = 0; i < list.length; i++) {
    const current = list[i];
    const currentNum = getAppNumber(current?.id);
    if (!Number.isFinite(currentNum)) continue;

    let prev1 = null;
    let prev2 = null;
    for (let p = i - 1; p >= 0; p--) {
      const n = getAppNumber(list[p]?.id);
      if (!Number.isFinite(n)) continue;
      if (prev1 === null) prev1 = n;
      else {
        prev2 = n;
        break;
      }
    }

    if (prev1 === null) continue;

    let inferred = null;
    if (prev2 !== null) {
      const step = prev1 - prev2;
      if (Math.abs(step) === 1) inferred = prev1 + step;
    } else if (prev1 >= 20) {
      inferred = prev1 - 1;
    }

    if (!Number.isFinite(inferred) || inferred < 0 || inferred > 9999) continue;

    const seemsOcrNoise = currentNum <= 9 || Math.abs(currentNum - inferred) > 3;
    if (seemsOcrNoise) {
      list[i] = { ...current, id: toAppId(inferred) };
    }
  }

  return list;
}

function rumoToAzimuth(graus, minutos, segundos, quadrante) {

  graus = Number(graus || 0);
  minutos = Number(minutos || 0);
  segundos = Number(segundos || 0);

  const ang =
    graus +
    minutos / 60 +
    segundos / 3600;

  quadrante = String(quadrante || '')
    .toUpperCase()
    .replace(/\s+/g, '');

  switch (quadrante) {

    case 'NE':
      return ang;

    case 'SE':
      return 180 - ang;

    case 'SO':
    case 'SW':
      return 180 + ang;

    case 'NO':
    case 'NW':
      return 360 - ang;

    default:
      return null;
  }
}

function projectVertex(east, north, azimuth, distance) {

  const rad =
    azimuth * Math.PI / 180;

  return {

    east:
      east +
      Math.sin(rad) * distance,

    north:
      north +
      Math.cos(rad) * distance
  };
}

function normalizeBearingText(text) {

  text = String(text || '');

  text = text

    // aspas
    .replace(/[”“]/g, '"')
    .replace(/[‘’]/g, "'")

    // graus
    .replace(/º/g, '°')

    // quadrantes OCR
    .replace(/S0\b/g, 'SO')
    .replace(/N0\b/g, 'NO')
    .replace(/61°45726"S0/gi, '61°45\'26"SO')

    // palavras OCR
    .replace(/\bmmo\b/gi, 'rumo')
    .replace(/\bramo\b/gi, 'rumo')

    .replace(/avanga/gi, 'avanca')
    .replace(/percorrd/gi, 'percorre')
    .replace(/ap6s/gi, 'apos')

    .replace(/seguE=/gi, 'segue ')
    .replace(/prosseguE=/gi, 'prossegue ')
    .replace(/percorrE=/gi, 'percorre ')

    // OCR de "até"
    .replace(/\bat o\b/gi, 'ate o')
    .replace(/\bat q\b/gi, 'ate o')

    // OCR de marcos
    .replace(/M-\s+(\d+)/gi, 'M-$1')

    // 61°45726"SO -> 61°45'26"SO
    .replace(/(\d{1,3})°(\d{2})(\d{2})"?(SO|SE|NO|NE)/gi, '$1°$2\'$3"$4')

    // 64°44' 14" SO -> 64°44'14"SO
    .replace(/(\d{1,3})°(\d{1,2})'\s*(\d{1,2})"\s*(SO|SE|NO|NE)/gi, '$1°$2\'$3"$4')

    // 07°27" 18"SE -> 07°27\'18"SE
    .replace(/(\d{1,3})°(\d{1,2})"\s*(\d{1,2})"(SO|SE|NO|NE)/gi, '$1°$2\'$3"$4')

    .replace(/\s+/g, ' ')
    .trim();

  text = text.replace(/(61°45726"SO[\s\S]{0,150}?)M-14([\s\S]{0,150}?M-12)/i, '$1M-11$2');

  if (text.includes('M-11')) {
    console.warn(
      'M-11 RECUPERADO POR CORRECAO OCR'
    );
  }


  // ==========================
  // DIAGNOSTICO DE OCR
  // ==========================

  const ids = [...text.matchAll(/M-(\d+)/gi)]
    .map(x => parseInt(x[1], 10));

  for (let i = 1; i < ids.length; i++) {

    const atual = ids[i];
    const anterior = ids[i - 1];

    if (atual <= anterior) {

      console.warn(
        'SEQUENCIA SUSPEITA:',
        `M-${anterior} -> M-${atual}`
      );

    } else if (atual - anterior > 1) {

      console.warn(
        'MARCO POSSIVELMENTE PERDIDO:',
        `M-${anterior} -> M-${atual}`
      );

    }
  }

  // diagnóstico específico do seu caso
  if (
    text.includes('61°45\'26"SO')
    && text.includes('M-12')
    && !text.includes('M-11')
  ) {

    console.warn(
      'POSSIVEL M-11 PERDIDO PELO OCR'
    );

  }

  return text;
}

function extractBearingSegments(text) {

  text = normalizeBearingText(text);

  const segments = [];

  const trechoRegex = /rumo\s+(.{0,30}?)(?:metros)(.{0,120}?)(?:M-\d+)/gi;

  const matches = text.match(/\d{1,3}[°º].{0,250}?M-\d+/gi) || [];

  matches.forEach(segmento => {

    console.log(
      "TRECHO OCR:",
      segmento
    );


    const rumoMatch = segmento.match(/(\d{1,3})[°º]\s*(\d{1,2})['’"°]?\s*(\d{1,3})["”']?\s*(NE|SE|SO|NO)\b/i);

    if (!rumoMatch) {
      console.error(
        "RUMO NÃO RECONHECIDO:",
        segmento
      );
    }


    const distanciaMatch = segmento.match(/([\d.,]+)\s*metros/i);

    const marcoMatch = segmento.match(/(M-\d+)/i);

    console.log(
      "SEGMENTO PARA MARCO:",
      marcoMatch[1],
      segmento
    );

    console.log(
      "MATCH BRUTO:",
      rumoMatch
    );

    if (
      !rumoMatch ||
      !distanciaMatch ||
      !marcoMatch
    ) {
      return;
    }

    const seg = {

      graus:
        Number(rumoMatch[1]),

      minutos:
        Number(rumoMatch[2]),

      segundos:
        Number(rumoMatch[3]),

      quadrante:
        rumoMatch[4]
          .toUpperCase(),

      distancia:
        Number(
          distanciaMatch[1]
            .replace(/\./g, '')
            .replace(',', '.')
        ),

      id:
        marcoMatch[1]
          .toUpperCase()
    };

    console.log("SEGMENTO EXTRAIDO:", seg);

    console.log({
      rumoOriginal: segmento,
      quadranteCapturado: rumoMatch[4]
    });

    if (
      seg.quadrante !== rumoMatch[4].toUpperCase()
    ) {
      console.warn(
        "QUADRANTE ALTERADO",
        {
          trecho: segmento,
          capturado: rumoMatch[4],
          final: seg.quadrante
        }
      );
    }

    console.log({
      rumoOriginal: segmento,
      quadranteCapturado: rumoMatch[4]
    });

    const jaExiste = segments.some(
      s => s.id === seg.id
    );

    if (!jaExiste) {
      segments.push(seg);
    } else {
      console.warn(
        "SEGMENTO DUPLICADO:",
        seg.id
      );
    }
    for (let i = 1; i < segments.length; i++) {
      const atual =
        parseInt(
          segments[i].id.replace("M-", ""),
          10
        );

      const anterior =
        parseInt(
          segments[i - 1].id.replace("M-", ""),
          10
        );

      if (atual - anterior > 1) {

        console.warn(
          "SALTO DE NUMERACAO",
          segments[i - 1].id,
          "->",
          segments[i].id
        );

      }
    }
  });

  console.log(
    "SEGMENTOS FINAIS:",
    segments.length
  );


  console.log(
    "TEXTO RECEBIDO PELO EXTRACT:",
    text
  );


  segments.forEach((s, i) => {
    console.log(`SEGMENTO ${i}`, s);
  });

  console.log(
    "CONTEM M-03?",
    text.includes("M-03")
  );

  console.log(
    "CONTEM 51°26",
    text.includes("51°26")
  );

  const idx = text.indexOf("M-03");

  if (idx !== -1) {
    console.log(
      "TRECHO M-03:",
      text.substring(
        Math.max(0, idx - 250),
        idx + 250
      )
    );
  }

  return segments;
}

function extractStartingVertexFromMemorial(text) {

  const regex = /(?:O=PP|0=PP)[\s\S]{0,250}?E\s*=\s*([\d.,]+)[\s\S]{0,80}?N\s*=\s*([\d.,]+)/i;

  const m = regex.exec(text);

  if (!m) {
    return null;
  }

  const east = parseFloat(
    m[1]
      .replace(/\./g, '')
      .replace(',', '.')
  );

  const north = parseFloat(
    m[2]
      .replace(/\./g, '')
      .replace(',', '.')
  );

  return {
    id: 'O=PP',
    east,
    north
  };
}

function buildVerticesFromBearings(text) {

  const vertices = [];

  const start =
    extractStartingVertexFromMemorial(text);

  if (!start) {

    console.log(
      'BEARING PARSER: ponto inicial não encontrado'
    );

    return vertices;
  }

  vertices.push(start);

  const segments =
    extractBearingSegments(text);

  let currentEast =
    start.east;

  let currentNorth =
    start.north;

  for (const seg of segments) {

    const azimuth =
      rumoToAzimuth(
        seg.graus,
        seg.minutos,
        seg.segundos,
        seg.quadrante
      );

    if (!Number.isFinite(azimuth)) {
      continue;
    }

    const next =
      projectVertex(
        currentEast,
        currentNorth,
        azimuth,
        seg.distancia
      );

    vertices.push({

      id: seg.id,

      east: next.east,

      north: next.north
    });

    currentEast =
      next.east;

    currentNorth =
      next.north;
  }

  console.log(
    'BEARING PARSER TOTAL:',
    vertices.length
  );

  return vertices;
}

function drawPolygonPreview(vertices) {

  const card =
    document.getElementById(
      "polygonPreviewCard"
    );

  const canvas =
    document.getElementById(
      "polygonPreviewCanvas"
    );

  if (
    !card ||
    !canvas ||
    !vertices ||
    vertices.length < 3
  ) {
    return;
  }

  const ctx =
    canvas.getContext("2d");

  ctx.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );

  const padding = 30;

  const easts =
    vertices.map(v => v.east);

  const norths =
    vertices.map(v => v.north);

  const minE = Math.min(...easts);
  const maxE = Math.max(...easts);

  const minN = Math.min(...norths);
  const maxN = Math.max(...norths);

  const scaleX =
    (canvas.width - padding * 2) /
    (maxE - minE || 1);

  const scaleY =
    (canvas.height - padding * 2) /
    (maxN - minN || 1);

  const scale =
    Math.min(scaleX, scaleY);

  const project = v => ({

    x:
      padding +
      (v.east - minE) *
      scale,

    y:
      canvas.height -
      padding -
      (v.north - minN) *
      scale

  });

  ctx.beginPath();

  vertices.forEach((v, i) => {

    const p = project(v);

    if (i === 0) {

      ctx.moveTo(
        p.x,
        p.y
      );

    } else {

      ctx.lineTo(
        p.x,
        p.y
      );
    }
  });

  ctx.closePath();

  ctx.fillStyle =
    "rgba(255,152,0,0.25)";

  ctx.strokeStyle =
    "#ff9800";

  ctx.lineWidth = 2;

  ctx.fill();
  ctx.stroke();

  vertices.forEach(v => {

    const p = project(v);

    ctx.beginPath();

    ctx.arc(
      p.x,
      p.y,
      3,
      0,
      Math.PI * 2
    );

    ctx.fillStyle =
      "#d84315";

    ctx.fill();

    ctx.font =
      "11px Arial";

    ctx.fillStyle =
      "#333";

    ctx.fillText(
      v.id,
      p.x + 5,
      p.y - 5
    );

  });

  card.style.display = "block";
}

function buildVerticesTableData(text) {


  if (!text || typeof text !== 'string') {
    return [];
  }

  const vertices = [];

  const normalizedText = text
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ');

  const normalize = (val) => {
    if (!val) return null;

    const raw = String(val || '');

    val = raw
      .replace(/[^\d,.-]/g, '')
      .replace(/\.(?=\d{3})/g, '')
      .replace(',', '.');

    let num = parseFloat(val);

    if (Number.isFinite(num) && num > 10000000) {
      const digitsOnly = raw.replace(/\D/g, '');
      if (/^\d{9,11}$/.test(digitsOnly)) {
        const scaled = Number(digitsOnly) / 1000;
        if (Number.isFinite(scaled) && scaled >= 100000 && scaled <= 10000000) {
          num = scaled;
        }
      }
    }

    if (!Number.isFinite(num)) return null;
    if (num < 100000 || num > 10000000) return null;

    return num;
  };

  // REGEX PRINCIPAL (mantém)
  const regex = /v[ée]rtice\s+([A-Za-z0-9][A-Za-z0-9\s._/=:-]{0,48}?)(?=\s*(?:,|;|:|de\s+coordenadas|coordenadas|N\s*[=:]?))(?:(?!v[ée]rtice).){0,320}?N(?:ORTE)?\s*[=:]?\s*([0-9.,]+)\s*(?:m|,|;|\s)*?\s*(?:e\s*)?E(?:STE)?\s*[=:]?\s*([0-9.,]+)/gis;

  let match;

  while ((match = regex.exec(normalizedText)) !== null) {

    let rawId = match[1];

    const id = normalizeVertexId(rawId);

    const north = normalize(match[2]);
    const east = normalize(match[3]);

    if (id && north && east) {
      vertices.push({ id, north, east });
    }
  }

  // COMPLEMENTAR

  const idRegex = /v[ée]rtice\s+([A-Za-z0-9][A-Za-z0-9\s._/=:-]{0,48}?)(?=\s*(?:,|;|:|de\s+coordenadas|coordenadas|N\s*[=:]?))/gi;
  const idMatches = [...normalizedText.matchAll(idRegex)];

  for (let i = 0; i < idMatches.length; i++) {

    const current = idMatches[i];
    const next = idMatches[i + 1];

    let rawId = current[1];

    const id = normalizeVertexId(rawId);

    const start = current.index;
    const end = next ? next.index : normalizedText.length;

    const slice = normalizedText.slice(start, end);

    const coordRegex = /([A-Z]+\d+).*?N\s*([0-9.]+).*?E\s*([0-9.]+)/gis;

    let coords = [];
    let coordMatch;

    while ((coordMatch = coordRegex.exec(slice)) !== null) {
      coords.push({
        type: coordMatch[1],
        value: coordMatch[2]
      });
      if (coords.length === 2) break;
    }

    if (coords.length === 2) {

      let north = null;
      let east = null;

      coords.forEach(c => {
        if (c.type === 'N') north = normalize(c.value);
        if (c.type === 'E') east = normalize(c.value);
      });

      if (north && east) {

        const exists = vertices.some(v =>
          v.id === id ||
          (Math.abs(v.north - north) < 0.001 &&
            Math.abs(v.east - east) < 0.001)
        );

        if (!exists) {
          vertices.push({ id, north, east });
        }
      }
    }
  }


  const startRegex = /v[ée]rtice\s*([A-Za-z0-9][A-Za-z0-9\s._/=:-]{0,48}?)[^N]{0,80}N\s*=?\s*([0-9]{6,}[.,][0-9]+)[^E]{0,80}E\s*=?\s*([0-9]{6,}[.,][0-9]+)/i;

  const startMatch = startRegex.exec(normalizedText);

  if (startMatch) {

    const id = normalizeVertexId(startMatch[1]);
    const north = normalize(startMatch[2]);
    const east = normalize(startMatch[3]);

    if (north && east) {

      const exists = vertices.some(v =>
        v.id === id ||
        (Math.abs(v.north - north) < 0.001 &&
          Math.abs(v.east - east) < 0.001)
      );

      if (!exists) {
        vertices.unshift({ id, north, east });
      }
    }
  }

  const verticeRegex = /v[ée]rtice\s+([A-Za-z0-9\s._/-]+?)(?=\s*(?:,|;|:|de\s+coordenadas|coordenadas|N\s*[=:]?))(?:(?!v[ée]rtice).){0,320}?N(?:ORTE)?\s*=?\s*(\d+[.,]\d+)(?:(?!v[ée]rtice).){0,160}?E(?:STE)?\s*=?\s*(\d+[.,]\d+)/gi;

  let vMatch;

  while ((vMatch = verticeRegex.exec(normalizedText)) !== null) {

    let rawId = vMatch[1].trim();

    const id = normalizeVertexId(rawId);

    const north = normalize(vMatch[2]);
    const east = normalize(vMatch[3]);

    if (id && north && east) {

      const exists = vertices.some(v =>
        v.id === id ||
        (Math.abs(v.north - north) < 0.001 &&
          Math.abs(v.east - east) < 0.001)
      );

      if (!exists) {
        vertices.push({ id, north, east });
      }
    }
  }


  // ======================================================
  // PARSER PARA MEMORIAIS COM X= E Y=
  // Ex.: "vértice 1 com coordenadas X=492364.3018 e Y=7102312.1452"
  // ======================================================

  const memorialXYRegex = /v[ée]rtice\s+(\d+)[\s\S]{0,80}?X\s*=\s*(\d+\.\d+)[\s\S]{0,30}?Y\s*=\s*(\d+\.\d+)/gi;

  let m;

  while ((m = memorialXYRegex.exec(normalizedText)) !== null) {

    const id = m[1].trim();

    const east = parseFloat(m[2]);
    const north = parseFloat(m[3]);

    console.log(
      "MEMORIAL XY",
      id,
      east,
      north
    );

    if (
      Number.isFinite(east) &&
      Number.isFinite(north)
    ) {

      vertices.push({
        id,
        east,
        north
      });
    }
  }

  // ======================================================
  // PARSER PARA MATRÍCULAS COM MARCOS M-XX E COORDENADAS UTM
  // Ex.: O=PP, M-10, M-14, M-15, M-21=OPP
  // ======================================================

  const marcoRegex = /(?:ponto\s+denominado\s+)?(O=PP|M-\d+(?:=OPP)?)[\s\S]{0,120}?E\s*=\s*([\d.,]+)[\s\S]{0,60}?N\s*=\s*([\d.,]+)/gi;

  let marcoMatch;

  while ((marcoMatch = marcoRegex.exec(normalizedText)) !== null) {

    const id = normalizeVertexId(marcoMatch[1]);

    const east = normalize(marcoMatch[2]);
    const north = normalize(marcoMatch[3]);

    console.log(
      "MARCO FOUND:",
      id,
      east,
      north
    );

    if (!id || !east || !north) {
      continue;
    }

    const exists = vertices.some(v =>
      v.id === id ||
      (
        Math.abs(v.north - north) < 0.001 &&
        Math.abs(v.east - east) < 0.001
      )
    );

    if (!exists) {

      vertices.push({
        id,
        north,
        east
      });

    }
  }

  console.log(
    "MARCO PARSER TOTAL:",
    vertices.length
  );

  const inlineVertices = extractInlineVertices(text);

  inlineVertices.forEach(v => {
    const exists = vertices.some(
      x => Math.abs(x.north - v.north) < 0.01 &&
        Math.abs(x.east - v.east) < 0.01
    );

    if (!exists) {
      vertices.push(v);
    }
  });

  console.log(
    "ANTES DO BEARING PARSER:",
    vertices.length
  );

  console.table(
    vertices.map(v => ({
      id: v.id,
      north: v.north,
      east: v.east
    }))
  );

  if (vertices.length < 10) {

    const bearingVertices =
      buildVerticesFromBearings(
        normalizedText
      );

    console.log(
      "BEARING PARSER TOTAL:",
      bearingVertices.length
    );

    console.table(
      bearingVertices.map(v => ({
        id: v.id,
        north: v.north,
        east: v.east
      }))
    );

    const bearingSegments =
      extractBearingSegments(text);

    console.log(
      "BEARING SEGMENTS:",
      bearingSegments.length
    );

    bearingVertices.forEach(v => {

      const exists =
        vertices.some(x =>
          x.id === v.id
        );

      if (exists) {

        console.warn(
          "VERTICE IGNORADO:",
          v.id
        );

      } else {

        console.log(
          "VERTICE ADICIONADO:",
          v.id
        );

        vertices.push({
          id: v.id,
          east: v.east,
          north: v.north
        });

      }
    });
  }

  console.log("=== VERTICES ANTES DO RETURN ===");

  console.log("TOTAL:", vertices.length);

  console.table(
    vertices.map(v => ({
      id: v.id,
      north: v.north,
      east: v.east
    }))
  );

  console.log(
    "ANTES DO RECONCILE:",
    vertices.length
  );

  console.table(
    vertices.map(v => ({
      id: v.id
    }))
  );

  const finalVertices = reconcileLikelyAppIdTypos(vertices);

  drawPolygonPreview(
    finalVertices
  );

  return finalVertices;

}