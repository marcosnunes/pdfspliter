// Selects either selectable text or OCR per page
async function getBestPageText(pdfPage, pageNum, pdfjsLib, ocrCanvasFn) {
  // 1. Extract selectable text
  let selectableText = "";
  try {
    const textContent = await pdfPage.getTextContent();
    selectableText = buildPageTextWithLines(textContent);
  } catch (e) {
    selectableText = "";
  }

  // 2. Heuristic: is text sufficient? (min. 30 chars and coordinate pattern)
  const hasCoords = /\b(E|X)\s*=?\s*[0-9]{4,}/i.test(selectableText) && /\b(N|Y)\s*=?\s*[0-9]{5,}/i.test(selectableText);
  const isTextSufficient = (selectableText && selectableText.replace(/\s+/g, "").length > 30 && hasCoords);

  if (isTextSufficient) {
    displayLogMessage(`[LogUI] Página ${pageNum}: Usando texto selecionável (PDF.js)`);
    return { text: selectableText, method: "selectable" };
  }

  // 3. Fallback: OCR (Android/Tesseract.js)
  let ocrText = "";
  try {
    if (window.Android && window.Android.performOCR) {
      // Android bridge
      ocrText = await window.Android.performOCR(pageNum);
    } else if (ocrCanvasFn) {
      // Browser: render canvas and OCR
      const canvas = await ocrCanvasFn(pdfPage);
      ocrText = await getOcrTextFromCanvas(canvas);
    }
  } catch (e) {
    ocrText = "";
  }
  const hasOcrCoords = /\b(E|X)\s*=?\s*[0-9]{4,}/i.test(ocrText) && /\b(N|Y)\s*=?\s*[0-9]{5,}/i.test(ocrText);
  const isOcrSufficient = (ocrText && ocrText.replace(/\s+/g, "").length > 30 && hasOcrCoords);

  if (isOcrSufficient) {
    displayLogMessage(`[LogUI] Página ${pageNum}: Usando OCR (${window.Android ? "Android" : "Tesseract.js"})`);
    return { text: ocrText, method: "ocr" };
  }

  // 4. If both fail, return the longest available text
  const bestText = (ocrText.length > selectableText.length) ? ocrText : selectableText;
  displayLogMessage(`[LogUI] Página ${pageNum}: Texto insuficiente, usando o mais longo disponível.`);
  return { text: bestText, method: (ocrText.length > selectableText.length ? "ocr_fallback" : "selectable_fallback") };
}

// Render page to canvas for OCR (browser)
async function renderPageToCanvas(pdfPage) {
  const viewport = pdfPage.getViewport({ scale: 2.0 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  await pdfPage.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}
// UI: Sidenav and scroll to results
function openNav() { document.getElementById("mySidenav").style.width = "250px"; }
function closeNav() { document.getElementById("mySidenav").style.width = "0"; }
function scrollToResults() {
  const box = document.getElementById("resultBox");
  if (box && box.style.display !== "none") box.scrollIntoView({ behavior: "smooth", block: "start" });
}

// PDF.js worker for local/Android
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";

// UI elements and global variables
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

const docSelectorBox = document.getElementById("docSelectorBox");
const docSelect = document.getElementById("docSelect");
const docMeta = document.getElementById("docMeta");

let extractedCoordinates = [];
let fileNameBase = "coordenadas_extracao";
let pdfOrigemNomeBase = "";
let pdfOrigemSrc = "";

// Results per document: [{docId, pages, projectionKey, ...}]
let documentsResults = [];
let activeDocIndex = -1;

// Supported projections
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
  },

  LOCAL_M: {
    name: "Local Engineering (metres)",
    epsg: "", // no EPSG
    wkt: 'LOCAL_CS["PDF2ArcGIS_Local_M",UNIT["metre",1.0]]'
  }

};

function buildRelativePolygonFromAzimuths(segments) {
  const verts = [];
  let E = 0, N = 0;
  verts.push({ id: 'V001', east: E, north: N });
  for (let i = 0; i < segments.length; i++) {
    const { azimuth, distance } = segments[i] || {};
    if (!Number.isFinite(azimuth) || !Number.isFinite(distance) || distance <= 0) continue;
    const rad = azimuth * Math.PI / 180;
    E += distance * Math.sin(rad);
    N += distance * Math.cos(rad);
    verts.push({ id: `V${String(i + 2).padStart(3, '0')}`, east: E, north: N });
  }
  return verts;
}

function anchorRelativePolygon(vertsRel, seed) {
  if (!Array.isArray(vertsRel) || !vertsRel.length || !seed) return [];
  const dE = seed.east - vertsRel[0].east;
  const dN = seed.north - vertsRel[0].north;
  return vertsRel.map((v, i) => ({
    ...v,
    east: +(v.east + dE),
    north: +(v.north + dN),
    ordem: i + 1
  }));
}

function findSeedCandidates(fullText, parsedEN = []) {
  // 1) Ponto do parser EN (se existir)
  if (Array.isArray(parsedEN) && parsedEN.length >= 1) {
    const v = parsedEN[0];
    if (Number.isFinite(v.east) && Number.isFinite(v.north))
      return [{ east: v.east, north: v.north, source: 'EN_parser' }];
  }
  // 2) EN solto no texto
  const rxEN1 = /E\s*=?\s*([0-9\.,]{5,})\s*m?\s*e\s*N\s*=?\s*([0-9\.,]{6,})\s*m?/i;
  const m1 = rxEN1.exec(fullText || "");
  if (m1) {
    const east = parseFloat(String(m1[1]).replace(',', '.'));
    const north = parseFloat(String(m1[2]).replace(',', '.'));
    if (Number.isFinite(east) && Number.isFinite(north))
      return [{ east, north, source: 'EN_text' }];
  }
  // 3) Lat/Lon → UTM (usa seus patches)
  try {
    const ll = window.__pdf2gis_patch?.parseLatLonPairs?.(fullText) || [];
    if (ll.length >= 1) {
      const utm = window.__pdf2gis_patch?.convertLatLonPairsToUtm?.([ll[0]], null) || [];
      if (utm.length === 1)
        return [{ east: utm[0].east, north: utm[0].north, source: 'LatLon' }];
    }
  } catch (_) { }
  return [];
}

/* =======================================================================
   PATCH: Robust extraction (E/N, Lat/Lon, Azimuth+Distance) → UTM (SIRGAS 2000)
   Purpose:
   - Recognize coordinates in E/N, Latitude/Longitude (DMS and decimal),
     and also "Azimuth + Distance" only, reconstructing vertices.
   - Convert everything to UTM (SIRGAS 2000, correct zone).
   - Keep a single geometry per document (no multipolygons),
     compatible with OCR (Tesseract) and direct extraction.
   Integrations this patch uses/extends:
   - detectProjectionFromText, inferCrsByCoordinates, PROJECTIONS, validatePolygonTopology,
     calcularAzimute, calcularDistancia, documentsResults, getActiveProjectionKey, etc.
   ======================================================================= */

/* ---------- GEO/Angle Utilities ---------- */
(function () {
  const DEG2RAD = Math.PI / 180;
  const RAD2DEG = 180 / Math.PI;

  function toRadians(deg) { return deg * DEG2RAD; }
  function toDegrees(rad) { return rad * RAD2DEG; }

  /* DMS → decimal. hemisphere: 'N','S','E','W' or explicit sign */
  function dmsToDecimal(deg, min = 0, sec = 0, hemisphere = null) {
    let sign = 1;
    if (typeof deg === 'string') deg = deg.replace(',', '.');
    if (typeof min === 'string') min = min.replace(',', '.');
    if (typeof sec === 'string') sec = sec.replace(',', '.');

    deg = parseFloat(deg || 0);
    min = parseFloat(min || 0);
    sec = parseFloat(sec || 0);
    if (Number.isNaN(deg) || Number.isNaN(min) || Number.isNaN(sec)) return NaN;

    let val = Math.abs(deg) + (Math.abs(min) / 60) + (Math.abs(sec) / 3600);

    const hem = (hemisphere || '').toUpperCase().trim();
    if (hem === 'S' || hem === 'W') sign = -1;
    if (deg < 0) sign = -1;

    return sign * val;
  }

  /* Convert lat/lon (degrees) → UTM using proj4 if available; else return null */
  function latLonToUtm(lat, lon, targetProjectionKey) {
    try {
      const zone = getUtmZoneFromLon(lon);
      const key = targetProjectionKey || `SIRGAS2000_${zone}S`;
      const wkt = PROJECTIONS[key]?.wkt || null;
      if (typeof proj4 === 'function' && wkt) {
        // proj4 accepts WKT? In many builds, uses proj string/epsg. Prefer EPSG when possible.
        const def = PROJECTIONS[key].epsg || wkt;
        const p = proj4('EPSG:4326', def, [lon, lat]);
        return { east: p[0], north: p[1], projectionKey: key };
      }
    } catch (e) {
      console.warn('[PDFtoArcgis] latLonToUtm falhou:', e);
    }
    return null;
  }

  function getUtmZoneFromLon(lon) {
    // Default UTM zone
    return Math.floor((lon + 180) / 6) + 1;
  }

  /* ---------- Reconstruction by Azimuth/Bearing + Distance ---------- */

  // Normalize numeric text tolerant to OCR errors (reuse if exists in script)
  const _normalizeNumber =
    (typeof normalizeNumber === 'function')
      ? normalizeNumber
      : (raw) => {
        if (!raw) return raw;
        let v = String(raw);
        v = v.replace(/\u00A0/g, ' ').replace(/[\s\t]+/g, '');
        v = v.replace(/[Oo]/g, '0').replace(/[lI]/g, '1');
        if (v.includes(',') && !v.includes('.')) {
          v = v.replace(',', '.');
        } else if (v.includes(',') && v.includes('.')) {
          const lastCommaIdx = v.lastIndexOf(',');
          const lastDotIdx = v.lastIndexOf('.');
          if (lastCommaIdx > lastDotIdx) v = v.replace(/\./g, '').replace(',', '.');
          else v = v.replace(/,/g, '');
        }
        return v;
      };

  /* ---------- Azimuth/Distance Extraction (sentence + proximity) ---------- */
  function extractAzimuthDistanceFromText_Patch(text) {
    const out = [];

    const t = (text || '')
      .replace(/\u00A0/g, ' ')
      .replace(/[–—]/g, '-')     // hifens especiais → '-'
      .replace(/\s+/g, ' ');

    // 1) Azimute absoluto: 000°00'00" (min/seg opcionais)
    const rxAzAbs =
      /(?:azimute|rumo)?\s*([0-9]{1,3})[°º]?\s*(?:(\d{1,2})[’'′])?\s*(?:(\d{1,2})["”″])?\s*(?:graus)?\s*(?:no|em)?\s*(?:azimute|rumo)?\b(?!\s*(N|S)\s*(E|W|O|L))/gi;

    // 2) Rumo com quadrante (NE/NW/SE/SW; aceita O/L por OCR)
    const rxAzQuad =
      /(?:azimute|rumo)?\s*([0-9]{1,3})[°º]?\s*(?:(\d{1,2})[’'′])?\s*(?:(\d{1,2})["”″])?\s*(N|S)\s*(E|W|O|L)/gi;

    // 3) Distâncias (m) e variações
    const rxDist =
      /(?:dist[aâ]ncia(?:\s+de)?|extens[aã]o(?:\s+de)?|e\s+dist[aâ]ncia(?:\s+de)?|,)\s*([0-9]{1,5}(?:[.,][0-9]{1,3})?)\s*m\b/gi;

    // ---------- A) Coleta por "sentença" (como você já fazia)
    const chunks = t.split(/(?:(?:;)|(?:\.\s)|(?:\n)|(?:, e\b))/i);
    for (const ch of chunks) {
      let azAbs = null, azQuad = null, dist = null;

      // Rumo com quadrante
      let mQuad = rxAzQuad.exec(ch);
      if (mQuad) {
        const deg = parseInt(mQuad[1] || '0', 10);
        const min = parseInt(mQuad[2] || '0', 10);
        const sec = parseInt(mQuad[3] || '0', 10);
        const hemiNS = (mQuad[4] || '').toUpperCase();
        let hemiEW = (mQuad[5] || '').toUpperCase();
        if (hemiEW === 'O' || hemiEW === 'L') hemiEW = (hemiEW === 'O') ? 'W' : 'E';
        const theta = deg + (min / 60) + (sec / 3600);

        // NθE → θ ; SθE → 180-θ ; SθW → 180+θ ; NθW → 360-θ
        let az = 0;
        if (hemiNS === 'N' && hemiEW === 'E') az = theta;
        else if (hemiNS === 'S' && hemiEW === 'E') az = 180 - theta;
        else if (hemiNS === 'S' && hemiEW === 'W') az = 180 + theta;
        else if (hemiNS === 'N' && hemiEW === 'W') az = 360 - theta;
        if (az < 0) az += 360;
        if (az >= 360) az -= 360;
        azQuad = az;
      } else {
        // Azimute absoluto
        let mAbs = rxAzAbs.exec(ch);
        if (mAbs) {
          const deg = parseInt(mAbs[1] || '0', 10);
          const min = parseInt(mAbs[2] || '0', 10);
          const sec = parseInt(mAbs[3] || '0', 10);
          const az = deg + (min / 60) + (sec / 3600);
          azAbs = (az % 360);
        }
      }

      // Distância na mesma sentença
      let mDist = rxDist.exec(ch);
      if (mDist) dist = parseFloat(_normalizeNumber(mDist[1]));

      // Se achou ambos na sentença
      const az = (azQuad != null) ? azQuad : azAbs;
      if (Number.isFinite(az) && Number.isFinite(dist) && dist > 0) {
        out.push({ azimuth: az, distance: dist });
      }

      // Reset índices
      rxAzQuad.lastIndex = rxAzAbs.lastIndex = rxDist.lastIndex = 0;
    }

    // ---------- B) Emparelhamento por PROXIMIDADE (varre o texto inteiro)
    // “Casa” o 1º valor de distância à direita do azimute, dentro de uma janela local
    const rxAzAll =
      /([0-9]{1,3})[°º]?\s*(?:([0-9]{1,2})[’'′])?\s*(?:([0-9]{1,2})["”″])?/g;
    const rxDAll = /([0-9]{1,5}(?:[.,][0-9]{1,3})?)\s*m\b/gi;

    const azAll = [], dAll = [];
    let m;
    while ((m = rxAzAll.exec(t)) !== null) {
      const deg = parseInt(m[1] || '0', 10);
      const min = parseInt(m[2] || '0', 10);
      const sec = parseInt(m[3] || '0', 10);
      if (deg <= 360) azAll.push({ idx: m.index, az: deg + (min / 60) + (sec / 3600) });
    }
    while ((m = rxDAll.exec(t)) !== null) {
      const val = parseFloat(String(m[1]).replace(',', '.'));
      if (val > 0.1 && val < 10000) dAll.push({ idx: m.index, d: val });
    }

    const WIN = 120; // janela local (~linhas vizinhas)
    for (const a of azAll) {
      const d = dAll.find(x => x.idx >= a.idx && (x.idx - a.idx) <= WIN);
      if (d) out.push({ azimuth: a.az, distance: d.d });
    }

    return out;
  }


  // === LOG++ D: Decorator extractAzimuthDistanceFromText_Patch ===================
  (function () {
    if (!window.__pdf2gis_patch?.extractAzimuthDistanceFromText_Patch || window.__azDistDecorated) return;
    const original = window.__pdf2gis_patch.extractAzimuthDistanceFromText_Patch;

    window.__pdf2gis_patch.extractAzimuthDistanceFromText_Patch = function (text) {
      const segs = original.call(this, text) || [];
      const n = segs.length;
      __log.group('[extractAzimuthDistance]');
      __log.log('azdist', 'Segmentos detectados', n);
      if (n < 2) {
        __log.warn('azdist', 'Insuficiente para reconstrução (precisa >=2). Head(300)', (text || '').slice(0, 300));
      } else {
        __log.log('azdist', 'Amostra(3)', segs.slice(0, 3));
      }
      __log.groupEnd();
      return segs;
    };

    window.__azDistDecorated = true;
  })();


    /* Given a seed point (E/N) and a list of segments {azimuth, distance},
      reconstructs successive vertices (azimuth measured from North, clockwise). */
  function buildVerticesFromAzimuths(seedEN, segments) {
    const verts = [];
    if (!seedEN || !Number.isFinite(seedEN.east) || !Number.isFinite(seedEN.north)) return verts;
    let currE = seedEN.east;
    let currN = seedEN.north;
    // Incluir vértice inicial
    verts.push({ id: `V${String(1).padStart(3, '0')}`, east: currE, north: currN });

    for (let i = 0; i < segments.length; i++) {
      const { azimuth, distance } = segments[i];
      if (!Number.isFinite(azimuth) || !Number.isFinite(distance) || distance <= 0) continue;
      // Azimute geodésico medido a partir do Norte (0°), aumentando para Leste (sentido horário):
      const azRad = toRadians(azimuth);
      // Incrementos UTM
      const dE = distance * Math.sin(azRad);
      const dN = distance * Math.cos(azRad);
      currE += dE;
      currN += dN;
      const vId = `V${String(i + 2).padStart(3, '0')}`;
      verts.push({ id: vId, east: currE, north: currN });
    }
    return verts;
  }

  /* ---------- Extraction of Latitude/Longitude (DMS and decimal, OCR-tolerant) ---------- */
  function parseLatLonPairs(text) {
    const found = [];

    const s = (text || '')
      .replace(/\u00A0/g, ' ')
      .replace(/[–—]/g, '-')
      .replace(/[,;]/g, ',')
      .replace(/\s+/g, ' ');

    // Decimal pattern with mixed signs and separators (lon, lat)
    const rxDecLoose = /(-?\d{1,3}[.,]\d+)[^0-9\-+]{0,20}(-?\d{1,2}[.,]\d+)/g;

    // More permissive DMS (°, ', " optional, may be replaced by similar characters in OCR)
    const rxDmsLoose = /(-?\d{1,3})\D{0,3}(\d{1,2})\D{0,3}(\d{1,2}(?:[.,]\d+)?)[^\w]{0,10}([NnSsWwOoLl])/g;

    // 1) SIGEF line: "Longitude -50°43'12,738" ... "Latitude -24°04'28,579" (order Lon, Lat)
    const rxSigefRow = /\b(?:lon(?:gitude)?)[^\d\-+]*([\-+]?\d{1,3})[°º]?\s*(\d{1,2})[’'′]?\s*(\d{1,2}(?:[\.,]\d+)?)["”″]?\s+.*?\b(?:lat(?:itude)?)[^\d\-+]*([\-+]?\d{1,2})[°º]?\s*(\d{1,2})[’'′]?\s*(\d{1,2}(?:[\.,]\d+)?)["”″]?/gi;

    // 2) Loose DMS with explicit hemisphere: 24°04'28,579" S ; 50°43'12,738" W (or O/L)
    const rxDmsHemi = /([\-+]?\d{1,3})[°º]\s*(\d{1,2})[’'′]?\s*(\d{1,2}(?:[\.,]\d+)?)["”″]?\s*([NnSsEeWwOoLl])/g;

    // 3) Named decimals "Latitude: -24.0 ... Longitude: -50.0"
    const rxDecNamed = /\b(?:latitude)\s*[:=]?\s*([\-+]?\d{1,2}(?:[.,]\d+)?)[°º]?\b.*?\b(?:longitude)\s*[:=]?\s*([\-+]?\d{1,3}(?:[.,]\d+)?)[°º]?\b/gi;

    // 4) Decimals with labels "Lat ... Lon ..."
    const rxDecPair = /\b(?:lat(?:itude)?)[^\d\-+]*([\-+]?\d{1,2}(?:[.,]\d+)?)\b[^\d\-+]+(?:lon(?:gitude)?)[^\d\-+]*([\-+]?\d{1,3}(?:[.,]\d+)?)\b/gi;

    // 5) Paired DMS (no words) in order "Lon , Lat"
    const rxDmsLonLat = /([\-+]?\d{1,3})[°º]\s*(\d{1,2})[’'′]?\s*(\d{1,2}(?:[\.,]\d+)?)["”″]?\s+[,\s;]+\s*([\-+]?\d{1,2})[°º]\s*(\d{1,2})[’'′]?\s*(\d{1,2}(?:[\.,]\d+)?)["”″]?/gi;

    // 6) NEW — DMS without symbols (OCR lost ° ' "): "24 04 28,579 S ... 50 43 12,738 W"
    const rxDmsNoMarks = /([\-+]?\d{1,3})\s+(\d{1,2})\s+(\d{1,2}(?:[.,]\d{1,3})?)\s*([NnSs])[^0-9\-+]+([\-+]?\d{1,3})\s+(\d{1,2})\s+(\d{1,2}(?:[.,]\d{1,3})?)\s*([EeWwOoLl])/g;

    // (1) SIGEF
    let m1; while ((m1 = rxSigefRow.exec(s)) !== null) {
      const lon = dmsToDecimal(m1[1], m1[2], m1[3], 'W');
      const lat = dmsToDecimal(m1[4], m1[5], m1[6], 'S');
      if (Number.isFinite(lat) && Number.isFinite(lon)) found.push({ lat, lon });
    }

    // (3) Named decimals
    let m3; while ((m3 = rxDecNamed.exec(s)) !== null) {
      const lat = parseFloat(_normalizeNumber(m3[1]));
      const lon = parseFloat(_normalizeNumber(m3[2]));
      if (Number.isFinite(lat) && Number.isFinite(lon)) found.push({ lat, lon });
    }

    // (4) Decimals with labels
    let m4; while ((m4 = rxDecPair.exec(s)) !== null) {
      const lat = parseFloat(_normalizeNumber(m4[1]));
      const lon = parseFloat(_normalizeNumber(m4[2]));
      if (Number.isFinite(lat) && Number.isFinite(lon)) found.push({ lat, lon });
    }

    // (5) Paired DMS (Lon, Lat)
    let m5; while ((m5 = rxDmsLonLat.exec(s)) !== null) {
      const lon = dmsToDecimal(m5[1], m5[2], m5[3], 'W');
      const lat = dmsToDecimal(m5[4], m5[5], m5[6], 'S');
      if (Number.isFinite(lat) && Number.isFinite(lon)) found.push({ lat, lon });
    }

    // (2) Loose DMS + (6) DMS without symbols — pair by proximity
    const dmsHits = [];
    let m2; while ((m2 = rxDmsHemi.exec(s)) !== null) {
      const val = dmsToDecimal(m2[1], m2[2], m2[3], (m2[4] || '').toUpperCase());
      const isLat = /[NnSs]/.test(m2[4] || '');
      dmsHits.push({ isLat, val, idx: m2.index });
    }
    let m6; while ((m6 = rxDmsNoMarks.exec(s)) !== null) {
      // lat blocks 1..4 / lon blocks 5..8 (adjust O/L → W/E)
      let lat = dmsToDecimal(m6[1], m6[2], m6[3], m6[4]);
      let lon = dmsToDecimal(m6[5], m6[6], m6[7], m6[8]);
      const hemEW = String(m6[8] || '').toUpperCase();
      if (hemEW === 'O') lon = -Math.abs(Math.abs(lon)); // 'O' (Oeste) means West
      if (hemEW === 'L') lon = Math.abs(Math.abs(lon));  // 'L' (Leste) means East
      if (Number.isFinite(lat) && Number.isFinite(lon)) found.push({ lat, lon });
    }

    // Pairing loose DMS
    dmsHits.sort((a, b) => a.idx - b.idx);
    for (let i = 0; i < dmsHits.length - 1; i++) {
      const a = dmsHits[i], b = dmsHits[i + 1];
      if (a && b && a.isLat !== b.isLat) {
        const lat = a.isLat ? a.val : b.val;
        const lon = a.isLat ? b.val : a.val;
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          found.push({ lat, lon });
          i++; // skip the paired neighbor
        }
      }
    }

    return found;
  }


    /* Converts a set of Lat/Lon pairs to UTM (SIRGAS2000_zoneS).
      If the zone is not explicit, infers from the mean longitude. */
  function convertLatLonPairsToUtm(latlonList, projectionKeyHint) {
    if (!Array.isArray(latlonList) || latlonList.length === 0) return [];
    // If a "WGS84" hint is given, map to SIRGAS 2000 zone by mean longitude.
    let targetKey = projectionKeyHint;
    if (!targetKey || targetKey === 'WGS84') {
      const meanLon = latlonList.reduce((s, p) => s + p.lon, 0) / latlonList.length;
      const zone = getUtmZoneFromLon(meanLon);
      targetKey = `SIRGAS2000_${zone}S`;
    }
    const out = [];
    for (let i = 0; i < latlonList.length; i++) {
      const { lat, lon } = latlonList[i] || {};
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const utm = latLonToUtm(lat, lon, targetKey);
      if (utm) out.push({ id: `V${String(i + 1).padStart(3, '0')}`, east: utm.east, north: utm.north });
    }
    return out;
  }

  /* ---------- Robust assembly of vertices from text ---------- */

  function ensureSingleRing(vertices) {
    // Ensures only one "main" ring (largest area) per document.
    if (!Array.isArray(vertices) || vertices.length < 3) return vertices;
    // Here we assume vertices as a single ring; if the first is repeated at the end, keep it.
    // If previous flows bring multiple concatenated rings, this function should separate them.
    // For simplicity (and to avoid breaking the UI), just return as is.
    return vertices;
  }

  // New: X/Y → treat as UTM (X≈E, Y≈N) when UTM/datum context is present
  function parseXyPairs(text) {
    const out = [];
    const s = (text || "").replace(/\u00A0/g, ' ').replace(/\s+/g, ' ');
    // X=..., Y=... (any order). Ex.: "X=693.718,072 ; Y=7.186.725,466"
    const rxXY = /(X)\s*=?\s*([0-9\.,]{5,})\s*(?:m)?[^A-Za-z0-9]{0,10}(Y)\s*=?\s*([0-9\.,]{6,})\s*(?:m)?/gi;
    const rxYX = /(Y)\s*=?\s*([0-9\.,]{6,})\s*(?:m)?[^A-Za-z0-9]{0,10}(X)\s*=?\s*([0-9\.,]{5,})\s*(?:m)?/gi;
    const asNum = v => parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
    let m;
    while ((m = rxXY.exec(s)) !== null) {
      const E = asNum(m[2]); const N = asNum(m[4]);
      if (Number.isFinite(E) && Number.isFinite(N)) out.push({ east: E, north: N, origem: 'XY' });
    }
    while ((m = rxYX.exec(s)) !== null) {
      const N = asNum(m[2]); const E = asNum(m[4]);
      if (Number.isFinite(E) && Number.isFinite(N)) out.push({ east: E, north: N, origem: 'YX' });
    }
    return out;
  }


    /* Wraps all logic: tries E/N; if insufficient, tries Lat/Lon; if still insufficient,
      tries to reconstruct via Azimuth/Bearing + Distance if at least one seed point exists. */
  function parseVerticesEnhanced(text, crsKeyInput) {
    const crsKeyDetected = (typeof getActiveProjectionKey === 'function') ? getActiveProjectionKey() : (crsKeyInput || 'SIRGAS2000_22S');

    // 1) Try the original parser (E/N), if it exists
    const hasOriginal = (typeof window.parseVertices === 'function') && !window.__parseVertices_isPatched;
    const originalRef = hasOriginal ? window.parseVertices : null;
    let vertices = [];
    try {
      if (originalRef) {
        vertices = originalRef.call(window, text, crsKeyDetected) || [];
      }
    } catch (e) {
      console.warn('[PDFtoArcgis] parseVertices (original) falhou:', e);
      vertices = [];
    }

    // If we already have 3+ UTM vertices, validate and return
    if (Array.isArray(vertices) && vertices.length >= 3) {
      return ensureSingleRing(vertices);
    }

    // 2) Try Lat/Lon (DMS/decimal) → UTM
    const latlon = parseLatLonPairs(text);
    if (latlon.length >= 3) {
      const utmVerts = convertLatLonPairsToUtm(latlon, crsKeyDetected);
      if (utmVerts.length >= 3) {
        return ensureSingleRing(utmVerts);
      }
    }

    // 3) Try to reconstruct by Azimuth + Distance
    //    For this, we need a seed point (preferably: PP / V1) in UTM
    //    Search for any isolated E/N as a seed point (reuse regex from original parser as fallback)
    let seed = null;
    try {
      // Use the original to see if at least one point appears
      if (Array.isArray(vertices) && vertices.length === 1) {
        seed = { east: vertices[0].east, north: vertices[0].north };
      }
      if (!seed) {

        // Accept E/N with variation of spaces and separators
        const rxOneEN = /\bE\s*=?\s*([0-9\.\,]{5,})\s*m?\s*(?:;|,|\s+)\s*N\s*=?\s*([0-9\.\,]{6,})\s*m?\b/i;
        const mEN = rxOneEN.exec(fullText || "");
        if (mEN) {
          const east = parseFloat(normalizeNumber(mEN[1]));
          const north = parseFloat(normalizeNumber(mEN[2]));
          if (Number.isFinite(east) && Number.isFinite(north)) seed = { east, north, source: 'EN_text_seed' };
        }

      }
      // If there is no UTM seed, try to get one from a single Lat/Lon
      if (!seed && latlon.length >= 1) {
        const utm = convertLatLonPairsToUtm([latlon[0]], crsKeyDetected);
        if (utm && utm.length === 1) seed = { east: utm[0].east, north: utm[0].north };
      }
    } catch (e) {
      console.warn('[PDFtoArcgis] seed UTM falhou:', e);
    }

    const segments = extractAzimuthDistanceFromText_Patch(text);
    if (seed && segments.length >= 2) {
      // reconstruct vertices
      const v = buildVerticesFromAzimuths(seed, segments);
      if (v.length >= 3) {
        return ensureSingleRing(v);
      }
    }

    // 4) Last resort: if unable to build a polygon, return whatever is available (may be <3)
    return vertices || [];
  }

  /* ---------- Integration PATCH into the existing script ---------- */

  // Save reference to the original parseVertices (if it exists) and replace
  const __old_parseVertices = (typeof window.parseVertices === 'function') ? window.parseVertices : null;

  // Marker to avoid recursive/double patch
  Object.defineProperty(window, '__parseVertices_isPatched', {
    value: true, writable: false, enumerable: false, configurable: false
  });

  window.parseVertices = function patched_parseVertices(text, crsKeyInput) {
    try {
      const verts = parseVerticesEnhanced(text, crsKeyInput);
      return verts;
    } catch (e) {
      console.error('[PDFtoArcgis] patched_parseVertices erro:', e);
      // fallback no original se existir
      if (__old_parseVertices) {
        try { return __old_parseVertices.call(window, text, crsKeyInput); }
        catch (ee) { console.error('[PDFtoArcgis] fallback original falhou:', ee); }
      }
      return [];
    }
  };

  // Expose useful helpers (optional)
  window.__pdf2gis_patch = {
    parseLatLonPairs,
    convertLatLonPairsToUtm,
    extractAzimuthDistanceFromText_Patch,
    buildVerticesFromAzimuths
  };

})();

// === LOG++ C: parseLatLonPairs (com contadores/amostras) =======================
(function () {
  if (!window.__pdf2gis_patch) window.__pdf2gis_patch = {};
  window.__pdf2gis_patch.parseLatLonPairs = function parseLatLonPairs_LOG(text) {
    const found = [];
    const counters = { sigefRow: 0, dmsHemiPairs: 0, decNamed: 0, decLabeledPair: 0, dmsLonLat: 0 };
    const s = (text || '')
      .replace(/\u00A0/g, ' ')
      .replace(/[–—]/g, '-')
      .replace(/\s+/g, ' ');

    const dmsToDec = (deg, min = 0, sec = 0, hem = null) => {
      const D = parseFloat(String(deg).replace(',', '.')) || 0;
      const M = parseFloat(String(min).replace(',', '.')) || 0;
      const S = parseFloat(String(sec).replace(',', '.')) || 0;
      let val = Math.abs(D) + Math.abs(M) / 60 + Math.abs(S) / 3600;
      const H = (hem || '').toUpperCase();
      if (H === 'S' || H === 'W') val = -val;
      if (D < 0) val = -val;
      return val;
    };

    // 1) LINHA SIGEF: "Longitude -50°43'12,738" ... Latitude -24°04'28,579"  (ordem Lon, Lat)
    const rxSigefRow =
      /\blon(?:gitude)?[^\d\-+]*([\-+]?\d{1,3})[°º]?\s*(\d{1,2})[’'′]?\s*(\d{1,2}(?:[\.,]\d+)?)["”″]?\s+.*?\blat(?:itude)?[^\d\-+]*([\-+]?\d{1,2})[°º]?\s*(\d{1,2})[’'′]?\s*(\d{1,2}(?:[\.,]\d+)?)["”″]?/gi;
    let m1; while ((m1 = rxSigefRow.exec(s)) !== null) {
      const lon = dmsToDec(m1[1], m1[2], m1[3], 'W'); const lat = dmsToDec(m1[4], m1[5], m1[6], 'S');
      if (Number.isFinite(lat) && Number.isFinite(lon)) { found.push({ lat, lon }); counters.sigefRow++; }
    }

    // 2) DMS nomeado por hemisfério, pares próximos (N/S e E/W/L/O)
    const rxDmsHemi = /([\-+]?\d{1,3})[°º]\s*(\d{1,2})[’'′]?\s*(\d{1,2}(?:[\.,]\d+)?)["”″]?\s*([NnSsEeWwOoLl])/g;
    const hits = []; let m2;
    while ((m2 = rxDmsHemi.exec(s)) !== null) {
      const val = dmsToDec(m2[1], m2[2], m2[3], m2[4]);
      const isLat = /[NnSs]/.test(m2[4] || '');
      hits.push({ isLat, val, idx: m2.index });
    }
    hits.sort((a, b) => a.idx - b.idx);
    for (let i = 0; i < hits.length - 1; i++) {
      const a = hits[i], b = hits[i + 1];
      if (a.isLat !== b.isLat) {
        const lat = a.isLat ? a.val : b.val, lon = a.isLat ? b.val : a.val;
        if (Number.isFinite(lat) && Number.isFinite(lon)) { found.push({ lat, lon }); counters.dmsHemiPairs++; i++; }
      }
    }

    // 3) Decimal nomeado "Latitude: -24.0  Longitude: -50.0"
    const rxDecNamed = /\blat(?:itude)?\s*[:=]?\s*([\-+]?\d{1,2}(?:[.,]\d+)?)[°º]?\b.*?\blon(?:gitude)?\s*[:=]?\s*([\-+]?\d{1,3}(?:[.,]\d+)?)[°º]?\b/gi;
    let m3; while ((m3 = rxDecNamed.exec(s)) !== null) {
      const lat = parseFloat(String(m3[1]).replace(',', '.'));
      const lon = parseFloat(String(m3[2]).replace(',', '.'));
      if (Number.isFinite(lat) && Number.isFinite(lon)) { found.push({ lat, lon }); counters.decNamed++; }
    }

    // 4) Decimal com rótulos separados "Lat ... Lon ..."
    const rxDecPair = /\blat(?:itude)?[^\d\-+]*([\-+]?\d{1,2}(?:[.,]\d+)?)\b[^\d\-+]+\blon(?:gitude)?[^\d\-+]*([\-+]?\d{1,3}(?:[.,]\d+)?)\b/gi;
    let m4; while ((m4 = rxDecPair.exec(s)) !== null) {
      const lat = parseFloat(String(m4[1]).replace(',', '.'));
      const lon = parseFloat(String(m4[2]).replace(',', '.'));
      if (Number.isFinite(lat) && Number.isFinite(lon)) { found.push({ lat, lon }); counters.decLabeledPair++; }
    }

    // 5) DMS pareado na ordem "Lon , Lat" sem labels
    const rxDmsLonLat = /([\-+]?\d{1,3})[°º]\s*(\d{1,2})[’'′]?\s*(\d{1,2}(?:[\.,]\d+)?)["”″]?\s+[,\s;]+\s*([\-+]?\d{1,2})[°º]\s*(\d{1,2})[’'′]?\s*(\d{1,2}(?:[\.,]\d+)?)["”″]?/gi;
    let m5; while ((m5 = rxDmsLonLat.exec(s)) !== null) {
      const lon = dmsToDec(m5[1], m5[2], m5[3], 'W'); const lat = dmsToDec(m5[4], m5[5], m5[6], 'S');
      if (Number.isFinite(lat) && Number.isFinite(lon)) { found.push({ lat, lon }); counters.dmsLonLat++; }
    }

    __log.group('[parseLatLonPairs]');
    __log.log('latlon', 'Contadores', counters);
    __log.log('latlon', 'Total pares', found.length);
    if (found.length) {
      __log.log('latlon', 'Amostra(3)', found.slice(0, 3));
    } else {
      // pistas mínimas…
      const low = s.toLowerCase();
      __log.warn('latlon', 'Zero pares — pistas', {
        hasLatitude: /latitude/.test(low), hasLongitude: /longitude/.test(low),
        hasGraus: /[°º]/.test(s), head: s.slice(0, 300)
      });
    }
    __log.groupEnd();

    return found;
  };
})();


// === LOG BLOCK 1/5: Infra de Logging & Telemetria ==========================
(function () {
  if (window.__pdf2gisLogInstalled) return;
  window.__pdf2gisLogInstalled = true;

  const LOG_KEY = 'pdf2arcgis.log';
  const LOG_ENABLED = localStorage.getItem(LOG_KEY) === '1';
  const NS = '[PDFtoArcgis][LOG]';

  const sessions = [];
  let current = null;

  function startDocTelemetry(meta = {}) {
    if (!LOG_ENABLED) return;
    current = {
      id: meta.docId || meta.nome || `doc_${Date.now()}`,
      startedAt: new Date().toISOString(),
      meta,
      stages: [],
      summary: {}
    };
    sessions.push(current);
  }

  function endDocTelemetry(summary = {}) {
    if (!LOG_ENABLED || !current) return;
    current.summary = { ...current.summary, ...summary };
    current.endedAt = new Date().toISOString();
    current = null;
  }

  function _push(stage, msg, data, level = 'log') {
    if (!LOG_ENABLED) return;
    const item = { ts: Date.now(), stage, msg, data, level };
    if (current) current.stages.push(item);
    try {
      const line = `${NS} [${stage}] ${msg}`;
      if (level === 'warn') console.warn(line, data || '');
      else if (level === 'error') console.error(line, data || '');
      else console.log(line, data || '');
    } catch (_) { /* noop */ }
  }

  function group(title) { if (LOG_ENABLED) console.groupCollapsed(`${NS} ${title}`); }
  function groupEnd() { if (LOG_ENABLED) console.groupEnd(); }

  function downloadTelemetry() {
    try {
      const blob = new Blob([JSON.stringify({ sessions }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `pdf2arcgis-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) {
      console.error(`${NS} Falha ao exportar telemetria`, e);
    }
  }

  window.__log = {
    enabled: () => LOG_ENABLED,
    startDocTelemetry,
    endDocTelemetry,
    log: (stage, msg, data) => _push(stage, msg, data, 'log'),
    warn: (stage, msg, data) => _push(stage, msg, data, 'warn'),
    err: (stage, msg, data) => _push(stage, msg, data, 'error'),
    group, groupEnd,
    downloadTelemetry,
    enable() { localStorage.setItem(LOG_KEY, '1'); },
    disable() { localStorage.removeItem(LOG_KEY); }
  };
})();

// Status and normalization helpers
function updateStatus(msg, type) {
  statusDiv.style.display = "block";
  statusDiv.innerText = msg;
  statusDiv.className = "status-" + type;
}

function sanitizeFileName(name) {
  return (name || "")
    .replace(/\.[^/.]+$/, "")
    .replace(/[\\/:*?"<>\n\r]/g, "")
    .replace(/\s+/g, "_");
}

function normalizeNumber(raw) {
  if (!raw) return raw;
  let v = String(raw);
  v = v.replace(/\u00A0/g, " ").replace(/[\s\t]+/g, "");  // Remove spaces and tabs
  v = v.replace(/[Oo]/g, "0");  // Fix O mistaken for 0
  v = v.replace(/[lI]/g, "1");  // Fix l/I mistaken for 1

  // Normalize decimal separators (OCR-tolerant logic)
  if (v.includes(",") && !v.includes(".")) {
    v = v.replace(",", ".");  // "1234,56" -> "1234.56"
  } else if (v.includes(",") && v.includes(".")) {
    // "1.234,56" (European format) -> "1234.56"
    const lastCommaIdx = v.lastIndexOf(",");
    const lastDotIdx = v.lastIndexOf(".");
    if (lastCommaIdx > lastDotIdx) {
      v = v.replace(/\./g, "").replace(",", ".");
    } else {
      v = v.replace(/,/g, "");  // Remove comma if it's a thousands separator
    }
  }

  return v;
}

// Fix coordinate values outside expected range (tolerant to OCR errors)
function autoScaleCoordinate(value, expectedMin, expectedMax) {
  if (Number.isNaN(value)) return NaN;
  if (value >= expectedMin && value <= expectedMax) return value;

  if (value < expectedMin && value > 0) {
    // Value too small - try multiplying
    let scaled = value;
    for (let power = 1; power <= 4; power++) {
      scaled = value * Math.pow(10, power);
      if (scaled >= expectedMin && scaled <= expectedMax) {
        console.log(`[PDFtoArcgis] 📈 Auto-escala: ${value} → ${scaled} (×10^${power})`);
        return scaled;
      }
    }
  }

  if (value > expectedMax && value > 0) {
    // Value too large - try dividing
    let scaled = value;

    // FIRST: Try dividing by 1000 (common for concatenated OCR)
    for (let power = 1; power <= 7; power++) {
      scaled = value / Math.pow(10, power);
      if (scaled >= expectedMin && scaled <= expectedMax) {
        console.log(`[PDFtoArcgis] 📉 Auto-escala: ${value} → ${scaled} (÷10^${power})`);
        return scaled;
      }
    }
  }

  return NaN; // Could not scale
}

// Quick calculations for display (distance/azimuth)
function calcularDistancia(p1, p2) {
  return Math.sqrt(Math.pow(p2.east - p1.east, 2) + Math.pow(p2.north - p1.north, 2));
}

function calcularAzimute(p1, p2) {
  const dE = p2.east - p1.east;
  const dN = p2.north - p1.north;
  let az = Math.atan2(dE, dN) * (180 / Math.PI);
  return az < 0 ? az + 360 : az;
}

// Professional geodesy: Vincenty and topological validation

// Ellipsoid parameters by CRS
const ELLIPSOID_PARAMS = {
  "SIRGAS2000_21S": { a: 6378137.0, f: 1 / 298.257222101, name: "WGS84/GRS1980" },
  "SIRGAS2000_22S": { a: 6378137.0, f: 1 / 298.257222101, name: "WGS84/GRS1980" },
  "SIRGAS2000_23S": { a: 6378137.0, f: 1 / 298.257222101, name: "WGS84/GRS1980" },
  "SIRGAS2000_24S": { a: 6378137.0, f: 1 / 298.257222101, name: "WGS84/GRS1980" },
  "SAD69_22S": { a: 6378160.0, f: 1 / 298.25, name: "GRS1967 Modified" },
  "SAD69_23S": { a: 6378160.0, f: 1 / 298.25, name: "GRS1967 Modified" },
  "WGS84": { a: 6378137.0, f: 1 / 298.257223563, name: "WGS84" }
};

/**
 * Calculate polygon area using Shoelace (Gauss Area Formula)
 * Returns area in m² and direction (positive=CCW, negative=CW)
 */
/**
 * Reorder vertices in correct CCW sequence using centroid
 * Solves self-intersection when vertices are out of order
 */
function orderVerticesCCW(vertices) {
  if (vertices.length < 3) return vertices;

  // Calculate centroid
  let centerN = 0, centerE = 0;
  for (const v of vertices) {
    centerN += v.north;
    centerE += v.east;
  }
  centerN /= vertices.length;
  centerE /= vertices.length;

  console.log(`[PDFtoArcgis] 📍 Centroide calculado: N=${centerN.toFixed(2)}, E=${centerE.toFixed(2)}`);

  // Sort by polar angle (CCW from E axis)
  const ordered = vertices.map(v => {
    const angle = Math.atan2(v.north - centerN, v.east - centerE);
    return { ...v, angle };
  }).sort((a, b) => a.angle - b.angle);

  console.log(`[PDFtoArcgis] 🔄 Vértices reordenados em sequência CCW`);

  return ordered;
}

function calcularAreaShoelace(vertices) {
  if (!vertices || vertices.length < 3) return { area: 0, isCCW: null, signed: 0, warning: null };

  let signed = 0;
  for (let i = 0; i < vertices.length; i++) {
    const curr = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    signed += curr.east * next.north - next.east * curr.north;
  }

  const area = Math.abs(signed) / 2;
  const isCCW = signed > 0;

  // Validate if area is absurd
  // Reasonable range for lots: 100 m² to 100 km² (1e8 m²)
  // Much above this indicates parsing error
  let warning = null;
  if (area > 1e8) {
    warning = `⚠️ Absurd area: ${(area / 1e4).toFixed(1)} ha (${area.toExponential(2)} m²) - Possible coordinate error`;
  } else if (area < 100) {
    warning = `⚠️ Very small area: ${area.toFixed(0)} m² - Microscopic polygon`;
  }

  if (warning) {
    console.warn(`[PDFtoArcgis] ${warning}`);
  }

  return { area, isCCW, signed, warning };
}

/**
 * Check if polygon is closed (first and last vertices are close)
 */
function isPolygonClosed(vertices, tolerance = 0.5) {
  if (!vertices || vertices.length < 3) return false;

  const first = vertices[0];
  const last = vertices[vertices.length - 1];

  const dist = Math.sqrt(
    Math.pow(last.east - first.east, 2) +
    Math.pow(last.north - first.north, 2)
  );

  return dist <= tolerance;
}

// Detect self-intersections in polygons (returns pairs of indices)
function detectPolygonSelfIntersections(vertices) {
  const intersections = [];

  if (vertices.length < 4) return intersections;

  // Helper: checks if two segments intersect
  function segmentsIntersect(p1, p2, p3, p4) {
    const ccw = (A, B, C) => (C.north - A.north) * (B.east - A.east) > (B.north - A.north) * (C.east - A.east);
    return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
  }

  // Check each pair of edges (non-adjacent)
  for (let i = 0; i < vertices.length - 1; i++) {
    for (let j = i + 2; j < vertices.length - 1; j++) {
      if (i === 0 && j === vertices.length - 2) continue; // Skip closing edge

      const p1 = vertices[i];
      const p2 = vertices[i + 1];
      const p3 = vertices[j];
      const p4 = vertices[j + 1];

      if (segmentsIntersect(p1, p2, p3, p4)) {
        intersections.push({ edge1: i, edge2: j });
      }
    }
  }

  return intersections;
}

/**
 * Fix vertex order (ensure CCW for valid polygons)
 */
function ensureCounterClockwiseOrder(vertices) {
  if (!vertices || vertices.length < 3) return vertices;

  const { isCCW } = calcularAreaShoelace(vertices);

  if (isCCW === false) {
    // If in CW, reverse
    return [...vertices].reverse();
  }

  return vertices;
}

/**
 * Complete validation of polygon topology
 */
function validatePolygonTopology(vertices, projectionKey = null) {
  const errors = [];
  const warnings = [];

  if (!vertices || vertices.length < 3) {
    errors.push("Mínimo 3 vértices requerido");
    return { isValid: false, errors, warnings, corrected: vertices };
  }

  // Closing strategy: if not closed, add the first vertex at the end for validation
  let verticesToValidate = [...vertices];
  let closed = isPolygonClosed(verticesToValidate, 0.5);
  if (!closed && verticesToValidate.length > 2) {
    const first = verticesToValidate[0];
    verticesToValidate.push({ ...first });
    closed = true; // Consider as closed for validation and reporting
  }
  if (!closed) {
    warnings.push("⚠️ Polygon not closed (distance > 0.5m between first and last)");
  }

  // 2. Calculate area
  const { area, isCCW, signed } = calcularAreaShoelace(verticesToValidate);
  if (area < 1) {
    errors.push(`❌ Very small area (${area.toFixed(2)} m²) - possible extraction error`);
  }

  // 3. Detect self-intersections
  const intersections = detectPolygonSelfIntersections(verticesToValidate);
  if (intersections.length > 0) {
    errors.push(`❌ Self-intersections detected in ${intersections.length} edge pairs`);
  }

  // 4. Check ordering
  if (isCCW === false) {
    warnings.push("⚠️ Vertices in clockwise order (CW) - converting to counterclockwise (CCW)");
  }

  // 5. Validate coherence of calculated vs Euclidean distances
  const distThreshold = 10; // metros
  let distCoherence = true;
  for (let i = 0; i < verticesToValidate.length - 1; i++) {
    const v1 = verticesToValidate[i];
    const v2 = verticesToValidate[i + 1];

    if (v1.distCalc && v2.distCalc) {
      const euclidian = calcularDistancia(v1, v2);
      const stated = parseFloat(v1.distCalc);

      if (!Number.isNaN(stated) && Math.abs(euclidian - stated) > distThreshold) {
        distCoherence = false;
        warnings.push(`⚠️ Distance V${i + 1}→V${i + 2}: calculated ${euclidian.toFixed(2)}m ≠ documented ${stated}m`);
      }
    }
  }

  const corrected = isCCW === false ? ensureCounterClockwiseOrder(verticesToValidate) : verticesToValidate;
  const isValid = errors.length === 0 && intersections.length === 0;

  return {
    isValid,
    errors,
    warnings,
    area,
    isCCW: corrected.length > 0 ? true : null,
    distCoherence,
    corrected,
    intersections,
    closed
  };
}

/**
 * Calculate distance using Vincenty (iterative, high precision for UTM)
 * More accurate than Euclidean for long distances
 */
function calculateDistanceVincenty(p1, p2, projectionKey = "SIRGAS2000_22S") {
  // For UTM, Vincenty is overkill - Euclidean is enough
  // But keep base for future use with CRS transformations

  const params = ELLIPSOID_PARAMS[projectionKey] || ELLIPSOID_PARAMS["SIRGAS2000_22S"];
  const { a, f } = params;

  // In UTM (conformal projection), Euclidean distance ≈ real distance
  // Difference < 0.1% for distances up to 1km
  // Using full Vincenty would be overkill here

  const distance = calcularDistancia(p1, p2);

  // UTM scale factor (typical: 0.9996)
  // For high precision, could adjust based on relative longitude
  const scaleFactor = 0.9996;
  const adjustedDistance = distance * scaleFactor;

  return {
    distance: adjustedDistance,
    distanceEuclidian: distance,
    azimuth: calcularAzimute(p1, p2),
    projection: projectionKey,
    method: "Vincenty-Simplified-UTM"
  };
}

/**
 * Extract azimuths and documented distances from text (memorial)
 * Looks for patterns like "45°30'27" and 258,45m"
 */
function extractAzimuthDistanceFromText(text) {
  const memorialData = [];

  // Padrão: "azimute <azi>, distância <dist>" ou "segue com azimute ... e distância ..."
  // Formatos de azimute: 45°30'27", 45° 30' 27", 045:30:27
  // Formatos de distância: 123,45m, 123.45, 123
  // IMPORTANTE: Distâncias devem estar em contexto "e distância XXXm" ou "até XXXm"
  // Não pegar números gigantescos que são coordenadas (7331450980.34)

  const azPattern = /(?:azimute?|bearing)[:\s]+([0-9]{1,3})[°º](?:\s*([0-9]{1,2})[\''])?(?:\s*([0-9]{1,2})[\""])?/gi;

  // PATTERN CORRIGIDO: Distâncias têm no máximo 5 dígitos antes do decimal (00000,00m = 100km)
  // Rejeitar números com 7+ dígitos (são coordenadas)
  // Padrões: "e distância 123,45 m", "até 456,78m", ", 789.01 m"
  const distPattern = /(?:e\s+distância|até|até\s+o|,\s+)[:\s]*([0-9]{2,5}[.,][0-9]{1,3})\s*m(?:\s|$|\.|-|,)/gi;

  let azMatch;
  const azimutes = [];
  while ((azMatch = azPattern.exec(text)) !== null) {
    const degrees = parseInt(azMatch[1], 10);
    const minutes = azMatch[2] ? parseInt(azMatch[2], 10) : 0;
    const seconds = azMatch[3] ? parseInt(azMatch[3], 10) : 0;

    const decimal = degrees + minutes / 60 + seconds / 3600;
    azimutes.push({ decimal, degrees, minutes, seconds, raw: azMatch[0] });
    console.log(`[PDFtoArcgis] Azimute extraído: ${decimal.toFixed(2)}° (${degrees}°${minutes}'${seconds}")`);
  }

  let distMatch;
  const distances = [];
  while ((distMatch = distPattern.exec(text)) !== null) {
    const raw = distMatch[1];
    const value = parseFloat(normalizeNumber(raw));

    // Validação: distância deve estar entre 0.1m e 10000m (casos reais de lotes)
    if (Number.isFinite(value) && value >= 0.1 && value <= 10000) {
      distances.push({ value, raw });
      console.log(`[PDFtoArcgis] Distância extraída: ${value.toFixed(2)}m (raw: "${raw}")`);
    } else {
      console.log(`[PDFtoArcgis] ⚠️ Distância rejeitada (fora do intervalo): ${value}m`);
    }
  }

  console.log(`[PDFtoArcgis] Resumo: ${azimutes.length} azimutes, ${distances.length} distâncias`);

  return { azimutes, distances };
}

/**
 * Validar coerência entre dados documentados (memorial) e coordenadas extraídas
 */
function validateMemorialCoherence(vertices, memorialData, projectionKey = null) {
  const issues = [];
  const matches = [];

  if (!memorialData.azimutes || memorialData.azimutes.length === 0) {
    return { matches: [], issues: ["Nenhum azimute encontrado no memorial"] };
  }

  // Tentar associar azimutes/distâncias com edges de polígono
  for (let i = 0; i < Math.min(memorialData.azimutes.length, vertices.length - 1); i++) {
    const memAz = memorialData.azimutes[i];
    const memDist = memorialData.distances[i];
    const v1 = vertices[i];
    const v2 = vertices[i + 1];

    const calcAz = calcularAzimute(v1, v2);
    const calcDist = calcularDistancia(v1, v2);

    const azDiff = Math.abs(memAz.decimal - calcAz);
    const distDiff = memDist ? Math.abs(memDist.value - calcDist) : null;

    // Circular difference para azimutes (0-360)
    const azCircularDiff = Math.min(azDiff, 360 - azDiff);

    const coherent = azCircularDiff < 2 && (!distDiff || distDiff < 2);

    matches.push({
      edge: i,
      memorial: { azimuth: memAz.decimal, distance: memDist?.value },
      calculated: { azimuth: calcAz, distance: calcDist },
      azDiff: azCircularDiff,
      distDiff,
      coherent
    });

    if (!coherent) {
      const msg = `Edge ${i}: Azimute diferença ${azCircularDiff.toFixed(2)}°`;
      if (distDiff !== null && distDiff > 2) {
        issues.push(msg + `, Distância diferença ${distDiff.toFixed(2)}m`);
      } else if (azCircularDiff >= 2) {
        issues.push(msg);
      }
    }
  }

  return { matches, issues };
}

/* =========================
   Doc selecionado / CRS
========================= */
function getSelectedDoc() {
  if (activeDocIndex >= 0 && activeDocIndex < documentsResults.length) return documentsResults[activeDocIndex];
  return null;
}

function getActiveProjectionKey() {
  const doc = getSelectedDoc();
  if (doc) return doc.manualProjectionKey || doc.projectionKey || (projectionSelect?.value) || "SIRGAS2000_22S";
  return (projectionSelect?.value) || "SIRGAS2000_22S";
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

/* =========================
   OCR (Tesseract.js)
========================= */
let ocrWorker = null;
const TESS_OPTS = {
  logger: (m) => {
    if (m && m.status) updateStatus(`OCR: ${m.status} ${(m.progress * 100).toFixed(0)}%`, "info");
  },
  cacheMethod: "none"
};

async function ensureOcrWorker() {
  if (ocrWorker) return;
  if (!window.Tesseract || typeof window.Tesseract.createWorker !== "function") {
    throw new Error("Tesseract.createWorker não disponível. Verifique o carregamento do tesseract.min.js.");
  }
  updateStatus("🧠 Preparando OCR (Tesseract)...", "info");
  ocrWorker = await window.Tesseract.createWorker(TESS_OPTS);
  await ocrWorker.loadLanguage("por");
  await ocrWorker.initialize("por");
  const PSM = (window.Tesseract.PSM && window.Tesseract.PSM.SINGLE_BLOCK) ? window.Tesseract.PSM.SINGLE_BLOCK : 6;
  await ocrWorker.setParameters({
    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÁÉÍÓÚÂÊÔÃÕÇáéíóúâêôãõç0123456789.,-:=()/°'\"; ",
    tessedit_pageseg_mode: PSM
  });
}

async function getOcrTextFromCanvas(canvas) {
  await ensureOcrWorker();
  const { data } = await ocrWorker.recognize(canvas);
  return (data && data.text) ? data.text : "";
}

// === LOG++ B: Decorators de TEXTO (PDF.js & OCR) ================================
(function () {
  // PDF.js → texto (linhas)
  if (typeof window.buildPageTextWithLines === 'function' && !window.__buildTextDecorated) {
    const original = window.buildPageTextWithLines;
    window.buildPageTextWithLines = function (textContent) {
      const out = original.call(this, textContent);
      try {
        const s = out || '';
        __log.group('[buildPageTextWithLines]');
        __log.log('text', 'Resumo', { length: s.length, lines: (s.match(/\n/g) || []).length });
        // Amostra pequena
        __log.log('text', 'Head(400)', s.slice(0, 400));
        __log.groupEnd();
      } catch (_) { }
      return out;
    };
    window.__buildTextDecorated = true;
  }

  // OCR (Tesseract) → texto
  if (typeof window.getOcrTextFromCanvas === 'function' && !window.__ocrDecorated) {
    const original = window.getOcrTextFromCanvas;
    window.getOcrTextFromCanvas = async function (canvas) {
      const t0 = performance.now();
      const text = await original.call(this, canvas);
      const t1 = performance.now();
      try {
        const s = text || '';
        __log.group('[getOcrTextFromCanvas]');
        __log.log('ocr', 'Resumo', { length: s.length, durMs: +(t1 - t0).toFixed(0) });
        // Palavras-chave úteis
        const low = s.toLowerCase();
        __log.log('ocr', 'Keywords', {
          hasLatitude: /latitude/.test(low),
          hasLongitude: /longitude/.test(low),
          hasE: /\bE\s*=?\s*\d{5,}/i.test(s),
          hasN: /\bN\s*=?\s*\d{6,}/i.test(s)
        });
        __log.log('ocr', 'Head(400)', s.slice(0, 400));
        __log.groupEnd();
      } catch (_) { }
      return text;
    };
    window.__ocrDecorated = true;
  }
})();


/* =========================
   PDF text reconstruction
========================= */
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

/* =========================
   CRS detection
========================= */
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
 * @param {Array<{east:number,north:number}>} vertices
 * @param {Object} [opts]
 * @param {boolean} [opts.verbose=false]  // true => mensagem "Inferido via coordenadas..."
 * @returns {{zone: number, reason: string} | null}
 */
function inferCrsByCoordinates(vertices, opts = {}) {
  if (!Array.isArray(vertices) || vertices.length === 0) return null;

  const { verbose = false } = opts;

  // Médias para situar a região
  const avgE = vertices.reduce((sum, v) => sum + v.east, 0) / vertices.length;
  const avgN = vertices.reduce((sum, v) => sum + v.north, 0) / vertices.length;

  // Lógica para o Sul do Brasil (UTM S)
  if (avgN > 7000000 && avgN < 8000000) {
    if (avgE > 600000 && avgE < 800000) {
      return {
        zone: 22,
        reason: verbose
          ? "Inferido via coordenadas: Padrão compatível com UTM Zona 22S (Sul do Brasil)."
          : "CRS inferido automaticamente pelas coordenadas (Padrão UTM Zona 22S)."
      };
    }
    if (avgE > 300000 && avgE < 600000) {
      return {
        zone: 23,
        reason: verbose
          ? "Inferido via coordenadas: Padrão compatível com UTM Zona 23S."
          : "CRS inferido automaticamente pelas coordenadas (Padrão UTM Zona 23S)."
      };
    }
  }
  return null;
}

function detectProjectionFromText(fullText, vertices = []) {
  const t = (fullText || "").toLowerCase();

  const hasSAD = /sad[\s\-]?69/.test(t);
  const hasSIRGAS = /sirgas\s*2000/.test(t);
  const hasWGS = /wgs\s*84/.test(t);

  // UF/Estado (Ceará) — só força 24S se realmente for CEARÁ
  const isCeara = /\bceará\b/.test(t) || /\buf\s*:\s*ce\b/.test(t) || /\b-\s*ce\b/.test(t);

  // Fuso explícito, MC explícito
  const zoneMatch = t.match(/(?:fuso|zona|utm)\s*[:=]?\s*(\d{2})\s*([ns])?/i)
    || t.match(/utm\s*[:=]?\s*(\d{2})\s*([ns])?/i);
  const mcMatch = t.match(/(?:mc|meridiano\s+central)\s*[:=]?\s*(\d{2})\s*°?\s*([wo])?/i);

  const reasonParts = [];
  let conf = "baixa";
  let zone = null;

  if (zoneMatch && zoneMatch[1]) {
    zone = parseInt(zoneMatch[1], 10);
    reasonParts.push(`Encontrado fuso/zona ${zone} no memorial.`);
    conf = "alta";
  }
  if (!zone && mcMatch && mcMatch[1]) {
    const mc = parseInt(mcMatch[1], 10);
    const map = { 57: 21, 51: 22, 45: 23, 39: 24 };
    zone = map[mc] || null;
    if (zone) { reasonParts.push(`Encontrado MC ${mc}°W → zona ${zone}.`); conf = "alta"; }
  }

  // **AQUI**: só força 24S se de fato for CEARÁ (UF/Estado)
  if (!zone && isCeara) {
    zone = 24;
    reasonParts.push("UF=CE (Ceará) → zona 24S.");
    conf = conf === "alta" ? "alta" : "média";
  }

  // Fallback por localidade (PR/SC/RS etc.) — se você quiser manter
  if (!zone) {
    const inferred = inferZoneFromBrazilState(t);
    if (inferred) { zone = inferred; reasonParts.push(`Zona inferida como ${zone}S pela localidade.`); conf = "média"; }
  }

  // Fallback pela matemática das coords
  if (!zone && vertices && vertices.length > 0) {
    const math = inferCrsByCoordinates(vertices);
    if (math) { zone = math.zone; reasonParts.push(math.reason); conf = "média"; }
  }

  if (!zone) { zone = 22; reasonParts.push(`Zona não encontrada; fallback ${zone}S.`); }

  if (hasWGS) return { key: "WGS84", confidence: "alta", reason: "Encontrado 'WGS 84'." };
  if (hasSAD) {
    const key = (zone === 23) ? "SAD69_23S" : "SAD69_22S";
    return { key, confidence: conf, reason: `Encontrado 'SAD-69'. ${reasonParts.join(" ")}` };
  }

  // Senão, padrão SIRGAS 2000
  return {
    key: `SIRGAS2000_${zone}S`,
    confidence: conf,
    reason: (hasSIRGAS ? "Encontrado 'SIRGAS 2000'. " : "Datum assumido SIRGAS 2000. ") + reasonParts.join(" "),
  };
}


// === LOG++ A: Decorator detectProjectionFromText =================================
(function () {
  if (window.__detectProjDecorated || typeof window.detectProjectionFromText !== 'function') return;

  const original = window.detectProjectionFromText;

  window.detectProjectionFromText = function (fullText, vertices = []) {
    const t0 = performance.now();
    const res = original.call(this, fullText, vertices);
    try {
      const t1 = performance.now();
      __log.group('[detectProjectionFromText]');
      __log.log('detectProjectionFromText', 'Resumo', {
        key: res?.key || '—',
        confidence: res?.confidence || '—',
        reason: res?.reason || '—',
        vertsHint: vertices?.length || 0,
        durMs: +(t1 - t0).toFixed(1)
      });

      if (fullText) {
        const low = (fullText || '').toLowerCase();
        const hasSIRGAS = /sirgas\s*2000/.test(low);
        const hasSAD = /sad[\s\-]?69/.test(low);
        const hasWGS = /wgs\s*84/.test(low);
        const z = low.match(/(?:fuso|zona|utm)\s*[:=]?\s*(\d{2})\s*[ns]?/i)?.[1] || null;
        const mc = low.match(/(?:mc|meridiano\s+central)\s*[:=]?\s*(\d{2})/i)?.[1] || null;
        __log.log('detectProjectionFromText', 'Pistas', { hasSIRGAS, hasSAD, hasWGS, zoneFound: z, mcFound: mc });
      }
      __log.groupEnd();
    } catch (_) { /* noop */ }
    return res;
  };

  window.__detectProjDecorated = true;
})();


/* =========================
   Vértices (robusto: E... e N... OU N... e E...)
========================= */
function normalizeId(id) {
  let s = (id || "").toUpperCase();
  s = s.replace(/\s+/g, " ").trim();

  // Mapa de normalizações específicas
  const normalizations = {
    "EBOC": "EBC",
    "EBO": "EBC",
    "EBOV": "EBCV",
    "EBE": "EBC",
    "PS0": "P60",
    "PS6": "P56",
    "PP": "PP"  // Marco inicial - manter como está
  };

  for (const [pattern, replacement] of Object.entries(normalizations)) {
    if (pattern.includes(" ")) {
      s = s.replace(new RegExp(`\\b${pattern}\\b`, "g"), replacement);
    } else {
      const regex = new RegExp(`^${pattern}\\b`, "g");
      s = s.replace(regex, replacement);
    }
  }

  s = s.replace(/\bEBCVB\s*(\d+)/g, "EBCV$1");
  s = s.replace(/^EBC\sP(\d+)/, "EBC P $1");

  return s;
}

/* =========================
  VERTICES (v2 – OCR/registry robust)
  - EN with multiple variants (E=... and N=..., N ... and E ..., without "m", with OCR noise)
  - Smashed tables/lines
  - Stuck digits / swapped comma/dot
  - Order detection (E/N or N/E) and automatic correction
  - Fallback: Lat/Lon → UTM
  - Fallback: Azimuth+Distance with seed obtained from text
========================= */
function parseVertices(text, crsKeyInput) {
  const t0 = performance.now();
  const out = [];
  const seenKey = new Set(); // para deduplicação aproximada
  const cleanAll = (text || "")
    .replace(/\u00A0/g, " ")          // NBSP
    .replace(/[‐‑‒–—]/g, "-")         // hifens exóticos
    .replace(/\s+/g, " ");            // colapsa espaços

  // CRS ativo/fallback
  let crsKey = (typeof getActiveProjectionKey === 'function' && getActiveProjectionKey())
    || crsKeyInput
    || "SIRGAS2000_22S";

  // Ranges válidos para validar/magnetizar E/N
  const range = (typeof getValidRanges === 'function') ? getValidRanges(crsKey) : { nMin: 6.45e6, nMax: 10.5e6, eMin: 1e5, eMax: 9e5 };

  // Helpers
  const asNum = (s) => parseFloat(normalizeNumber(s));
  const inRangeE = (e) => (e >= range.eMin && e <= range.eMax);
  const inRangeN = (n) => (n >= range.nMin && n <= range.nMax);

  // Deduplicação numérica (tolerância 0.5m)
  function pushVertex(id, north, east, origem) {
    if (!Number.isFinite(north) || !Number.isFinite(east)) return;
    // Corrigir trocas E/N comuns no OCR (se estiver óbvio)
    let E = east, N = north;
    if (!inRangeE(E) && inRangeN(E) && !inRangeN(N) && inRangeE(N)) {
      // invertido
      [E, N] = [N, E];
    }

    // magnetização por auto-escala quando fora do range
    if (!inRangeE(E)) {
      const scaledE = autoScaleCoordinate(E, range.eMin, range.eMax);
      if (!Number.isNaN(scaledE)) E = scaledE;
    }
    if (!inRangeN(N)) {
      const scaledN = autoScaleCoordinate(N, range.nMin, range.nMax);
      if (!Number.isNaN(scaledN)) N = scaledN;
    }

    if (!inRangeE(E) || !inRangeN(N)) return;

    const key = `${Math.round(E * 2)}/${Math.round(N * 2)}`; // ~0.5m
    if (seenKey.has(key)) return;
    seenKey.add(key);

    out.push({ id, north: N, east: E, origem });
  }

  // 1) Registry/line patterns (E... and N...) – OCR tolerant
  // Classic registry with "m" (E=xxx m and N=yyy m)
  let rx = /E\s*=?\s*([0-9.,\s]{5,})\s*m?\s*e\s*N\s*=?\s*([0-9.,\s]{6,})\s*m?/gi;
  for (let m; (m = rx.exec(cleanAll)) !== null;) {
    const E = asNum(m[1]), N = asNum(m[2]);
    const id = `V${String(out.length + 1).padStart(3, "0")}`;
    pushVertex(id, N, E, 'cartorio_EN');
  }

  // Common variant: N first, then E (with noise between)
  rx = /N\s*=?\s*([0-9.,\s]{6,})\s*m?.{0,40}?E\s*=?\s*([0-9.,\s]{5,})\s*m?/gi;
  for (let m; (m = rx.exec(cleanAll)) !== null;) {
    const N = asNum(m[1]), E = asNum(m[2]);
    const id = `V${String(out.length + 1).padStart(3, "0")}`;
    pushVertex(id, N, E, 'cartorio_NE');
  }

  // Dirty OCR variant: accepts :, /, - as numeric field separators
  rx = /E\W*([0-9:.,/ \-]{5,})\W*e\W*N\W*([0-9:.,/ \-]{6,})/gi;
  for (let m; (m = rx.exec(cleanAll)) !== null;) {
    const E = asNum(m[1].replace(/[:/]/g, '.')), N = asNum(m[2].replace(/[:/]/g, '.'));
    const id = `V${String(out.length + 1).padStart(3, "0")}`;
    pushVertex(id, N, E, 'ocr_relaxed_EN');
  }

  // Dirty OCR variant N/E
  rx = /N\W*([0-9:.,/ \-]{6,})\W*(?:m)?[^A-Za-z0-9]{0,40}E\W*([0-9:.,/ \-]{5,})/gi;
  for (let m; (m = rx.exec(cleanAll)) !== null;) {
    const N = asNum(m[1].replace(/[:/]/g, '.')), E = asNum(m[2].replace(/[:/]/g, '.'));
    const id = `V${String(out.length + 1).padStart(3, "0")}`;
    pushVertex(id, N, E, 'ocr_relaxed_NE');
  }

  // 2) Smashed table/line: ID  E  N  (with noise)
  rx = /([A-Z0-9]{1,10})\s+([0-9]{5,}[.,][0-9]{1,3})\s+([0-9]{6,}[.,][0-9]{1,3})/gi;
  for (let m; (m = rx.exec(cleanAll)) !== null;) {
    const label = m[1].trim();
    const E = asNum(m[2]), N = asNum(m[3]);
    const id = /^[A-Z]/.test(label) ? label : `V${String(out.length + 1).padStart(3, "0")}`;
    pushVertex(id, N, E, 'tabela');
  }

  // 3) Generic fallback: look for blocks with "E" and "N" and two large numbers nearby
  // More restricted generic fallback: only if the chunk has explicit E/N labels
  const windowChunks = cleanAll.split(/[;\n]+/);
  for (const chunk of windowChunks) {
    const hasENLabels = /\bE\s*=?\s*\d|\bN\s*=?\s*\d/i.test(chunk);
    const hasWords = /(utm|sirgas|sad-?\s?69|coordena|este\s*\(x\)|norte\s*\(y\))/i.test(chunk);
    if (!hasENLabels && !hasWords) continue; // skip if no geographic context

    // Now, look for pairs with E ... N ... nearby
    let m;
    const rxEN = /E\s*=?\s*([\d\.,]{5,})\s*m?\s*\D{0,40}N\s*=?\s*([\d\.,]{6,})\s*m?/gi;
    while ((m = rxEN.exec(chunk)) !== null) {
      const E = asNum(m[1]), N = asNum(m[2]);
      const id = `V${String(out.length + 1).padStart(3, '0')}`;
      pushVertex(id, N, E, 'fallback_chunk_en');
    }
    const rxNE = /N\s*=?\s*([\d\.,]{6,})\s*m?\s*\D{0,40}E\s*=?\s*([\d\.,]{5,})\s*m?/gi;
    while ((m = rxNE.exec(chunk)) !== null) {
      const N = asNum(m[1]), E = asNum(m[2]);
      const id = `V${String(out.length + 1).padStart(3, '0')}`;
      pushVertex(id, N, E, 'fallback_chunk_ne');
    }
  }

  // Hard cap: if >500 EN vertices, likely noise => re-run with strict rules only
  if (out.length > 500) {
    __log?.warn?.('parseVertices_v2', 'Muitos vértices (provável ruído). Refiltrando...', { total: out.length });
    return []; // force next layers (Lat/Lon and Az+Dist) / or return only IDs/table
  }


  // 4) If already 3+, return immediately
  if (out.length >= 3) {
    __log?.log?.('parseVertices_v2', 'Resumo', { vertices: out.length, strategy: 'EN (multivariantes)' });
    return out;
  }

  // 5) Fallback Lat/Lon (DMS/decimal) → UTM
  try {
    const hasPatch = !!(window.__pdf2gis_patch?.parseLatLonPairs && window.__pdf2gis_patch?.convertLatLonPairsToUtm);
    if (hasPatch) {
      const latlon = window.__pdf2gis_patch.parseLatLonPairs(text);
      if (Array.isArray(latlon) && latlon.length >= 3) {
        const utm = window.__pdf2gis_patch.convertLatLonPairsToUtm(latlon, crsKey);
        if (Array.isArray(utm) && utm.length >= 3) {
          __log?.log?.('parseVertices_v2', 'Resumo', { vertices: utm.length, strategy: 'Lat/Lon → UTM' });
          return utm;
        }
      }
    }
  } catch (e) {
    __log?.warn?.('parseVertices_v2', 'Lat/Lon fallback falhou', { error: e?.message });
  }

  // 6) Fallback Azimuth+Distance with seed
  //    - Looks for seed (any valid EN found above; if not, tries a unique pair in text)
  //    - Uses azimuth segments already extracted by Patch function (or own)
  try {
    const segments =
      (window.__pdf2gis_patch?.extractAzimuthDistanceFromText_Patch?.(text))
      || (typeof extractAzimuthDistanceFromText === 'function' ? (extractAzimuthDistanceFromText(text)?.azimutes || []).map((a, i) => ({ azimuth: a.decimal, distance: (extractAzimuthDistanceFromText(text)?.distances?.[i]?.value) }))
        : []);

    if (Array.isArray(segments) && segments.length >= 2) {
      // Preferred seed: any point already found (even if only 1 or 2)
      let seed = null;
      if (out.length >= 1) {
        seed = { east: out[0].east, north: out[0].north };
      }

      // if still not found, look for a single EN pair in the text
      if (!seed) {
        const m = /E\s*=?\s*([0-9\.,]{5,})\s*m?\s*e\s*N\s*=?\s*([0-9\.,]{6,})\s*m?/i.exec(cleanAll)
          || /N\s*=?\s*([0-9\.,]{6,})\s*m?.{0,40}?E\s*=?\s*([0-9\.,]{5,})\s*m?/i.exec(cleanAll);
        if (m) {
          const a = asNum(m[1]), b = asNum(m[2]);
          let N = a, E = b;
          // Ajustar ordem conforme regex usada
          // Quando vem do 2º padrão (N... E...), invertido
          if (/^\s*N/i.test(m[0])) { N = asNum(m[1]); E = asNum(m[2]); } else { E = asNum(m[1]); N = asNum(m[2]); }
          // Correção de ordem por ranges
          if (!inRangeE(E) && inRangeN(E) && inRangeE(N) && !inRangeN(N)) [E, N] = [N, E];
          if (inRangeE(E) && inRangeN(N)) seed = { east: E, north: N };
        }
      }

      // If still no seed, try to get 1 point from Lat/Lon
      if (!seed && window.__pdf2gis_patch?.parseLatLonPairs) {
        const latlon = window.__pdf2gis_patch.parseLatLonPairs(text);
        if (Array.isArray(latlon) && latlon.length >= 1 && window.__pdf2gis_patch?.convertLatLonPairsToUtm) {
          const utm = window.__pdf2gis_patch.convertLatLonPairsToUtm([latlon[0]], crsKey);
          if (utm?.length === 1) seed = { east: utm[0].east, north: utm[0].north };
        }
      }

      if (seed) {
        const verts = (typeof window.__pdf2gis_patch?.buildVerticesFromAzimuths === 'function')
          ? window.__pdf2gis_patch.buildVerticesFromAzimuths(seed, segments)
          : []; // if not available, return empty

        if (Array.isArray(verts) && verts.length >= 3) {
          __log?.log?.('parseVertices_v2', 'Resumo', { vertices: verts.length, strategy: 'Az+Dist (seed)' });
          return verts;
        }
      }
    }
  } catch (e) {
    __log?.warn?.('parseVertices_v2', 'Rumo+Dist fallback falhou', { error: e?.message });
  }

  __log?.warn?.('parseVertices_v2', 'No vertices extracted', { durMs: +(performance.now() - t0).toFixed(1) });
  return out; // may return <3 for diagnosis in next layers
}

// === LOG BLOCK 2/5: Decorator parseVertices =================================
(function () {
  if (window.__parseVerticesDecorated || typeof window.parseVertices !== 'function') return;

  const original = window.parseVertices;

  window.parseVertices = function (text, crsKeyInput) {
    const doc = (typeof getSelectedDoc === 'function' && getSelectedDoc()) || {};
    const crsActive = (typeof getActiveProjectionKey === 'function' && getActiveProjectionKey()) || crsKeyInput || '—';

    __log.group(`parseVertices doc=${doc.docId || 'N/D'} crs=${crsActive}`);
    const t0 = performance.now();

    let out = [];
    const stats = { originalEN: 0, latlonPairs: 0, azSegments: 0, strategy: '—' };

    try {
      // 1) Tentar a função atual (seja a original, seja a já-patchada)
      out = original.call(this, text, crsKeyInput) || [];
      stats.originalEN = Array.isArray(out) ? out.length : 0;
      stats.strategy = 'EN (função existente)';

      // 2) Se ainda não montou polígono, tentar as extensões (se o patch de Lat/Lon/Rumo estiver no projeto)
      if (!out || out.length < 3) {
        if (window.__pdf2gis_patch?.parseLatLonPairs) {
          const latlon = window.__pdf2gis_patch.parseLatLonPairs(text);
          stats.latlonPairs = latlon.length;
          if (latlon.length >= 3) {
            out = window.__pdf2gis_patch.convertLatLonPairsToUtm(latlon, crsKeyInput);
            stats.strategy = 'Lat/Lon → UTM (proj4)';
          }
        }
      }
      if ((!out || out.length < 3) && window.__pdf2gis_patch?.extractAzimuthDistanceFromText_Patch) {
        const segs = window.__pdf2gis_patch.extractAzimuthDistanceFromText_Patch(text);
        stats.azSegments = segs.length;

        // semente: tenta 1 par E/N no texto
        let seed = null;
        const m = /E\s*=?\s*([0-9\.\,]{5,})\s*m?\s*e\s*N\s*=?\s*([0-9\.\,]{6,})/i.exec(text || '');
        if (m) seed = { east: parseFloat((m[1] || '').replace(',', '.')), north: parseFloat((m[2] || '').replace(',', '.')) };
        if (!seed && Array.isArray(out) && out.length >= 1) seed = { east: out[0].east, north: out[0].north };

        if (seed && segs.length >= 2) {
          out = window.__pdf2gis_patch.buildVerticesFromAzimuths(seed, segs);
          stats.strategy = 'Rumo/Azimute + Distância (seed EN)';
        }
      }

    } catch (e) {
      __log.err('parseVertices', 'Exceção durante parsing', { error: e?.message });
    }

    const t1 = performance.now();
    __log.log('parseVertices', 'Resumo', {
      vertices: Array.isArray(out) ? out.length : 0,
      stats, durMs: +(t1 - t0).toFixed(1)
    });
    __log.groupEnd();
    return out || [];
  };

  window.__parseVerticesDecorated = true;
})();

/* =========================
  AUTO-FIX UTM (stuck decimals)
========================= */
function chooseBestScale(value, minv, maxv, target) {
  if (!Number.isFinite(value)) return { value, scalePow: 0, ok: false };
  let best = null;
  for (let k = 0; k <= 6; k++) {
    const v = value / Math.pow(10, k);
    if (v >= minv && v <= maxv) {
      const score = Number.isFinite(target) ? Math.abs(v - target) : 0;
      const cand = { score, scalePow: k, value: v, ok: true };
      if (!best || cand.score < best.score) best = cand;
    }
  }
  return best || { value, scalePow: 0, ok: false };
}

function autoFixUtmDecimals(coords) {
  // Fixes stuck decimal errors in UTM coordinates by testing possible scales
  const validE = coords.map(c => c.east).filter(v => v >= 100000 && v <= 900000);
  const validN = coords.map(c => c.north).filter(v => v >= 0 && v <= 10000000);

  const median = (arr) => {
    if (!arr.length) return NaN;
    const a = [...arr].sort((x, y) => x - y);
    const mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  };

  const medE = median(validE);
  const medN = median(validN);

  const fixes = [];
  for (const p of coords) {
    const n0 = p.north;
    const e0 = p.east;
    const nCand = chooseBestScale(n0, 0, 10000000, medN);
    const eCand = chooseBestScale(e0, 100000, 900000, medE);
    if (nCand.ok && nCand.scalePow > 0) { p.north = nCand.value; fixes.push(`N ${p.id}: ${n0}→${p.north}`); }
    if (eCand.ok && eCand.scalePow > 0) { p.east = eCand.value; fixes.push(`E ${p.id}: ${e0}→${p.east}`); }
  }
  return fixes;
}

/* =========================
  VALIDATION AND RECOVERY OF COORDINATES
========================= */

/**
 * Defines valid coordinate ranges by UTM zone
 * Based on Brazilian registry standards
 */
function getValidRanges(projectionKey) {
  const ranges = {
    // South/Southeast
    "SIRGAS2000_21S": { nMin: 6.45e6, nMax: 6.75e6, eMin: 300e3, eMax: 850e3 },
    "SAD69_21S": { nMin: 6.45e6, nMax: 6.75e6, eMin: 300e3, eMax: 850e3 },
    "SIRGAS2000_22S": { nMin: 7.10e6, nMax: 7.45e6, eMin: 300e3, eMax: 850e3 },
    "SAD69_22S": { nMin: 7.10e6, nMax: 7.45e6, eMin: 300e3, eMax: 850e3 },
    "SIRGAS2000_23S": { nMin: 8.0e6, nMax: 9.0e6, eMin: 300e3, eMax: 850e3 },
    "SAD69_23S": { nMin: 8.0e6, nMax: 9.0e6, eMin: 300e3, eMax: 850e3 },
    // Northeast/North (Ceará, Maranhão, Pará, etc)
    "SIRGAS2000_24S": { nMin: 9.0e6, nMax: 10.5e6, eMin: 300e3, eMax: 850e3 },
    "SAD69_24S": { nMin: 9.0e6, nMax: 10.5e6, eMin: 300e3, eMax: 850e3 },
    "SIRGAS2000_25S": { nMin: 10.0e6, nMax: 10.5e6, eMin: 300e3, eMax: 850e3 },
    // Fallback standard: zone 22S (Paraná)
    "WGS84_UTM": { nMin: 7.15e6, nMax: 7.45e6, eMin: 300e3, eMax: 850e3 },
  };
  return ranges[projectionKey] || ranges["WGS84_UTM"];
}

/**
 * Validates and tries to recover coordinates outside the valid range
 */
function validateAndFixCoordinates(coords, projectionKey) {
  const range = getValidRanges(projectionKey);
  const valid = [];
  const invalid = [];
  const recovered = [];

  console.log(`[PDFtoArcgis] 🔍 Validando ${coords.length} coordenadas`);
  console.log(`[PDFtoArcgis] Ranges esperados: N[${range.nMin.toExponential(1)}-${range.nMax.toExponential(1)}], E[${range.eMin.toExponential(1)}-${range.eMax.toExponential(1)}]`);

  for (const c of coords) {
    let north = c.north;
    let east = c.east;
    let scaled = false;

    // FIRST: Try auto-scaling if outside the range
    if (!(north >= range.nMin && north <= range.nMax)) {
      const scaledN = autoScaleCoordinate(north, range.nMin, range.nMax);
      if (!Number.isNaN(scaledN)) {
        north = scaledN;
        scaled = true;
      }
    }

    if (!(east >= range.eMin && east <= range.eMax)) {
      const scaledE = autoScaleCoordinate(east, range.eMin, range.eMax);
      if (!Number.isNaN(scaledE)) {
        east = scaledE;
        scaled = true;
      }
    }

    const nValid = north >= range.nMin && north <= range.nMax;
    const eValid = east >= range.eMin && east <= range.eMax;

    if (nValid && eValid) {
      if (scaled) {
        const recoveryMsg = `Auto-escalado: N ${c.north}→${north}, E ${c.east}→${east}`;
        valid.push({ ...c, north, east });
        recovered.push({ original: c, fixed: { north, east }, recovery: recoveryMsg });
        console.log(`[PDFtoArcgis] 🔄 ${c.id}: ${recoveryMsg}`);
      } else {
        valid.push({ ...c, north, east });
      }
    } else {
      // Tentar outras estratégias de recuperação
      let fixed = null;

      // PROBLEM 1: Number starting with 73 (should be 7.3)
      if (!fixed && c.north > 70e6 && c.north < 80e6) {
        const corrected = Math.floor(c.north / 10);
        if (corrected >= range.nMin && corrected <= range.nMax) {
          fixed = { ...c, north: corrected, recovery: "Removido dígito inicial (73→7.3)" };
          console.log(`[PDFtoArcgis] 🔄 Recuperado ${c.id}: N ${c.north} → ${corrected}`);
        }
      }

      // PROBLEM 2: Truncated number (7.33 should be 7.3XX.XXX)
      if (!fixed && c.north < 1e6 && c.north > 0) {
        // Procurar próxima coordenada válida para estimar posição
        const nearValid = coords
          .filter(cc => cc.north >= range.nMin && cc.north <= range.nMax)
          .map(cc => cc.north);

        if (nearValid.length > 0) {
          const avgN = nearValid.reduce((a, b) => a + b) / nearValid.length;
          // Manter a mesma ordem de magnitude da coordenada válida próxima
          const magnitude = Math.floor(Math.log10(c.north));
          const multiplier = Math.pow(10, Math.floor(Math.log10(avgN)) - magnitude);
          const corrected = c.north * multiplier;

          if (corrected >= range.nMin && corrected <= range.nMax) {
            fixed = { ...c, north: corrected, recovery: "Escalado para magnitude correta" };
            console.log(`[PDFtoArcgis] 🔄 Escalado ${c.id}: N ${c.north} → ${corrected.toFixed(0)}`);
          }
        }
      }

      // PROBLEM 3: E (east) too large - try scaling
      if (!fixed && !eValid && c.east > range.eMax) {
        const scaledE = autoScaleCoordinate(c.east, range.eMin, range.eMax);
        if (!Number.isNaN(scaledE)) {
          fixed = { ...c, east: scaledE, recovery: `Auto-escalado E: ${c.east} → ${scaledE}` };
          console.log(`[PDFtoArcgis] 🔄 Recuperado ${c.id}: E ${c.east} → ${scaledE}`);
        }
      }

      // PROBLEM 4: N (north) too large - try scaling
      if (!fixed && !nValid && c.north > range.nMax) {
        const scaledN = autoScaleCoordinate(c.north, range.nMin, range.nMax);
        if (!Number.isNaN(scaledN)) {
          fixed = { ...c, north: scaledN, recovery: `Auto-escalado N: ${c.north} → ${scaledN}` };
          console.log(`[PDFtoArcgis] 🔄 Recuperado ${c.id}: N ${c.north} → ${scaledN}`);
        }
      }

      if (fixed) {
        const fixedCoord = { ...c, north: fixed.north || c.north, east: fixed.east || c.east };
        valid.push(fixedCoord);
        recovered.push({ original: c, fixed: fixedCoord, recovery: fixed.recovery });
      } else {
        invalid.push(c);
        console.log(`[PDFtoArcgis] ❌ Coordenada rejeitada ${c.id}: N=${c.north}, E=${c.east}`);
      }
    }
  }

  console.log(`[PDFtoArcgis] ✅ Validação completa: ${valid.length} válidas, ${recovered.length} recuperadas, ${invalid.length} rejeitadas`);

  return { valid, invalid, recovered };
}

// === LOG BLOCK 3/5: Decorator for validateAndFixCoordinates ===
(function () {
  if (window.__validateAndFixDecorated || typeof window.validateAndFixCoordinates !== 'function') return;

  const original = window.validateAndFixCoordinates;

  window.validateAndFixCoordinates = function (coords, projectionKey) {
    const t0 = performance.now();
    const res = original.call(this, coords, projectionKey);

    try {
      const v = res?.valid?.length ?? 0;
      const r = res?.recovered?.length ?? 0;
      const i = res?.invalid?.length ?? res?.rejected?.length ?? 0;
      const sample = (res?.invalid || res?.rejected || []).slice(0, 10).map(p => ({
        id: p.id, N: p.north, E: p.east
      }));

      __log.log('validateAndFix', 'Resumo', {
        projectionKey, valid: v, recovered: r, rejected: i, durMs: +(performance.now() - t0).toFixed(1)
      });

      if (sample.length) __log.warn('validateAndFix', 'Amostra de rejeitados (top 10)', sample);
    } catch (_) { /* noop */ }

    return res;
  };

  window.__validateAndFixDecorated = true;
})();

function validateCoords(coords, projectionKey) {
  const warnings = [];
  const isWgs = projectionKey === "WGS84";
  const seen = new Map();

  for (const p of coords) {
    if (!seen.has(p.id)) seen.set(p.id, { north: p.north, east: p.east });
    else {
      const prev = seen.get(p.id);
      if (prev.north !== p.north || prev.east !== p.east) warnings.push(`⚠️ ID duplicado com coords diferentes: ${p.id}`);
    }
  }

  for (const p of coords) {
    if (!isWgs) {
      if (p.east < 100000 || p.east > 900000) warnings.push(`⚠️ East fora UTM: ${p.id} (E=${p.east})`);
      if (p.north < 0 || p.north > 10000000) warnings.push(`⚠️ North fora UTM: ${p.id} (N=${p.north})`);
    } else {
      if (p.east < -180 || p.east > 180) warnings.push(`⚠️ Longitude fora: ${p.id} (X=${p.east})`);
      if (p.north < -90 || p.north > 90) warnings.push(`⚠️ Latitude fora: ${p.id} (Y=${p.north})`);
    }
  }

  return warnings;
}

// === CSV helper (with professional diagnostics) ===
function gerarCsvParaVertices(vertices, epsg, docId = null, topologyInfo = null, memorialInfo = null) {
  let csv = "\ufeffsep=;\n";

  // Professional header with metadata
  csv += `# MATRÍCULA;${docId || "N/A"}\n`;
  csv += `# EPSG;${epsg}\n`;
  if (topologyInfo) {
    csv += `# TOPOLOGY_VALID;${topologyInfo.isValid ? "SIM" : "NÃO"}\n`;
    csv += `# AREA_M2;${topologyInfo.area.toFixed(2)}\n`;
    csv += `# POLYGON_CLOSED;${topologyInfo.closed ? "SIM" : "NÃO"}\n`;
  }
  if (memorialInfo && memorialInfo.matches.length > 0) {
    const coherentMatches = memorialInfo.matches.filter(m => m.coherent).length;
    csv += `# MEMORIAL_COHERENCE;${coherentMatches}/${memorialInfo.matches.length}\n`;
  }
  csv += `#\n`;

  // Table header
  csv += "Point_ID;Ordem;Norte_Y;Este_X;EPSG;Dist_M;Azimute_Deg;Qualidade;Notas\n";

  // Closing strategy: if not closed, add the first vertex at the end
  let verticesToExport = [...vertices];
  if (topologyInfo && topologyInfo.closed === false && vertices.length > 2) {
    const first = vertices[0];
    // Create a new closing vertex (Point_ID and Order incremented)
    const closingVertex = {
      ...first,
      id: (first.id || "F") + "_close", // Sufixo para evitar duplicata
      ordem: vertices.length + 1,
      distCalc: "---",
      azCalc: "---"
    };
    verticesToExport.push(closingVertex);
  }

  for (let i = 0; i < verticesToExport.length; i++) {
    const c = verticesToExport[i];
    // Quality determination based on validation
    let quality = "✓ OK";
    let notes = "";
    // Check coherence with memorial if available
    if (memorialInfo && memorialInfo.matches[i]) {
      const match = memorialInfo.matches[i];
      if (!match.coherent) {
        quality = "⚠ AVISO";
        notes = `Az ${match.azDiff.toFixed(1)}° diff`;
        if (match.distDiff !== null && match.distDiff > 2) {
          notes += `; Dist ${match.distDiff.toFixed(1)}m diff`;
        }
      }
    }
    // Check if there is distance "---" (last vertex or closing)
    if (c.distCalc === "---") {
      notes = "Fechamento";
    }
    // Check for duplicates or topological problems
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

/**
 * Gerar relatório de validação (para salvar junto com polígonos)
 */
function gerarRelatorioValidacao(docId, pages, topologyInfo, memorialInfo, warnings) {
  let report = `RELATÓRIO DE VALIDAÇÃO - Matrícula ${docId}\n`;
  report += `Data: ${new Date().toLocaleString("pt-BR")}\n`;
  let safePages = Array.isArray(pages) ? pages.join(", ") : (typeof pages === 'string' ? pages : "(desconhecido)");
  report += `Páginas: ${safePages}\n`;
  report += `${"=".repeat(60)}\n\n`;

  if (topologyInfo) {
    report += `VALIDAÇÃO TOPOLÓGICA:\n`;
    report += `  Polígono válido: ${topologyInfo.isValid ? "✓ SIM" : "✗ NÃO"}\n`;
    report += `  Área: ${topologyInfo.area.toFixed(2)} m²\n`;
    report += `  Fechado: ${topologyInfo.closed ? "✓ SIM" : "✗ NÃO"}\n`;
    report += `  Auto-intersecções: ${topologyInfo.intersections.length > 0 ? `✗ ${topologyInfo.intersections.length} encontradas` : "✓ Nenhuma"}\n`;
    report += `  Sentido: ${topologyInfo.isCCW ? "Anti-horário (CCW)" : "Horário (CW)"}\n\n`;

    if (topologyInfo.errors.length > 0) {
      report += `  ERROS DETECTADOS:\n`;
      topologyInfo.errors.forEach(e => report += `    • ${e}\n`);
      report += `\n`;
    }

    if (topologyInfo.warnings.length > 0) {
      report += `  AVISOS:\n`;
      topologyInfo.warnings.forEach(w => report += `    • ${w}\n`);
      report += `\n`;
    }
  }

  if (memorialInfo && memorialInfo.matches.length > 0) {
    report += `VALIDAÇÃO COM MEMORIAL (Azimutes/Distâncias):\n`;
    const coherent = memorialInfo.matches.filter(m => m.coherent).length;
    report += `  Correspondência: ${coherent}/${memorialInfo.matches.length} edges coerentes\n`;
    report += `  Confiança: ${Math.round(coherent / memorialInfo.matches.length * 100)}%\n\n`;

    if (memorialInfo.issues.length > 0) {
      report += `  DISCREPÂNCIAS ENCONTRADAS:\n`;
      memorialInfo.issues.forEach(issue => report += `    • ${issue}\n`);
      report += `\n`;
    }
  }

  if (warnings && warnings.length > 0) {
    report += `AVISOS GERAIS:\n`;
    warnings.forEach(w => report += `  • ${w}\n`);
  }

  return report;
}

// === CSV helper (original - compatibility) ===
function gerarCsvParaVerticesSimples(vertices, epsg) {
  let csv = "\ufeffsep=;\n";
  csv += "Point_ID;Ordem;Norte_Y;Este_X;EPSG;Dist_M;Azimute_Deg\n";
  for (const c of vertices) {
    csv += `${c.id};${c.ordem};${c.north};${c.east};${epsg};${c.distCalc || ""};${c.azCalc || ""}\n`;
  }
  return csv;
}

// === Split by document ID (matrícula) ===
function detectDocIdFromPageText(pageText) {
  const t = (pageText || "").replace(/\u00A0/g, " ");

  // DEBUG: Show first 500 chars of text for debugging
  console.log(`[PDFtoArcgis] Detectando ID de: "${t.substring(0, 300)}..."`);

  // ===== CRITICAL STRATEGY: Use ONLY the first occurrence of MATRÍCULA =====
  // In registries, MATRÍCULA in the header is the document ID
  // References to other IDs appear later in the memorial (e.g., "conforme referido Orozimbo Ciuffa de MATRÍCULA: 8.462")
  // SOLUTION: Take ONLY the FIRST matrícula from the text (header/start)

  // STRATEGY 1: Search ONLY at the beginning of the text (first 2000 characters - header)
  const headerText = t.substring(0, 2000);

  const matriculaPatterns = [
    // Patterns for MATRÍCULA - with degraded OCR variations
    // IMPORTANT ORDER: From most specific to most generic
    // Patterns that guarantee document ID (appear in header/title)
    { rx: /MATR[ÍI]CULA\s*N[ºo°e]\s*([\d.,]+)/i, name: "MATRÍCULA Nº (com Ne)" },
    { rx: /MATR[ÍI]CULA\s*N[ºo°e]?\s*([\d.,]+)/i, name: "MATRÍCULA N (OCR flex)" },
    { rx: /^MATR[ÍI]CULA\s*N[ºo°]?\s*([\d.,]+)/im, name: "MATRÍCULA Nº (linha)" },

    // PADRÕES PARA "MAT" - muito comuns em cartórios, aparecem no cabeçalho
    { rx: /\bMAT\s+N[ºo°e]\s*([\d.,]+)/i, name: "MAT Nº" },
    { rx: /\bMAT\s*\.\s*N[ºo°e]\s*([\d.,]+)/i, name: "MAT. Nº" },
    { rx: /\bN[ºo°e]\s+(\d{1,3}(?:[.,]\d{3})*)\s*(?=[-–]|$)/i, name: "Nº (isolado)" },
  ];

  // Tentar todos os padrões DE MATRÍCULA APENAS NO CABEÇALHO
  for (const { rx, name } of matriculaPatterns) {
    const m = headerText.match(rx);
    if (m && m[1]) {
      // Normalize: remove dots AND commas (OCR separators may vary)
      let id = m[1].replace(/[.,]/g, "").replace(/^0+/, "");
      if (id && id.length > 0) {
        console.log(`[PDFtoArcgis] ✅ MATRÍCULA (cabeçalho): ${id} (padrão: ${name}) - Raw: "${m[1]}"`);
        return id;
      }
    }
  }

  // If no matrícula pattern worked, log warning
  console.log(`[PDFtoArcgis] ⚠️ Nenhum padrão de MATRÍCULA encontrado no cabeçalho`);

  // ===== STRATEGY 2: Search for PROTOCOL (only as fallback) =====
  // PROTOCOL should never take priority over MATRÍCULA
  // Use only if MATRÍCULA was not found
  const protocoloPatterns = [
    { rx: /PROTOCOLO\s*N[ºo°e]\s*([\d.,]+)/i, name: "PROTOCOLO Nº" },
  ];

  for (const { rx, name } of protocoloPatterns) {
    const m = headerText.match(rx);
    if (m && m[1]) {
      let id = m[1].replace(/[.,]/g, "").replace(/^0+/, "");
      if (id && id.length > 0) {
        console.log(`[PDFtoArcgis] ⚠️ PROTOCOLO detectado (fallback): ${id} (padrão: ${name}) - Raw: "${m[1]}"`);
        return id;
      }
    }
  }

  // ===== STEP 3: Search for alternatives (if no matrícula was found) =====
  // DISABLED: Alternative patterns too generic cause false positives
  // Example: "M. 339" would pick up a number from another part of the document that was not the matrícula
  // Better to leave as "SEM_ID" and later use recovery heuristics with nearby pages
  const alternativePatterns = [
    // { rx: /PROCESSO\s*(?:N[ºo°]|#)?\s*([\d.]+)/i, name: "PROCESSO" },
    // { rx: /IMÓVEL\s*(?:N[ºo°]|#)?\s*([\d.]+)/i, name: "IMÓVEL" },
    // { rx: /REGISTRO\s*(?:N[ºo°]|#)?\s*([\d.]+)/i, name: "REGISTRO" },
    // { rx: /\bM\.?\s+(\d{1,3}(?:[.,]\d{3})*)\b/, name: "M. (abreviação)" },  // MUITO GENÉRICO!
    // { rx: /MATR\s+(\d{1,3}(?:[.,]\d{3})*)/i, name: "MATR (abreviação)" },
  ];

  for (const { rx, name } of alternativePatterns) {
    const m = t.match(rx);
    if (m && m[1]) {
      let id = m[1].replace(/\./g, "").replace(/^0+/, "");
      if (id) {
        console.log(`[PDFtoArcgis] ID alternativo detectado: ${id} (padrão: ${name})`);
        return id;
      }
    }
  }

  console.log(`[PDFtoArcgis] ❌ Nenhum ID detectado`);
  return null;
}

function splitPagesIntoDocuments(pagesText) {
  const docs = [];
  let current = null;
  console.log(`[PDFtoArcgis] Processando ${pagesText.length} páginas...`);

  pagesText.forEach((txt, idx) => {
    const docId = detectDocIdFromPageText(txt);
    console.log(`[PDFtoArcgis] Página ${idx + 1}: ID detectado = ${docId || "null"}`);

    if (!docId) {
      if (!current) {
        current = { docId: "SEM_ID", pages: [], text: "" };
        docs.push(current);
      }
      current.pages.push(idx + 1);
      current.text += "\n" + (txt || "");
      return;
    }

    if (!current || current.docId !== docId) {
      current = { docId, pages: [], text: "" };
      docs.push(current);
    }

    current.pages.push(idx + 1);
    current.text += "\n" + (txt || "");
  });

  console.log(`[PDFtoArcgis] Documentos iniciais: ${docs.length}`);
  docs.forEach(d => console.log(`  - ID: ${d.docId}, Páginas: ${d.pages.join(", ")}`));

  // IMPROVEMENT: Try to recover SEM_ID docs by combining with adjacent IDs
  // If a "SEM_ID" doc is surrounded by docs with the same ID, merge with them
  const improvedDocs = [];
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];

    if (doc.docId !== "SEM_ID") {
      improvedDocs.push(doc);
      continue;
    }

    // If SEM_ID, try to find ID in nearby context
    let foundId = null;

    // Look for ID in previous doc (if exists and page gap is small)
    if (i > 0 && docs[i - 1].docId !== "SEM_ID") {
      const prevPages = docs[i - 1].pages;
      const currPages = doc.pages;
      const gap = Math.min(...currPages) - Math.max(...prevPages);
      if (gap <= 3) {  // Se separado por até 3 páginas, considerar como mesma matrícula
        foundId = docs[i - 1].docId;
      }
    }

    // Look for ID in next doc (if previous not found)
    if (!foundId && i < docs.length - 1 && docs[i + 1].docId !== "SEM_ID") {
      const currPages = doc.pages;
      const nextPages = docs[i + 1].pages;
      const gap = Math.min(...nextPages) - Math.max(...currPages);
      if (gap <= 3) {  // Se separado por até 3 páginas
        foundId = docs[i + 1].docId;
      }
    }

    // If found ID, use it; else, keep as SEM_ID and log
    const pageStr = Array.isArray(doc.pages) ? doc.pages.join(", ") : (typeof doc.pages === 'string' ? doc.pages : "(desconhecido)");
    if (foundId) {
      doc.docId = foundId;
      console.log(`[PDFtoArcgis] Recuperado ID ${foundId} para páginas ${pageStr}`);
    } else {
      console.warn(`[PDFtoArcgis] ⚠️ Não foi possível recuperar ID para páginas ${pageStr}`);
    }

    improvedDocs.push(doc);
  }

  // IMPROVEMENT: Detect/correct PROTOCOLO IDs surrounded by MATRÍCULA (DISABLED: caused merging of valid docs with different IDs)
  // This heuristic should only be used for "SEM_ID" docs, not valid IDs
  console.log(`[PDFtoArcgis] Heurística de correção desabilitada para não quebrar documentos com múltiplos IDs válidos`);

  // Now merge docs with the SAME ID even if not consecutive
  const mergedDocs = [];
  const processedIds = new Set();

  for (const doc of improvedDocs) {
    if (processedIds.has(doc.docId)) {
      continue;  // Already processed as part of a group
    }

    // Find ALL docs with this ID
    const docsWithSameId = improvedDocs.filter(d => d.docId === doc.docId);

    if (docsWithSameId.length > 1) {
      // Multiple docs with this ID - merge
      const merged = {
        docId: doc.docId,
        pages: [],
        text: ""
      };

      for (const d of docsWithSameId) {
        merged.pages.push(...d.pages);
        merged.text += "\n" + d.text;
        processedIds.add(d.docId);
      }

      // Sort pages
      merged.pages.sort((a, b) => a - b);

      console.log(`[PDFtoArcgis] Mesclando ${docsWithSameId.length} fragmentos da matrícula ${doc.docId}: páginas ${merged.pages.join(", ")}`);
      mergedDocs.push(merged);
    } else {
      // Only one doc with this ID
      mergedDocs.push(doc);
      processedIds.add(doc.docId);
    }
  }

  return mergedDocs.filter(d => (d.text || "").trim().length > 0);
}

function classifyDocType(text) {
  const s = (text || "").toLowerCase();
  const score = (rx) => (rx.test(s) ? 1 : 0);

  const isInteiroTeor = score(/inteiro\s+teor/) + score(/certifico\s+e\s+dou\s+fé/) +
    score(/registro\s+de\s+im[óo]veis/) + score(/funarpen|selo\s+de\s+fiscaliza/);
  if (isInteiroTeor >= 2) return { type: 'inteiro_teor', confidence: 'alta' };

  const isMemorial = score(/memorial\s+descritivo/) + score(/azimute|rumo/) + score(/dist[aâ]ncia/) +
    score(/limita-se\s+com|confronta/);
  if (isMemorial >= 2) return { type: 'memorial', confidence: isMemorial >= 3 ? 'alta' : 'média' };

  const isTabela = score(/\b(e\s*=?\s*\d{5,})\b.*\b(n\s*=?\s*\d{6,})\b/i) +
    score(/coordenadas\s+utm|este\s*\(x\)|norte\s*\(y\)/);
  if (isTabela >= 1) return { type: 'planta_tabela', confidence: 'média' };

  return { type: 'desconhecido', confidence: 'baixa' };
}

// === UI: document ID selector ===
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
  // Support both array of pages (v2.0) and string (v3.0)
  const pages = Array.isArray(doc.pages)
    ? doc.pages.join(", ")
    : (typeof doc.pages === 'string' ? doc.pages : "(desconhecido)");
  const warns = (doc.warnings || []).length;

  if (docMeta) docMeta.textContent = `Páginas: ${pages}\nCRS: ${projKey}${epsg ? " (" + epsg + ")" : ""}\nAlertas: ${warns}`;

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

// === Display table ===
function displayResults() {
  resultBox.style.display = "block";
  countDisplay.innerText = extractedCoordinates.length;
  previewTableBody.innerHTML = "";
  for (const c of extractedCoordinates) {
    previewTableBody.innerHTML += `
      <tr>
        <td>${c.ordem}</td>
        <td>${c.id}</td>
        <td>${c.north}</td>
        <td>${c.east}</td>
        <td>${c.distCalc}</td>
        <td>${c.azCalc}</td>
      </tr>`;
  }
  scrollToResults();
}

// === PDF PROCESSING (Full OCR → processExtractUnified) ===
// Option B: Full OCR here + delegate full pipeline to processExtractUnified(pagesText)

fileInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  // Reset de UI
  fileNameBase = file.name.replace(/\.[^/.]+$/, "");
  pdfOrigemNomeBase = file.name.replace(/\.[^/.]+$/, "");
  pdfOrigemSrc = file.name;
  document.getElementById("fileNameDisplay").innerText = file.name;

  progressContainer.style.display = "block";
  resultBox.style.display = "none";
  statusDiv.style.display = "none";
  previewTableBody.innerHTML = "";
  extractedCoordinates = [];
  documentsResults = [];
  activeDocIndex = -1;

  try {
    updateStatus("📄 Carregando PDF...", "info");

    // Carrega o PDF
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;

    // === Robust text extraction (OCR/selectable) per page ===
    const pagesText = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      progressBar.value = Math.round((i / pdf.numPages) * 100);
      document.getElementById("progressLabel").innerText = `Lendo página ${i}/${pdf.numPages}...`;

      const page = await pdf.getPage(i);
      // Uses smart function to decide between selectable text and OCR
      const { text: bestText } = await getBestPageText(
        page,
        i,
        pdfjsLib,
        renderPageToCanvas
      );
      pagesText.push(bestText || "");
    }

    // === Delegation to the decorated pipeline (automatically starts/ends telemetry) ===
    await processExtractUnified(pagesText); // logs/sessões via decorator já existente

    // NOTE: do not hide progressContainer here – processExtractUnified already controls the end of the flow/UX.

  } catch (e) {
    console.error("Erro no processamento:", e);
    updateStatus("Erro: " + e.message, "error");
    // Em caso de erro, esconda a barra de progresso
    try { progressContainer.style.display = "none"; } catch (_) { }
  }
});



// Detects closed polygon cycles in a list of vertices (within tolerance)
function detectPolygonCycles(vertices) {
  if (vertices.length < 3) return [];

  const cycles = [];
  let currentCycle = [];
  const CLOSURE_TOLERANCE = 5; // meters tolerance for closure

  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];

    // If current cycle has enough points, check for closure
    if (currentCycle.length > 2) {
      const firstPoint = currentCycle[0];
      const distance = Math.sqrt(
        Math.pow(v.east - firstPoint.east, 2) +
        Math.pow(v.north - firstPoint.north, 2)
      );

      // If this point closes the polygon (returns to start)
      if (distance < CLOSURE_TOLERANCE) {
        console.log(`[PDFtoArcgis] 🔄 Cycle detected: ${currentCycle.length} vertices (closure at ${distance.toFixed(2)}m)`);
        currentCycle.push({ ...v, isClosure: true }); // Add closing point
        cycles.push(currentCycle);
        currentCycle = [];
        continue; // Do not add this point to next cycle
      }
    }

    currentCycle.push(v);
  }

  // If vertices remain, add as a cycle
  if (currentCycle.length >= 3) {
    console.log(`[PDFtoArcgis] 🔄 Final cycle detected: ${currentCycle.length} vertices`);
    cycles.push(currentCycle);
  }

  console.log(`[PDFtoArcgis] Total cycles detected: ${cycles.length}`);
  return cycles;
}

async function processExtractUnified(pagesText) {

  const MODE = 'geometry-first'; // 'text-first' (current) or 'hybrid'

  let docsUnified = (MODE === 'geometry-first')
    ? await buildGeometryDocs(pagesText)
    : splitPagesIntoDocuments(pagesText);

  // Aggregates pages until a polygon is closed
  async function buildGeometryDocs(pagesText) {
    const docsGeometry = [];
    let buf = { pages: [], text: "", vertsAbs: [], segs: [], usedRelative: false };

    function tryCloseAndFlush() {
      // Check if closed within tolerance
      const cycles = detectPolygonCycles(buf.vertsAbs);
      if (cycles.length) {
        const cycle = cycles[0];
        const pages = [...buf.pages];
        const text = buf.text;
        docsGeometry.push({ docId: null, pages, text, vertices: cycle, mode: 'closed' });
        buf = { pages: [], text: "", vertsAbs: [], segs: [], usedRelative: false };
        return true;
      }
      return false;
    }

    for (let i = 0; i < pagesText.length; i++) {
      const t = pagesText[i] || "";
      const segs = (window.___pdf2gis_patch?.extractAzimuthDistanceFromText_Patch?.(t)) || [];
      let verts = parseVertices(t, getActiveProjectionKey?.() || null);

      // 1) If 3+ absolute vertices, aggregate directly
      if (Array.isArray(verts) && verts.length >= 3) {
        buf.vertsAbs.push(...verts);
      } else if (segs.length >= 2) {
        // 2) No vertices: try to reconstruct by Az+Dist
        // 2.1) Try anchor on this page
        let seed = null;
        const mEN = /\bE\s*=*\s*([0-9\.\,]{5,}).{0,30}N\s*=*\s*([0-9\.\,]{6,})/i.exec(t);
        if (mEN) {
          seed = { east: parseFloat(normalizeNumber(mEN[1])), north: parseFloat(normalizeNumber(mEN[2])) };
        }
        if (!seed && buf.vertsAbs.length >= 1) {
          // Use first absolute vertex found as anchor
          seed = { east: buf.vertsAbs[0].east, north: buf.vertsAbs[0].north };
        }
        const built = seed && window.___pdf2gis_patch?.buildVerticesFromAzimuths
          ? window.___pdf2gis_patch.buildVerticesFromAzimuths(seed, segs)
          : buildRelativePolygonFromAzimuths(segs);
        if (built?.length) {
          buf.vertsAbs.push(...built);
          buf.usedRelative = !seed; // mark if relative
        }
        buf.segs.push(...segs);
      }

      // Update buffer of pages/text and try to close
      buf.pages.push(i + 1);
      buf.text += "\n" + t;

      // Try to close if at least 3 points
      if ((buf.vertsAbs?.length || 0) >= 3) {
        const closed = tryCloseAndFlush();
        if (!closed && buf.vertsAbs.length > 400) {
          // Avoid growing too much without closing — force flush as "not closed"
          docsGeometry.push({ docId: null, pages: [...buf.pages], text: buf.text, vertices: buf.vertsAbs, mode: 'open' });
          buf = { pages: [], text: "", vertsAbs: [], segs: [], usedRelative: false };
        }
      }
    }

    // If something left not closed => save as "open/relative"
    if (buf.pages.length) {
      docsGeometry.push({ docId: null, pages: [...buf.pages], text: buf.text, vertices: buf.vertsAbs, mode: buf.usedRelative ? 'relative' : 'open' });
    }

    return docsGeometry;
  }


  // 0) Split by document/ID
  const docs = splitPagesIntoDocuments(pagesText); // you already have this function
  documentsResults = [];

  for (const doc of docs) {
    const docId = doc.docId || `doc_${Date.now()}`;
    try { window.__log?.startDocTelemetry?.({ docId }); } catch (_) { }
    window.__log?.group?.(`[processExtractUnified] doc=${docId}`);

    try {
      const fullText = doc.text || "";

      // 1) Detect CRS per doc
      let det = detectProjectionFromText(fullText);
      let projKey = det?.key || null;

      // 2) Extract vertices per doc (EN/LatLon/Az+Dist seedless)
      let rawVertices = parseVertices(fullText, projKey);
      window.__log?.log?.('parseVertices', 'Resumo', { vertices: rawVertices?.length ?? 0 });

      // --- Azimuth + Distance: try if EN/LatLon did not yield 3+ vertices ---
      const segs = window.__pdf2gis_patch?.extractAzimuthDistanceFromText_Patch?.(fullText) || [];
      let usedRelative = false;

      if ((!rawVertices || rawVertices.length < 3) && Array.isArray(segs) && segs.length >= 2) {
        // 1) Look for seeds (in already parsed EN, loose in text, or Lat/Lon → UTM)
        const seedCandidates = findSeedCandidates(fullText, rawVertices);

        if (seedCandidates.length > 0) {
          // existing anchor — reconstruct directly in UTM (absolute)
          const { east, north } = seedCandidates[0];

          if (window.__pdf2gis_patch?.buildVerticesFromAzimuths) {
            const built = window.__pdf2gis_patch.buildVerticesFromAzimuths({ east, north }, segs);
            rawVertices = Array.isArray(built) ? built : [];
          } else {
            // Se a função não existir por algum motivo, cair para relativo
            rawVertices = buildRelativePolygonFromAzimuths(segs);
            usedRelative = true;
          }

          // If reconstruction returned <3 vertices, use relative
          if (!rawVertices || rawVertices.length < 3) {
            rawVertices = buildRelativePolygonFromAzimuths(segs);
            usedRelative = true;
          }
        } else {
          // 2) No anchor — build RELATIVE polygon (0,0) and mark as pending
          rawVertices = buildRelativePolygonFromAzimuths(segs);
          usedRelative = true;
        }
      }

      // === Late-binding: TRY to anchor relative polygon, if possible ===
      if (usedRelative) {
        const lateSeeds = findSeedCandidates(fullText, []); // buscar âncoras no texto deste doc
        if (lateSeeds.length > 0) {
          rawVertices = anchorRelativePolygon(rawVertices, lateSeeds[0]);
          usedRelative = false; // agora é absoluto
        }
      }

      // === If still relative, do NOT validate UTM; just register and continue to next doc ===
      if (usedRelative) {
        // Relative vertex measures for output enrichment
        const relVerts = rawVertices.map((pt, i) => {
          const out = { ...pt, ordem: i + 1 };
          if (i < rawVertices.length - 1) {
            out.distCalc = calcularDistancia(pt, rawVertices[i + 1]).toFixed(2);
            out.azCalc = calcularAzimute(pt, rawVertices[i + 1]).toFixed(4);
          } else {
            out.distCalc = '---';
            out.azCalc = '---';
          }
          return out;
        });

        const topologyRel = validatePolygonTopology(relVerts, null); // validate shape only
        const memorialData = extractAzimuthDistanceFromText(fullText);

        const warnings = [
          'Relative polygon — missing E/N or Lat/Lon (need 1 point) to georeference.'
        ];
        warnings.push(...topologyRel.warnings);

        documentsResults.push({
          docId,
          pages: doc.pages,
          polygonIndex: 1,
          projectionKey: '(pendente — sem âncora)',
          projectionInfo: { key: null, confidence: 'baixa', reason: 'Az+Dist sem seed' },
          vertices: topologyRel.corrected || relVerts,
          warnings,
          topology: topologyRel,
          memorialValidation: null,
          memorialData
        });

        window.__log?.endDocTelemetry?.({
          projection: '(pendente — sem âncora)',
          vertices: (topologyRel.corrected || relVerts).length,
          warnings
        });
        window.__log?.groupEnd?.();
        continue; // continue to next doc
      }

      // 3) Validate/fix per doc, using detected CRS (SAD69/SIRGAS/WGS)
      let validation = validateAndFixCoordinates(rawVertices, projKey);
      let valid = validation.valid;

      // 3.1) Brazil fallback per doc (if <3 valid)
      if (valid.length < 3) {
        const ns = rawVertices.map(v => v.north).filter(n => n > 6.45e6 && n < 10.5e6);
        if (ns.length) {
          const med = ns.slice().sort((a, b) => a - b)[Math.floor(ns.length / 2)];
          let zone = null;
          if (med >= 6.45e6 && med < 6.80e6) zone = "21S";
          else if (med >= 7.15e6 && med < 7.45e6) zone = "22S";
          else if (med >= 8.00e6 && med < 9.00e6) zone = "23S";
          else if (med >= 9.00e6 && med < 10.00e6) zone = "24S";
          else zone = "22S";
          const datum = (projKey && projKey.startsWith("SAD69")) ? "SAD69" : "SIRGAS2000";
          projKey = `${datum}_${zone}`;
          det = { key: projKey, reason: "Inferido fallback Brasil (por doc)", confidence: "média" };
          validation = validateAndFixCoordinates(rawVertices, projKey);
          valid = validation.valid;
        }
      }

      // 4) Auto-fix (stuck decimals), if UTM
      const fixes = (projKey && projKey !== "WGS84") ? autoFixUtmDecimals(valid) : [];
      if (fixes.length) console.log(`[PDFtoArcgis] ✓ Auto-fix aplicado: ${fixes.join("; ")}`);

      // 5) Detect cycles per doc
      const cycles = detectPolygonCycles(valid);
      if (!cycles.length) {
        // Register doc without cycle (counts as 1 doc in UI)
        const warnings = ['Sem ciclos detectados — não foi possível fechar o polígono.'];
        const memorialData = extractAzimuthDistanceFromText(fullText);

        // (optional) calculate sequential dist/az for table only
        const vertsSeq = valid.map((pt, i, arr) => {
          const out = { ...pt, ordem: i + 1 };
          if (i < arr.length - 1) {
            out.distCalc = calcularDistancia(pt, arr[i + 1]).toFixed(2);
            out.azCalc = calcularAzimute(pt, arr[i + 1]).toFixed(4);
          } else {
            out.distCalc = '---';
            out.azCalc = '---';
          }
          return out;
        });

        const topology = {
          isValid: false,
          errors: ['Sem ciclos detectados'],
          warnings: [...warnings],
          area: 0,
          intersections: [],
          closed: false,
          corrected: vertsSeq
        };

        documentsResults.push({
          docId,
          pages: doc.pages,
          polygonIndex: 1,
          projectionKey: projKey,
          projectionInfo: det,
          vertices: vertsSeq,
          warnings,
          topology,
          memorialValidation: null,
          memorialData
        });

        window.__log?.endDocTelemetry?.({
          projection: projKey || '(indefinido)',
          vertices: vertsSeq.length,
          warnings
        });
        window.__log?.groupEnd?.();
        continue;
      }

      // 6) Measures between vertices
      const cycleVertices = cycles[0];
      const verts = cycleVertices.map((pt, i) => {
        pt.ordem = i + 1;
        if (i < cycleVertices.length - 1) {
          pt.distCalc = calcularDistancia(pt, cycleVertices[i + 1]).toFixed(2);
          pt.azCalc = calcularAzimute(pt, cycleVertices[i + 1]).toFixed(4);
        } else {
          pt.distCalc = "---";
          pt.azCalc = "---";
        }
        return pt;
      });

      // 7) Remove consecutive duplicates
      const cleaned = [];
      for (const p of verts) {
        const last = cleaned[cleaned.length - 1];
        if (!last || last.east !== p.east || last.north !== p.north) cleaned.push(p);
      }

      // 8) Topology
      const topology = validatePolygonTopology(cleaned, projKey);

      // 9) Memorial (optional)
      const memorialData = extractAzimuthDistanceFromText(fullText);
      const memorialValidation = memorialData.azimutes?.length > 0
        ? validateMemorialCoherence(cleaned, memorialData, projKey)
        : null;

      // 10) Warnings
      const warnings = [];
      warnings.push(...validateCoords(cleaned, projKey));
      warnings.push(...topology.warnings);
      if (memorialValidation?.issues?.length) warnings.push(...memorialValidation.issues);

      documentsResults.push({
        docId,
        pages: doc.pages,
        polygonIndex: 1,
        projectionKey: projKey,
        projectionInfo: det,
        vertices: topology.corrected || cleaned,
        warnings,
        topology,
        memorialValidation,
        memorialData
      });

      // Telemetria do doc
      const summary = {
        projection: projKey || '(indefinido)',
        vertices: (topology.corrected || cleaned).length,
        warnings
      };
      window.__log?.endDocTelemetry?.(summary);
      window.__log?.groupEnd?.();

    } catch (e) {
      window.__log?.err?.('processExtractUnified', 'Exceção', { error: e?.stack || e?.message });
      window.__log?.endDocTelemetry?.({ error: e?.message || 'unknown' });
      window.__log?.groupEnd?.();
    }
  }

  // 11) UI final
  progressContainer.style.display = "none";

  const totalPolygons = documentsResults.length;
  const validPolygons = documentsResults.filter(d => (d.vertices || []).length >= 3 && d.topology?.isValid).length;
  const warningPolygons = documentsResults.filter(d => (d.vertices || []).length >= 3 && !d.topology?.isValid).length;

  updateStatus(
    `✅ PDF processado. Documentos: ${totalPolygons} | Válidos: ${validPolygons} | Com avisos: ${warningPolygons}`,
    (validPolygons === totalPolygons) ? "success" : (warningPolygons > 0 ? "warning" : "info")
  );

  const firstIdx = documentsResults.findIndex(d => (d.vertices || []).length > 0);
  activeDocIndex = firstIdx >= 0 ? firstIdx : 0;
  renderDocSelector();
}




// === LOG BLOCK 4/5: Decorator processExtractUnified (resiliente) ===========
(function () {
  if (window.__procDecorated) return;

  function tryDecorate() {
    if (window.__procDecorated) return;
    if (typeof window.processExtractUnified !== 'function') {
      setTimeout(tryDecorate, 50);
      return;
    }

    const original = window.processExtractUnified;

    window.processExtractUnified = async function (...args) {
      const doc = (typeof getSelectedDoc === 'function' && getSelectedDoc()) || {};
      const docId = doc?.docId || 'N/D';
      __log.startDocTelemetry({ docId });
      __log.group(`processExtractUnified doc=${docId}`);
      const t0 = performance.now();

      try {
        const result = await original.apply(this, args);
        const t1 = performance.now();

        const dr = (typeof getSelectedDoc === 'function' && getSelectedDoc()) || {};
        const metrics = {
          projection: (dr.manualProjectionKey || dr.projectionKey || (typeof getActiveProjectionKey === 'function' && getActiveProjectionKey()) || '—'),
          vertices: Array.isArray(dr.vertices) ? dr.vertices.length : 0,
          warnings: dr.warnings || [],
        };

        __log.log('processExtractUnified', 'Concluído', { durMs: +(t1 - t0).toFixed(1), ...metrics });
        __log.endDocTelemetry({ ...metrics, durationMs: +(t1 - t0).toFixed(1) });
        __log.groupEnd();
        return result;

      } catch (e) {
        __log.err('processExtractUnified', 'Exceção', { error: e?.stack || e?.message });
        __log.endDocTelemetry({ error: e?.message || 'unknown' });
        __log.groupEnd();
        throw e;
      }
    };

    window.__procDecorated = true;
  }

  // tenta decorar agora e re-tenta até a função existir
  tryDecorate();
})();



/* ===== LEGACY: Mantém função antiga para compatibilidade ===== */
function processExtractUnified_legacy(pagesText) {
  const docs = splitPagesIntoDocuments(pagesText);

  let det = detectProjectionFromText(pagesText.join("\n"));
  let projKey = det.key || null;

  documentsResults = [];

  for (const doc of docs) {
    const raw = parseVertices(doc.text, projKey);

    if (!raw || raw.length < 3) continue;

    const fixes = (projKey && projKey !== "WGS84") ? autoFixUtmDecimals(raw) : [];

    // 1. Calcular distâncias e azimutes com validação
    const vertices = raw.map((pt, i) => {
      pt.ordem = i + 1;
      if (i < raw.length - 1) {
        pt.distCalc = calcularDistancia(pt, raw[i + 1]).toFixed(2);
        pt.azCalc = calcularAzimute(pt, raw[i + 1]).toFixed(4);
      } else {
        pt.distCalc = "---";
        pt.azCalc = "---";
      }
      return pt;
    });



    // 2. Remover duplicados consecutivos
    const cleaned = [];
    for (const p of vertices) {
      const last = cleaned[cleaned.length - 1];
      if (!last || last.east !== p.east || last.north !== p.north) cleaned.push(p);
    }

    // 3. NOVO: Validação topológica completa
    const topologyValidation = validatePolygonTopology(cleaned, projKey);

    // 4. NOVO: Validação de coerência com memorial
    const memorialData = extractAzimuthDistanceFromText(doc.text);
    const memorialValidation = memorialData.azimutes.length > 0
      ? validateMemorialCoherence(cleaned, memorialData, projKey)
      : null;

    // 5. Construir warnings com informações detalhadas
    const warnings = [];
    if (!projKey) warnings.push("⚠️ CRS não identificado; use o modo avançado.");
    if (fixes.length) warnings.push(`✓ ${fixes.length} correção(ões) automática(s) aplicada(s)`);
    warnings.push(...validateCoords(cleaned, projKey));

    // Adicionar avisos topológicos
    if (!topologyValidation.isValid) {
      warnings.push(...topologyValidation.errors.map(e => `❌ ${e}`));
    }
    warnings.push(...topologyValidation.warnings.map(w => w));

    // Avisos de coerência com memorial
    if (memorialValidation && memorialValidation.issues.length > 0) {
      warnings.push(...memorialValidation.issues.map(i => `⚠️ ${i}`));
    }

    // 6. Aplicar correção de ordenação se necessário
    const finalVertices = topologyValidation.corrected || cleaned;

    documentsResults.push({
      docId: doc.docId,
      pages: doc.pages,
      projectionKey: projKey,
      manualProjectionKey: null,
      projectionInfo: det,
      vertices: finalVertices,
      warnings,
      topology: topologyValidation,
      memorialValidation,
      memorialData
    });
  }



  progressContainer.style.display = "none";

  // Estatísticas de qualidade
  const totalDocs = documentsResults.length;
  const okDocs = documentsResults.filter(d => (d.vertices || []).length >= 3 && d.topology?.isValid).length;
  const warningDocs = documentsResults.filter(d => (d.vertices || []).length >= 3 && !d.topology?.isValid).length;

  updateStatus(
    `✅ PDF processado. Matrículas: ${totalDocs} | Polígonos válidos: ${okDocs} | Com avisos: ${warningDocs}`,
    okDocs === totalDocs ? "success" : (warningDocs > 0 ? "warning" : "info")
  );

  const firstIdx = documentsResults.findIndex(d => (d.vertices || []).length > 0);
  activeDocIndex = firstIdx >= 0 ? firstIdx : 0;

  renderDocSelector();
}

function reprojIfNeeded(vertices, projectionKey) {
  if (!Array.isArray(vertices) || vertices.length === 0) return vertices;

  // Só reprojeta se o doc está em SAD69_* e quisermos exportar em SIRGAS2000_*
  const m = /^SAD69_(\d{2}S)$/.exec(projectionKey || "");
  if (!m) return vertices;

  const zone = m[1]; // "22S" ou "23S" etc.
  const src = PROJECTIONS[projectionKey]?.epsg || PROJECTIONS[projectionKey]?.wkt;
  const dstKey = `SIRGAS2000_${zone}`;
  const dst = PROJECTIONS[dstKey]?.epsg || PROJECTIONS[dstKey]?.wkt;

  if (typeof proj4 !== "function" || !src || !dst) {
    console.warn("[PDFtoArcgis] proj4/src/dst não disponível para reprojeção; exportando no datum original.");
    return vertices;
  }

  return vertices.map(v => {
    // proj4 espera [lon/lat] ou [x/y] conforme SRC/DST; aqui estamos em coordenadas projetadas,
    // então a transformação é direta no plano (UTM) de EPSG SAD69 → SIRGAS2000 equivalente
    const p = proj4(src, dst, [v.east, v.north]);
    return { ...v, east: p[0], north: p[1] };
  });
}


/* =========================
   EXPORT CSV (matrícula selecionada)
========================= */
downloadBtn.onclick = () => {
  if (!extractedCoordinates.length) return;

  try {
    // Documento ativo e CRS atual
    const doc = getSelectedDoc();
    const key = doc?.manualProjectionKey || doc?.projectionKey || getActiveProjectionKey();
    const isSad = /^SAD69_(\d{2}S)$/.test(key || "");

    // 1) Vértices a exportar:
    //    - Se for SAD69_* → reprojeta para SIRGAS2000_* apenas para a exportação
    const verticesForExport = reprojIfNeeded(doc?.vertices || extractedCoordinates, key);

    // 2) Definir a "projectionKey" alvo para cabeçalho EPSG e nome do arquivo
    const targetProjKey = isSad ? key.replace(/^SAD69_/, "SIRGAS2000_") : (key || "SIRGAS2000_22S");
    const epsg = PROJECTIONS[targetProjKey]?.epsg || "";
    const crsName = targetProjKey.replace(/[^\w]/g, "_"); // p/ compor o nome

    // 3) Gerar CSV (diagnóstico profissional)
    const csv = gerarCsvParaVertices(
      verticesForExport,
      epsg,
      doc?.docId || "DESCONHECIDA",
      doc?.topology,
      doc?.memorialValidation
    );

    // 4) Baixar CSV (já reprojetado, se necessário)
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    // Incluir nome do PDF de origem e src no nome do arquivo; indicar SIRGAS2000 se houve conversão
    const baseName = pdfOrigemNomeBase || fileNameBase || "coordenadas";
    const srcName = pdfOrigemSrc || "src";
    link.download = `${baseName}_${crsName}_Validado_${srcName}.csv`;
    link.click();

    // 5) Também exportar relatório, se houver validação
    if (doc?.topology || doc?.memorialValidation) {
      const relatorio = gerarRelatorioValidacao(
        doc?.docId || "DESCONHECIDA",
        doc?.pages,
        doc?.topology,
        doc?.memorialValidation,
        doc?.warnings
      );
      const linkRel = document.createElement("a");
      linkRel.href = URL.createObjectURL(new Blob([relatorio], { type: "text/plain;charset=utf-8;" }));
      linkRel.download = `${baseName}_${crsName}_Relatorio_${srcName}.txt`;
      linkRel.click();
    }
  } catch (e) {
    // Se o usuário cancelar o download, não mostrar erro
    if (e && e.name !== "AbortError") {
      updateStatus("Erro ao baixar arquivo: " + e.message, "error");
    }
  }
};

/* =========================
   SALVAR NA PASTA (SHP + CSV por matrícula)
========================= */
const toArrayBufferFS = (view) => view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);

saveToFolderBtn.onclick = async () => {
  const hasDocs = Array.isArray(documentsResults) && documentsResults.length > 0;
  if (!hasDocs && !extractedCoordinates.length) return alert("⚠️ Processe um arquivo primeiro.");

  if (!("showDirectoryPicker" in window)) {
    updateStatus("❌ Seu navegador não suporta showDirectoryPicker. Use Edge/Chrome em HTTPS.", "error");
    return;
  }

  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });

    const writeFile = async (name, data) => {
      try {
        // Remove se já existir
        try { await handle.removeEntry(name); } catch (_) { }
        const fh = await handle.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await w.write(data);
        await w.close();
      } catch (err) {
        if (err && err.name === "AbortError") return;
        const fh = await handle.getFileHandle(name, { create: true });
        const w = await fh.createWritable({ keepExistingData: false });
        await w.write(data);
        await w.close();
      }
    };

    // =========================
    // Caso PDF simples (sem split)
    // =========================
    if (!hasDocs) {
      // CRS de origem (doc/seleção)
      const srcKey = getActiveProjectionKey();
      const srcProj = PROJECTIONS[srcKey];
      if (!srcProj) throw new Error("CRS não suportado.");

      // Se for SAD69_XXS → exportar em SIRGAS2000_XXS
      const isSad = /^SAD69_(\d{2}S)$/.test(srcKey || "");
      const targetKey = isSad ? srcKey.replace(/^SAD69_/, "SIRGAS2000_") : srcKey;
      const targetProj = PROJECTIONS[targetKey] || srcProj;

      // Reprojetar os vértices para o destino (se necessário)
      const vertsOut = reprojIfNeeded(extractedCoordinates, srcKey);

      const base = sanitizeFileName(fileNameBase);
      updateStatus("🗂️ Gravando SHP + CSV na pasta...", "info");

      // Nomes “amigáveis” com EPSG de destino
      let crsName = (targetProj && targetProj.epsg) ? targetProj.epsg : "CRS";
      crsName = String(crsName).replace(/[^\w\d]/g, "_");

      // --- POLYGON (limite) ---
      // anel/fechamento
      const ring = vertsOut.map(c => [c.east, c.north]);
      if (ring.length > 2) {
        const f = ring[0], l = ring[ring.length - 1];
        if (f[0] !== l[0] || f[1] !== l[1]) ring.push(f);
      }
      await new Promise((resolve, reject) => {
        window.shpwrite.write(
          [{ NOME: base, VERTICES: vertsOut.length, EPSG: targetProj.epsg, TIPO: "LIMITE" }],
          "POLYGON",
          [[[ring]]],
          async (err, files) => {
            if (err) return reject(err);
            try {
              await writeFile(`${base}_${crsName}_limite.shp`, toArrayBufferFS(files.shp));
              await new Promise(r => setTimeout(r, 50));
              await writeFile(`${base}_${crsName}_limite.shx`, toArrayBufferFS(files.shx));
              await new Promise(r => setTimeout(r, 50));
              await writeFile(`${base}_${crsName}_limite.dbf`, toArrayBufferFS(files.dbf));
              await new Promise(r => setTimeout(r, 50));
              await writeFile(`${base}_${crsName}_limite.prj`, targetProj.wkt); // PRJ do destino
              resolve();
            } catch (e) { reject(e); }
          }
        );
      });

      // --- POINT (vértices) ---
      const pointGeoms = vertsOut.map(c => [c.east, c.north]);
      const pointProps = vertsOut.map(c => ({
        ID: String(c.id).slice(0, 20),
        ORDEM: c.ordem,
        NORTH: c.north,
        EAST: c.east,
        EPSG: targetProj.epsg
      }));
      await new Promise((resolve, reject) => {
        window.shpwrite.write(
          pointProps,
          "POINT",
          pointGeoms,
          async (err, files) => {
            if (err) return reject(err);
            try {
              await writeFile(`${base}_${crsName}_vertices.shp`, toArrayBufferFS(files.shp));
              await new Promise(r => setTimeout(r, 50));
              await writeFile(`${base}_${crsName}_vertices.shx`, toArrayBufferFS(files.shx));
              await new Promise(r => setTimeout(r, 50));
              await writeFile(`${base}_${crsName}_vertices.dbf`, toArrayBufferFS(files.dbf));
              await new Promise(r => setTimeout(r, 50));
              await writeFile(`${base}_${crsName}_vertices.prj`, targetProj.wkt); // PRJ do destino
              resolve();
            } catch (e) { reject(e); }
          }
        );
      });

      // --- CSV (no CRS de destino) ---
      const csv = gerarCsvParaVertices(vertsOut, targetProj.epsg, fileNameBase);
      await writeFile(`${base}_${crsName}_Validado.csv`, csv);

      updateStatus("✅ Gravado: limite + vertices + CSV (em SIRGAS, com .prj de destino)!", "success");
      return;
    }

    // =========================
    // Caso PDF unificado (todas as matrículas)
    // =========================
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

      const srcKey = doc.manualProjectionKey || doc.projectionKey || getActiveProjectionKey();
      const srcProj = PROJECTIONS[srcKey];
      if (!srcProj) {
        skipped.push(`Arquivo ${pdfOrigemSrc || "src"}: CRS não suportado (${srcKey})`);
        continue;
      }

      // Se for SAD69_* → exportar em SIRGAS2000_*
      const isSad = /^SAD69_(\d{2}S)$/.test(srcKey || "");
      const targetKey = isSad ? srcKey.replace(/^SAD69_/, "SIRGAS2000_") : srcKey;
      const targetProj = PROJECTIONS[targetKey] || srcProj;

      // Reprojetar os vértices para o destino (se necessário)
      const vertsOut = reprojIfNeeded(vertices, srcKey);

      const base = sanitizeFileName(pdfOrigemNomeBase || fileNameBase);
      let crsName = targetProj && targetProj.epsg ? targetProj.epsg : "CRS";
      crsName = String(crsName).replace(/[^\w\d]/g, "_");

      // --- POLYGON (limite) ---
      const ring = vertsOut.map(c => [c.east, c.north]);
      if (ring.length > 2) {
        const f = ring[0], l = ring[ring.length - 1];
        if (f[0] !== l[0] || f[1] !== l[1]) ring.push(f);
      }
      await new Promise((resolve, reject) => {
        window.shpwrite.write(
          [{ NOME: base, VERTICES: vertsOut.length, EPSG: targetProj.epsg, TIPO: "LIMITE" }],
          "POLYGON",
          [[[ring]]],
          async (err, files) => {
            if (err) return reject(err);
            try {
              await writeFile(`${base}_${crsName}_limite.shp`, toArrayBufferFS(files.shp));
              await new Promise(r => setTimeout(r, 50));
              await writeFile(`${base}_${crsName}_limite.shx`, toArrayBufferFS(files.shx));
              await new Promise(r => setTimeout(r, 50));
              await writeFile(`${base}_${crsName}_limite.dbf`, toArrayBufferFS(files.dbf));
              await new Promise(r => setTimeout(r, 50));
              await writeFile(`${base}_${crsName}_limite.prj`, targetProj.wkt); // PRJ do destino
              resolve();
            } catch (e) { reject(e); }
          }
        );
      });

      // --- POINT (vértices) ---
      const pointGeoms = vertsOut.map(c => [c.east, c.north]);
      const pointProps = vertsOut.map(c => ({
        ID: String(c.id).slice(0, 20),
        ORDEM: c.ordem,
        NORTH: c.north,
        EAST: c.east,
        EPSG: targetProj.epsg
      }));
      await new Promise((resolve, reject) => {
        window.shpwrite.write(
          pointProps,
          "POINT",
          pointGeoms,
          async (err, files) => {
            if (err) return reject(err);
            try {
              await writeFile(`${base}_${crsName}_vertices.shp`, toArrayBufferFS(files.shp));
              await new Promise(r => setTimeout(r, 50));
              await writeFile(`${base}_${crsName}_vertices.shx`, toArrayBufferFS(files.shx));
              await new Promise(r => setTimeout(r, 50));
              await writeFile(`${base}_${crsName}_vertices.dbf`, toArrayBufferFS(files.dbf));
              await new Promise(r => setTimeout(r, 50));
              await writeFile(`${base}_${crsName}_vertices.prj`, targetProj.wkt); // PRJ do destino
              resolve();
            } catch (e) { reject(e); }
          }
        );
      });

      // --- CSV por doc (no CRS de destino) ---
      const csv = gerarCsvParaVertices(vertsOut, targetProj.epsg, docId, doc.topology, doc.memorialValidation);
      await writeFile(`${base}_${crsName}_Validado.csv`, csv);

      // --- Relatório por doc (opcional) ---
      if (doc.topology || doc.memorialValidation) {
        let safePages = Array.isArray(doc.pages) ? doc.pages : (typeof doc.pages === 'string' ? doc.pages : '(desconhecido)');
        const relatorio = gerarRelatorioValidacao(docId, safePages, doc.topology, doc.memorialValidation, doc.warnings);
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
    updateStatus("Erro ao salvar na pasta: " + e.message, "error");
  }
};


// === ELEMENTOS NOVOS ===
const shpInput = document.getElementById("shpInput");
const memorialMetaBox = document.getElementById("memorialMetaBox");
const respTecnicoInput = document.getElementById("respTecnico");
const respCreaInput = document.getElementById("respCrea");
const cidadeDetectadaInput = document.getElementById("cidadeDetectada");
const generateDocxBtn = document.getElementById("generateDocxBtn");

// Estado
let shpVertices = [];
let shpAreaHa = 0;
let shpPerimetroM = 0;
let shpCrsKey = null;
let shpCrsText = "";
let shpPoligonoNome = "";
let shpCityName = "";

// Formatadores (pt-BR)
const BRNumber = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const BRNumber2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function fmtCoordMeters(v) { return BRNumber.format(v); }
function fmtMeters2(v) { return BRNumber2.format(v); }
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
  const t = prjText.toUpperCase();
  if (t.includes("SIRGAS") && t.includes("UTM")) {
    if (t.includes("ZONE 21") || t.includes("ZONA 21")) return "SIRGAS2000_21S";
    if (t.includes("ZONE 22") || t.includes("ZONA 22")) return "SIRGAS2000_22S";
    if (t.includes("ZONE 23") || t.includes("ZONA 23")) return "SIRGAS2000_23S";
    if (t.includes("ZONE 24") || t.includes("ZONA 24")) return "SIRGAS2000_24S";
    if (t.includes("ZONE 25") || t.includes("ZONA 25")) return "SIRGAS2000_25S";
  }
  if (t.includes("SAD") && t.includes("UTM")) {
    if (t.includes("ZONE 22") || t.includes("ZONA 22")) return "SAD69_22S";
    if (t.includes("ZONE 23") || t.includes("ZONA 23")) return "SAD69_23S";
  }
  if (t.includes("WGS") && !t.includes("UTM")) return "WGS84";
  return null;
}
function inferCrsKeyByValues(vertices) {
  const hint = inferCrsByCoordinates(vertices);
  if (hint?.zone) return `SIRGAS2000_${hint.zone}S`;
  return null;
}
function verticesFromGeoJSON(geojson, keyGuess = null) {
  let vertices = [];
  if (!geojson) return vertices;

  let f = null;
  if (geojson.type === "FeatureCollection") f = geojson.features?.[0];
  else if (geojson.type === "Feature") f = geojson;
  else return vertices;

  if (!f || !f.geometry) return vertices;
  const g = f.geometry;

  if (g.type === "Polygon" && Array.isArray(g.coordinates) && g.coordinates.length > 0) {
    const ring = g.coordinates[0];
    vertices = ring.map((xy, i) => ({ id: `V${String(i + 1).padStart(3, '0')}`, east: xy[0], north: xy[1] }));
  }
  else if (g.type === "MultiPolygon" && g.coordinates.length > 0) {
    const ring = g.coordinates[0][0];
    vertices = ring.map((xy, i) => ({ id: `V${String(i + 1).padStart(3, '0')}`, east: xy[0], north: xy[1] }));
  }
  else if (g.type === "Point" && Array.isArray(g.coordinates)) {
    const xy = g.coordinates;
    vertices = [{ id: "V001", east: xy[0], north: xy[1] }];
  }

  if (keyGuess && (keyGuess.startsWith("SIRGAS2000_") || keyGuess.startsWith("SAD69_"))) {
    const zone = parseInt(keyGuess.match(/_(\d{2})S$/)?.[1] || "22", 10);
    const projStr = `+proj=utm +zone=${zone} +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`;
    const inDegrees = vertices.some(v => Math.abs(v.east) <= 180 && Math.abs(v.north) <= 90);
    if (inDegrees) {
      vertices = vertices.map(v => {
        const xy = proj4(proj4.WGS84, projStr, [v.east, v.north]); // [E,N]
        return { ...v, east: xy[0], north: xy[1] };
      });
    }
  }

  const cleaned = [];
  for (const p of vertices) {
    const last = cleaned[cleaned.length - 1];
    if (!last || last.east !== p.east || last.north !== p.north) cleaned.push(p);
  }
  if (cleaned.length >= 3) {
    const first = cleaned[0], last = cleaned[cleaned.length - 1];
    const distClose = Math.hypot(last.east - first.east, last.north - first.north);
    if (distClose > 0.01) cleaned.push({ ...first, id: `V${String(cleaned.length + 1).padStart(3, '0')}` });
  }
  return cleaned;
}
function montarTextoMemorial(vertices, key) {
  let linhas = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    const v1 = vertices[i], v2 = vertices[i + 1];
    const az = calcularAzimute(v1, v2);
    const dist = calcularDistancia(v1, v2);
    const linha =
      `Do vértice ${i + 1} segue até o vértice ${i + 2}, ` +
      `com coordenadas U T M E=${fmtCoordMeters(v2.east)} e N=${fmtCoordMeters(v2.north)}, ` +
      `no azimute de ${toDMS(az)}, na extensão de ${fmtMeters2(dist)} m;`;
    linhas.push(linha);
  }
  return linhas.join(" ");
}
function montarDescricaoArea(nomeArea, vertices, key) {
  const v1 = vertices[0];
  return `A referida ${nomeArea} é delimitada por um polígono irregular cuja descrição ` +
    `se inicia no vértice 1, seguindo sentido horário com coordenadas planas no ` +
    `sistema U T M Este (X) ${fmtCoordMeters(v1.east)} e Norte (Y) ${fmtCoordMeters(v1.north)}, como segue:`;
}
function prepararVerticesComMedidas(vertices) {
  const out = [];
  for (let i = 0; i < vertices.length; i++) {
    const v = { ...vertices[i], ordem: i + 1 };
    if (i < vertices.length - 1) {
      v.distCalc = fmtMeters2(calcularDistancia(vertices[i], vertices[i + 1]));
      v.azCalc = toDMS(calcularAzimute(vertices[i], vertices[i + 1]));
    } else {
      v.distCalc = "---";
      v.azCalc = "---";
    }
    out.push(v);
  }
  return out;
}

// ======== EVENTO: Carregar SHP  =========
if (shpInput) {
  shpInput.addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;

    try {
      updateStatus("🔄 Lendo SHP...", "info");

      // Nome amigável a partir do arquivo
      shpPoligonoNome = file.name
        .replace(/\.[^/.]+$/, "")
        .replace(/_/g, " ")
        .trim();

      // Detecta extensão
      const isZip = file.name.toLowerCase().endsWith(".zip");
      const isShp = file.name.toLowerCase().endsWith(".shp");

      let geojson = null;
      let prjText = null;

      if (isZip) {
        // 1) ZIP → ArrayBuffer → shp(...) → GeoJSON
        const ab = await file.arrayBuffer();
        const geo = await shp(ab); // retorna FeatureCollection/Feature/Geometry
        // Seleciona/força um Polygon a partir do retorno
        geojson = buildFeatureCollectionFromAny(geo);
        // .prj de dentro do ZIP (opcional, mas recomendado)
        prjText = await extractPrjFromZip(file);
      }
      if (isZip) {
        // 1) ZIP → ArrayBuffer → leitor tolerante (agrega múltiplos layers)
        const ab = await file.arrayBuffer();
        geojson = await readZipAsFeatureCollection(ab);
        // .prj de dentro do ZIP (opcional, mas recomendado)
        prjText = await extractPrjFromZip(file);
      }
      else if (isShp) {
        // 2) .shp "solto"
        // Observação: parseShp normalmente retorna um anel (coords) ou array de anéis
        const shpBuf = await file.arrayBuffer();
        const geom = await shp.parseShp(shpBuf); // [[x,y], [x,y], ...] ou múltiplos
        const ring = Array.isArray(geom) ? geom : [];
        const geometry = { type: "Polygon", coordinates: [ring] };

        geojson = {
          type: "FeatureCollection",
          features: [{ type: "Feature", properties: {}, geometry }]
        };
        // Sem ZIP, normalmente não há .prj — CRS virá por inferência
      }
      else {
        throw new Error("Formato não suportado. Use .zip (SHP+DBF+PRJ) ou .shp.");
      }

      // Diagnóstico rápido do GeoJSON
      logGeojsonSummary(geojson);

      // === CRS ===
      shpCrsKey = resolveCrsKeyFromPrj(prjText);
      // Vertices no CRS de entrada (para heurísticas)
      let vertsRaw = verticesFromGeoJSON(geojson, shpCrsKey);
      console.log("[SHP] vertsRaw len:", Array.isArray(vertsRaw) ? vertsRaw.length : vertsRaw);

      if (!shpCrsKey) {
        // Se não veio do .prj, tenta inferir pelos próprios valores
        shpCrsKey = inferCrsKeyByValues(vertsRaw) || "SIRGAS2000_22S";
      }

      // Constrói novamente os vértices já no CRS alvo (normalmente UTM)
      const vertsUTM = verticesFromGeoJSON(geojson, shpCrsKey);
      console.log("[SHP] vertsUTM len:", Array.isArray(vertsUTM) ? vertsUTM.length : vertsUTM);

      if (!Array.isArray(vertsUTM) || vertsUTM.length < 3) {
        console.warn("[SHP] Menos de 3 vértices após parse. Abortando preenchimento de tabela.");
        updateStatus("⚠️ O SHP foi lido, mas não há polígono com 3+ vértices. Verifique se o layer é POLYGON/MULTIPOLYGON (ou se a linha está realmente fechada).", "warning");
        return;
      }

      // === Área (ha) e perímetro (m)
      let signed = 0;
      for (let i = 0; i < vertsUTM.length; i++) {
        const curr = vertsUTM[i];
        const next = vertsUTM[(i + 1) % vertsUTM.length];
        signed += curr.east * next.north - next.east * curr.north;
      }
      shpAreaHa = Math.abs(signed) / 2 / 10000;

      let per = 0;
      for (let i = 0; i < vertsUTM.length - 1; i++) {
        per += calcularDistancia(vertsUTM[i], vertsUTM[i + 1]);
      }
      shpPerimetroM = per;

      // === Inferir cidade (aproximação)
      shpCityName = inferCityFromVertices(vertsUTM, shpCrsKey);
      if (cidadeDetectadaInput) cidadeDetectadaInput.value = shpCityName;

      // === Preparar vértices com medidas para a UI (ordem/dist/azimute)
      shpVertices = prepararVerticesComMedidas(vertsUTM);

      // === Alimentar UI (tabela)
      extractedCoordinates = shpVertices.slice();
      countDisplay.innerText = extractedCoordinates.length;
      previewTableBody.innerHTML = "";
      for (const c of extractedCoordinates) {
        previewTableBody.innerHTML += `
          <tr>
            <td>${c.ordem}</td>
            <td>${c.id}</td>
            <td>${c.north}</td>
            <td>${c.east}</td>
            <td>${c.distCalc}</td>
            <td>${c.azCalc}</td>
          </tr>`;
      }
      resultBox.style.display = "block";
      scrollToResults();

      // Mostrar CRS detectado
      shpCrsText = crsKeyToText(shpCrsKey);
      showDetectedCrsUI(shpCrsKey, { confidence: "alta", reason: "Detectado a partir do .prj e/ou coordenadas." });

      // Exibir bloco de meta para memorial (se existir no HTML)
      if (memorialMetaBox) memorialMetaBox.style.display = "block";

      updateStatus("✅ SHP carregado e processado. Pronto para gerar o DOCX.", "success");
    } catch (e) {
      console.error(e);
      updateStatus("Erro ao ler SHP: " + e.message, "error");
    }
  });
}


// ======== GERAR DOCX ========

if (generateDocxBtn) {
  generateDocxBtn.addEventListener("click", async () => {
    try {
      // 0) Verificação das libs necessárias
      if (!window.docx || !window.docx.Document) {
        updateStatus("❌ Biblioteca DOCX não carregada. Verifique a tag do 'docx.umd.js'.", "error");
        return;
      }
      if (typeof window.saveAs !== "function") {
        updateStatus("❌ FileSaver não carregado. Inclua FileSaver.min.js antes do script.", "error");
        return;
      }

      // 1) Preferir shpVertices; se vazio, usar extractedCoordinates
      let vertsBase =
        (Array.isArray(shpVertices) && shpVertices.length >= 3) ? shpVertices :
          (Array.isArray(extractedCoordinates) ? extractedCoordinates : []);

      console.log("[Memorial] shpVertices.len=", shpVertices?.length, "| extractedCoordinates.len=", extractedCoordinates?.length);

      if (!Array.isArray(vertsBase) || vertsBase.length < 3) {
        updateStatus("⚠️ Carregue um SHP válido (polígono com 3+ vértices) antes.", "warning");
        return;
      }

      // 2) Normalizar tipos (east/north como Number) e IDs/ordem
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

      if (vertsBase.length < 3) {
        updateStatus("⚠️ As coordenadas contêm valores inválidos (NaN).", "warning");
        return;
      }

      // 3) Fechar anel se necessário (para área/perímetro e memorial)
      const first = vertsBase[0];
      const last = vertsBase[vertsBase.length - 1];
      const closed = Math.hypot(last.east - first.east, last.north - first.north) <= 0.01;
      let vertsForDoc = closed ? vertsBase.slice()
        : [...vertsBase, { ...first, id: `V${String(vertsBase.length + 1).padStart(3, "0")}` }];

      // 4) Se faltar dist/az, gerar com a função do seu projeto
      const precisaMedidas = (v) => v.distCalc === undefined || v.azCalc === undefined;
      if (vertsForDoc.some(precisaMedidas)) {
        vertsForDoc = prepararVerticesComMedidas(
          vertsForDoc.map(v => ({ east: v.east, north: v.north, id: v.id }))
        );
      }

      // 5) Metadados (inputs da UI)
      const resp = (respTecnicoInput?.value ?? "").trim();
      const crea = (respCreaInput?.value ?? "").trim();
      let cidade = (cidadeDetectadaInput?.value ?? "").trim();

      // 6) CRS textual
      const crsKey = shpCrsKey || getActiveProjectionKey() || "SIRGAS2000_22S";
      const crsText = (shpCrsText && shpCrsText.trim()) ? shpCrsText : crsKeyToText(crsKey);

      // 7) Cidade (inferir se não informada)
      if (!cidade || cidade === "Município não identificado") {
        cidade = inferCityFromVertices(
          vertsForDoc.map(v => ({ east: v.east, north: v.north })),
          crsKey
        ) || "Curitiba-PR";
      }

      const nomeArea = shpPoligonoNome || "gleba";
      // Data por extenso: "21 de janeiro de 2026"
      function formatarDataPorExtenso(date) {
        const meses = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
        const d = date.getDate();
        const m = meses[date.getMonth()];
        const y = date.getFullYear();
        return `${d} de ${m} de ${y}`;
      }
      const dataBR = formatarDataPorExtenso(new Date());

      // 8) Área (ha) e perímetro (m)
      let signed = 0;
      for (let i = 0; i < vertsForDoc.length; i++) {
        const a = vertsForDoc[i], b = vertsForDoc[(i + 1) % vertsForDoc.length];
        signed += a.east * b.north - b.east * a.north;
      }
      const areaHa = Math.abs(signed) / 2 / 10000;

      let per = 0;
      for (let i = 0; i < vertsForDoc.length - 1; i++) {
        per += calcularDistancia(vertsForDoc[i], vertsForDoc[i + 1]);
      }

      const BRNumber2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const BRNumber3 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
      const areaTxt = BRNumber2.format(areaHa);
      const perTxt = BRNumber2.format(per);

      // 9) Textos do memorial (mantendo suas variáveis se precisar delas, 
      // mas reconstruindo no passo 10 para garantir a formatação negritada correta)
      // const descricao = montarDescricaoArea(nomeArea, vertsForDoc, crsKey);
      // const memorialTxt = montarTextoMemorial(vertsForDoc, crsKey);

      // 10) Geração do DOCX - AJUSTADO PARA O MODELO
      const { Document, Packer, Paragraph, TextRun, AlignmentType, LineSpacingType } = window.docx;

      // Função para espaçamento entre letras (2 espaços)
      function espacarLetras(texto) {
        return texto.split("").join(" ");
      }

      // Função para garantir valor numérico válido
      function safeNumber(val, casas = 2) {
        const n = Number(val);
        return Number.isFinite(n) ? n.toFixed(casas) : "0.00";
      }

      // Garante que todos os segmentos (inclusive o último) sejam incluídos
      const memorialRuns = [];
      for (let i = 0; i < vertsForDoc.length; i++) {
        const vAtual = vertsForDoc[i];
        const vProx = vertsForDoc[(i + 1) % vertsForDoc.length];
        // Calcula distância e azimute se não existirem
        let dist = vProx.distCalc;
        if (!dist || isNaN(Number(dist))) {
          dist = calcularDistancia(vAtual, vProx);
        }
        let azimute = vProx.azCalc;
        if (!azimute) {
          azimute = "00°00'00\"";
        }
        // Coordenadas entre parênteses
        memorialRuns.push(
          new TextRun({
            text: ` Do vértice ${i + 1} segue até o vértice ${((i + 1) % vertsForDoc.length) + 1}, com coordenadas `,
            size: 24, font: "Arial"
          }),
          new TextRun({
            text: `U T M (E=${safeNumber(vProx.east, 3)} e N=${safeNumber(vProx.north, 3)})`,
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
                  text: `A referida gleba é delimitada por um polígono irregular cuja descrição se inicia no vértice 1, seguindo sentido horário com coordenadas planas no sistema U T M (E=${safeNumber(vertsForDoc[0].east, 3)} e N=${safeNumber(vertsForDoc[0].north, 3)}), como segue:`,
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

/** Escolhe o melhor Feature de Polygon/MultiPolygon de um FeatureCollection */
function pickBestPolygonFeature(fc) {
  if (!fc || fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) return null;

  const polys = fc.features.filter(f => {
    const t = f?.geometry?.type;
    return t === "Polygon" || t === "MultiPolygon";
  });

  if (polys.length === 0) return null;

  // Heurística simples: “mais complexo” (mais coords) primeiro
  polys.sort((a, b) => {
    const la = JSON.stringify(a.geometry.coordinates).length;
    const lb = JSON.stringify(b.geometry.coordinates).length;
    return lb - la; // desc
  });

  return polys[0];
}

/** Tenta promover uma LineString em Polygon quando a linha já estiver fechada */
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

/** Força uma geometry qualquer a virar Polygon, quando possível */
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

/** Normaliza qualquer retorno do shp(...) em um FeatureCollection com UM Polygon quando der */
function buildFeatureCollectionFromAny(geo, tol = 0.5) {
  // 1) FeatureCollection
  if (geo && geo.type === "FeatureCollection" && Array.isArray(geo.features)) {
    const best = pickBestPolygonFeature(geo);
    if (best) {
      return { type: "FeatureCollection", features: [best] };
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

/** Log de diagnóstico do GeoJSON (opcional) */
function logGeojsonSummary(geojson) {
  try {
    if (!geojson) {
      console.warn("[SHP] GeoJSON vazio/indefinido.");
      return;
    }
    if (geojson.type === "FeatureCollection") {
      const n = Array.isArray(geojson.features) ? geojson.features.length : 0;
      const gt = n > 0 ? geojson.features[0]?.geometry?.type : "(nenhum)";
      console.log(`[SHP] FC com ${n} feature(s). Primeiro geometry: ${gt}`);
    } else if (geojson.type === "Feature") {
      console.log(`[SHP] Feature isolado. Geometry: ${geojson.geometry?.type || "(desconhecido)"}`);
    } else {
      console.log(`[SHP] Objeto geometry. Type: ${geojson.type || "(desconhecido)"}`);
    }
  } catch (e) {
    console.warn("[SHP] Falha ao sumarizar GeoJSON:", e);
  }
}

async function readZipAsFeatureCollection(ab, tol = 0.5) {
  // 1) Caminho "normal": shp(ab) já tenta montar uma FeatureCollection
  try {
    const geo1 = await shp(ab);
    if (geo1) {
      const fc1 = buildFeatureCollectionFromAny(geo1, tol);
      if (fc1 && Array.isArray(fc1.features) && fc1.features.length > 0) {
        console.log("[SHP] readZip: caminho direto OK (shp(ab)).");
        return fc1;
      }
    }
  } catch (e) {
    console.warn("[SHP] readZip: shp(ab) falhou → tentando parseZip.", e);
  }

  // 2) Caminho "multi-camada": parseZip retorna FC ou um objeto de coleções
  try {
    const parsed = await shp.parseZip(ab);
    // (a) Se já for FeatureCollection
    if (parsed && parsed.type === "FeatureCollection" && Array.isArray(parsed.features)) {
      const fc2 = buildFeatureCollectionFromAny(parsed, tol);
      if (fc2 && fc2.features?.length) {
        console.log("[SHP] readZip: parseZip → FC direta.");
        return fc2;
      }
    }

    // (b) Se for objeto com múltiplas coleções/arrays por chave
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
        console.log(`[SHP] readZip: parseZip → agregado ${features.length} feature(s) de múltiplas chaves.`);
        return { type: "FeatureCollection", features };
      }
    }
  } catch (e) {
    console.warn("[SHP] readZip: parseZip falhou.", e);
  }

  // 3) Sem sucesso: devolve FC vazia para o caller tratar
  console.warn("[SHP] readZip: nenhuma feature encontrada no ZIP.");
  return { type: "FeatureCollection", features: [] };
}

// === LOG BLOCK 5/5: Botão "Exportar LOG" (versão resiliente) ===============
(function () {
  function tryInject() {
    try {
      if (!window.__log?.downloadTelemetry) return;

      const anchor = document.getElementById('saveToFolderBtn');
      if (!anchor) {
        setTimeout(tryInject, 100); // tenta novamente
        return;
      }

      if (document.getElementById('downloadLogBtn')) return;

      const btn = document.createElement('button');
      btn.id = 'downloadLogBtn';
      btn.className = 'btn-gold';
      btn.style.cssText =
        'flex:1; min-width:180px; background-color:#37474f; color:#fff;';
      btn.innerHTML = '<i class="fas fa-file-alt"></i> Exportar LOG';
      btn.onclick = () => window.__log.downloadTelemetry();

      anchor.parentElement.appendChild(btn);
    } catch (_) { }
  }

  tryInject();
})();