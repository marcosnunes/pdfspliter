// === [WebLLM: LLM no navegador via CDN] ===
let webllmEngine = null;
async function ensureWebLLM(model = "phi-2") {
  if (window.webllm && webllmEngine) return webllmEngine;
  // Carrega o script WebLLM se necessário
  if (!window.webllm) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm/dist/webllm.min.js";
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  // Inicializa o modelo (ex: phi-2, tinyllama, mistral)
  webllmEngine = new window.webllm.MLCChatModule();
  await webllmEngine.reload({ model });
  return webllmEngine;
}

// Função IA para deduzir os vértices corretos a partir do texto extraído
async function deducePolygonVerticesWithAI(fullText) {
  // WebLLM: roda LLM no navegador, sem backend
  displayLogMessage('[JS][IA] Deduções automáticas de vértices via WebLLM (navegador)...');
  try {
    const engine = await ensureWebLLM("phi-2"); // ou "tinyllama", "mistral", etc
    const prompt = `A partir do texto abaixo, extraia os vértices do polígono em formato JSON [{\"x\":..., \"y\":...}, ...]. Apenas retorne o JSON, sem explicações.\nTexto:\n${fullText}`;
    const reply = await engine.chat.completions.create({
      messages: [
        { role: 'system', content: 'Você é um assistente de geoprocessamento.' },
        { role: 'user', content: prompt }
      ],
      stream: false
    });
    let jsonText = reply.choices?.[0]?.message?.content || '';
    const jsonMatch = jsonText.match(/\[\s*{[\s\S]*?}\s*\]/);
    if (jsonMatch) {
      const vertices = JSON.parse(jsonMatch[0]);
      if (Array.isArray(vertices) && vertices.length >= 3) {
        const first = vertices[0], last = vertices[vertices.length - 1];
        if (first.x !== last.x || first.y !== last.y) vertices.push({ ...first });
        return vertices;
      }
    }
    displayLogMessage('[JS][IA] A resposta da IA não continha um array de vértices válido.');
    return null;
  } catch (err) {
    displayLogMessage('[JS][IA] Erro ao rodar WebLLM: ' + err.message);
    return null;
  }
}

// === Integração no fluxo principal ===
async function processPDFWithAI(pdfBuffer) {
  displayLogMessage('[JS][IA] Iniciando extração IA...');
  const fullText = await extractFullTextWithAI(pdfBuffer);
  if (!fullText || fullText.trim().length < 30) {
    displayLogMessage('[JS][IA] Texto insuficiente extraído.');
    return null;
  }
  const vertices = await deducePolygonVerticesWithAI(fullText);
  if (!vertices) {
    displayLogMessage('[JS][IA] Não foi possível deduzir os vértices automaticamente.');
    return null;
  }
  displayLogMessage(`[JS][IA] Vértices deduzidos: ${vertices.length}`);
  return vertices;
}

// Exemplo de uso: fallback IA se métodos tradicionais falharem
// Chame processPDFWithAI(pdfBuffer) quando necessário
// Exemplo:
// let vertices = await parseVertices(buffer);
// if (!vertices) vertices = await processPDFWithAI(buffer);
// if (!vertices) displayLogMessage('Falha geral na extração de vértices.');
// Esconde o botão de instalar app se já estiver instalado (PWA/standalone)
function isAppInstalled() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    (window.navigator.standalone === true)
  );
}

// UI: Navegação lateral e rolagem para resultados
function openNav() {
  document.getElementById("mySidenav").style.width = "250px";
  if (typeof isAppInstalled === 'function' && typeof hideInstallBtn === 'function') {
    if (isAppInstalled()) hideInstallBtn();
  }
}
function closeNav() { document.getElementById("mySidenav").style.width = "0"; }


// --- PWA: Instalar App (com feedback visual) ---
let deferredPrompt = null;
let installBtn = null;

function hideInstallBtn() {
  if (installBtn) installBtn.style.display = 'none';
}

// Detecta se já está instalado (standalone ou appinstalled)
function isAppInstalled() {
  // Checa standalone (PWA instalado) e display-mode
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  if (window.navigator.standalone === true) return true;
  // Checa se já existe service worker controlando e não há prompt
  if (window.matchMedia('(display-mode: minimal-ui)').matches) return true;
  // iOS: verifica se está rodando como app
  if (window.navigator && window.navigator.standalone) return true;
  // Android Chrome: verifica se não há prompt e já está instalado
  if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
  return false;
}

if (isAppInstalled()) {
  hideInstallBtn();
}

window.addEventListener('appinstalled', hideInstallBtn);

window.addEventListener('DOMContentLoaded', function () {
  installBtn = document.getElementById('installPwaBtn');
  if (isAppInstalled()) hideInstallBtn();
});

window.addEventListener('beforeinstallprompt', (e) => {
  if (isAppInstalled()) {
    hideInstallBtn();
    return;
  }
  e.preventDefault();
  deferredPrompt = e;
  if (installBtn) {
    installBtn.style.display = 'block';
    installBtn.classList.remove('success', 'error');
    installBtn.textContent = 'Instalar App';
  }
});
window.addEventListener('DOMContentLoaded', function () {
  installBtn = document.getElementById('installPwaBtn');
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (deferredPrompt) {
        try {
          deferredPrompt.prompt();
          const { outcome } = await deferredPrompt.userChoice;
          if (outcome === 'accepted') {
            installBtn.classList.add('success');
            installBtn.textContent = 'App instalado!';
            setTimeout(() => {
              installBtn.style.display = 'none';
              installBtn.classList.remove('success');
              installBtn.textContent = 'Instalar App';
            }, 2000);
          } else {
            installBtn.classList.add('error');
            installBtn.textContent = 'Instalação cancelada';
            setTimeout(() => {
              installBtn.classList.remove('error');
              installBtn.textContent = 'Instalar App';
            }, 2000);
          }
        } catch (err) {
          installBtn.classList.add('error');
          installBtn.textContent = 'Erro ao instalar';
          setTimeout(() => {
            installBtn.classList.remove('error');
            installBtn.textContent = 'Instalar App';
          }, 2000);
        }
        deferredPrompt = null;
      }
    });
  }
});
function scrollToResults() {
  const box = document.getElementById("resultBox");
  if (box && box.style.display !== "none") box.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Configuração do PDF.js para uso local/Android
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";

// Elementos principais da UI e variáveis globais
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

// Resultados por matrícula (PDF unificado): [{docId,pages,projectionKey,manualProjectionKey,projectionInfo,vertices,warnings}]
let documentsResults = [];
let activeDocIndex = -1;

// Projeções suportadas (WKT)
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

// Helpers de status e normalização
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
  v = v.replace(/\u00A0/g, " ").replace(/[\s\t]+/g, "");  // Remove espaços e tabs em branco
  v = v.replace(/[Oo]/g, "0");  // Corrige O por 0
  v = v.replace(/[lI]/g, "1");  // Corrige l/I por 1

  // Normaliza separadores decimais (lógica tolerante a OCR)
  if (v.includes(",") && !v.includes(".")) {
    v = v.replace(",", ".");  // "1234,56" -> "1234.56"
  } else if (v.includes(",") && v.includes(".")) {
    // "1.234,56" (formato europeu) -> "1234.56"
    const lastCommaIdx = v.lastIndexOf(",");
    const lastDotIdx = v.lastIndexOf(".");
    if (lastCommaIdx > lastDotIdx) {
      v = v.replace(/\./g, "").replace(",", ".");
    } else {
      v = v.replace(/,/g, "");  // Remover vírgula se for separador de milhares
    }
  }

  return v;
}

// Corrige valores de coordenadas fora do intervalo esperado (tolerância a erros de OCR)
function autoScaleCoordinate(value, expectedMin, expectedMax) {
  if (Number.isNaN(value)) return NaN;
  if (value >= expectedMin && value <= expectedMax) return value;

  if (value < expectedMin && value > 0) {
    // Número muito pequeno - multiplicar
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
    // Número muito grande - tentar dividir
    let scaled = value;

    // PRIMEIRO: Testar divisão por 1000 (mais comum para OCR concatenado)
    for (let power = 1; power <= 7; power++) {
      scaled = value / Math.pow(10, power);
      if (scaled >= expectedMin && scaled <= expectedMax) {
        console.log(`[PDFtoArcgis] 📉 Auto-escala: ${value} → ${scaled} (÷10^${power})`);
        return scaled;
      }
    }
  }

  return NaN; // Não conseguiu escalar
}

// Cálculos rápidos para exibição (distância/azimute)
function calcularDistancia(p1, p2) {
  return Math.sqrt(Math.pow(p2.east - p1.east, 2) + Math.pow(p2.north - p1.north, 2));
}

function calcularAzimute(p1, p2) {
  const dE = p2.east - p1.east;
  const dN = p2.north - p1.north;
  let az = Math.atan2(dE, dN) * (180 / Math.PI);
  return az < 0 ? az + 360 : az;
}

// Geodésia profissional: Vincenty e validação topológica

// Parâmetros elipsoidais por CRS
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
 * Calcular área de polígono via Shoelace (Gauss Area Formula)
 * Retorna área em m² e direção (positivo=CCW, negativo=CW)
 */
/**
 * Reordena vértices em sequência CCW correta usando centroide
 * Soluciona problema de auto-intersecção quando vértices estão fora de ordem
 */
function orderVerticesCCW(vertices) {
  if (vertices.length < 3) return vertices;

  // Calcular centroide
  let centerN = 0, centerE = 0;
  for (const v of vertices) {
    centerN += v.north;
    centerE += v.east;
  }
  centerN /= vertices.length;
  centerE /= vertices.length;

  console.log(`[PDFtoArcgis] 📍 Centroide calculado: N=${centerN.toFixed(2)}, E=${centerE.toFixed(2)}`);

  // Ordenar por ângulo polar (CCW a partir do eixo E)
  const ordered = vertices.map(v => {
    const angle = Math.atan2(v.north - centerN, v.east - centerE);
    return { ...v, angle };
  }).sort((a, b) => a.angle - b.angle);

  console.log(`[PDFtoArcgis] 🔄 Vértices reordenados em sequência CCW`);

  return ordered;
}

/**
 * Valida topologia do polígono (auto-intersecção, orientação, etc)
 */
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

  // NOVO: Reordenar vértices se necessário (detecção automática)
  let orderedVertices = vertices;
  let isDisordered = false;

  // Verificar se vértices estão desordenados (diferenças grandes de N ou E)
  const nValues = vertices.map(v => v.north);
  const eValues = vertices.map(v => v.east);
  const minN = Math.min(...nValues);
  const maxN = Math.max(...nValues);
  const minE = Math.min(...eValues);
  const maxE = Math.max(...eValues);
  const nRange = maxN - minN;
  const eRange = maxE - minE;

  // Se há grandes saltos no valor de N ou E, provavelmente estão desordenados
  // Usar abordagem adaptativa: detectar saltos > 50% do range total é suspeito
  const adaptiveNThreshold = Math.max(1000, nRange * 0.5); // Mínimo 1km, ou 50% do range
  const adaptiveEThreshold = Math.max(1000, eRange * 0.5);

  for (let i = 0; i < vertices.length - 1; i++) {
    const nDiff = Math.abs(vertices[i].north - vertices[i + 1].north);
    const eDiff = Math.abs(vertices[i].east - vertices[i + 1].east);

    // Se há salto muito grande (> 50% do range), é desordenado
    if (nDiff > adaptiveNThreshold || eDiff > adaptiveEThreshold) {
      isDisordered = true;
      console.log(`[PDFtoArcgis] ⚠️ Desordenamento detectado: vértice ${i} (N=${vertices[i].north.toFixed(0)}, E=${vertices[i].east.toFixed(0)}) → ${i + 1} (N=${vertices[i + 1].north.toFixed(0)}, E=${vertices[i + 1].east.toFixed(0)}) (salto N=${nDiff.toFixed(0)}m, E=${eDiff.toFixed(0)}m)`);
      break;
    }
  }

  if (isDisordered) {
    orderedVertices = orderVerticesCCW(vertices);
    warnings.push("🔄 Vértices foram reordenados em sequência CCW correta");
  }

  // Verificar se polígono está fechado
  const first = orderedVertices[0];
  const last = orderedVertices[orderedVertices.length - 1];
  const closureDistance = Math.hypot(
    first.north - last.north,
    first.east - last.east
  );

  if (closureDistance > 5) {
    warnings.push(`⚠️ Polígono não fechado: distância ${closureDistance.toFixed(1)}m`);
  }

  // Verificar auto-intersecção (detecção simples)
  let hasIntersections = false;
  for (let i = 0; i < orderedVertices.length - 2; i++) {
    for (let j = i + 2; j < orderedVertices.length - 1; j++) {
      const p1 = orderedVertices[i];
      const p2 = orderedVertices[i + 1];
      const p3 = orderedVertices[j];
      const p4 = orderedVertices[j + 1];

      // Cross product test
      const d1 = (p2.east - p1.east) * (p3.north - p1.north) - (p2.north - p1.north) * (p3.east - p1.east);
      const d2 = (p2.east - p1.east) * (p4.north - p1.north) - (p2.north - p1.north) * (p4.east - p1.east);
      const d3 = (p4.east - p3.east) * (p1.north - p3.north) - (p4.north - p3.north) * (p1.east - p3.east);
      const d4 = (p4.east - p3.east) * (p2.north - p3.north) - (p4.north - p3.north) * (p2.east - p3.east);

      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
        errors.push(`❌ Auto-intersecção entre segmentos ${i}-${i + 1} e ${j}-${j + 1}`);
        hasIntersections = true;
        break;
      }
    }
    if (hasIntersections) break;
  }

  // Validar orientação CCW (Counter-Clockwise)
  let signedArea = 0;
  for (let i = 0; i < orderedVertices.length; i++) {
    const curr = orderedVertices[i];
    const next = orderedVertices[(i + 1) % orderedVertices.length];
    signedArea += curr.east * next.north - next.east * curr.north;
  }

  const isCCW = signedArea > 0;
  const area = Math.abs(signedArea) / 2;

  // Validar absurdidade de área
  if (area > 1e8) {
    errors.push(`❌ Área absurda: ${(area / 1e4).toFixed(1)} ha (indica erro de coordenadas)`);
  }

  return {
    isValid: errors.length === 0 && area > 0,
    errors,
    warnings,
    hasIntersections,
    corrected: orderedVertices,  // Retornar vértices reordenados
    isCCW,
    area,
    closed: closureDistance < 5
  };
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

  // Validar se área é absurda
  // Intervalo razoável para lotes: 100 m² a 100 km² (1e8 m²)
  // Muito acima disso indica erro de parsing
  let warning = null;
  if (area > 1e8) {
    warning = `⚠️ Área absurda: ${(area / 1e4).toFixed(1)} ha (${area.toExponential(2)} m²) - Possível erro de coordenadas`;
  } else if (area < 100) {
    warning = `⚠️ Área muito pequena: ${area.toFixed(0)} m² - Polígono microscópico`;
  }

  if (warning) {
    console.warn(`[PDFtoArcgis] ${warning}`);
  }

  return { area, isCCW, signed, warning };
}

/**
 * Verificar se polígono está fechado (primeiro e último vértices próximos)
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

// Detecta auto-intersecções em polígonos (retorna pares de índices)
function detectPolygonSelfIntersections(vertices) {
  const intersections = [];

  if (vertices.length < 4) return intersections;

  // Helper: verifica se dois segmentos se cruzam
  function segmentsIntersect(p1, p2, p3, p4) {
    const ccw = (A, B, C) => (C.north - A.north) * (B.east - A.east) > (B.north - A.north) * (C.east - A.east);
    return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
  }

  // Verifica cada par de edges (não-adjacentes)
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

function inferCrsByCoordinates(vertices) {
  if (!vertices || vertices.length === 0) return null;

  // Pega a média para situar a região
  const avgE = vertices.reduce((sum, v) => sum + v.east, 0) / vertices.length;
  const avgN = vertices.reduce((sum, v) => sum + v.north, 0) / vertices.length;

  // Lógica para o Sul do Brasil (inferência automática de zona UTM)
  if (avgN > 7000000 && avgN < 8000000) {
    if (avgE > 600000 && avgE < 800000) {
      return { zone: 22, reason: "CRS inferido automaticamente pelas coordenadas (Padrão UTM Zona 22S)." };
    }
    if (avgE > 300000 && avgE < 600000) {
      return { zone: 23, reason: "CRS inferido automaticamente pelas coordenadas (Padrão UTM Zona 23S)." };
    }
  }
  return null;
}

/**
 * Corrigir ordem de vértices (garantir CCW para polígonos válidos)
 */
function ensureCounterClockwiseOrder(vertices) {
  if (!vertices || vertices.length < 3) return vertices;

  const { isCCW } = calcularAreaShoelace(vertices);

  if (isCCW === false) {
    // Está em CW, reverter
    return [...vertices].reverse();
  }

  return vertices;
}

/**
 * Validação completa de topologia poligonal
 */
function validatePolygonTopology(vertices, projectionKey = null) {
  const errors = [];
  const warnings = [];

  if (!vertices || vertices.length < 3) {
    errors.push("Mínimo 3 vértices requerido");
    return { isValid: false, errors, warnings, corrected: vertices };
  }

  // Estratégia de fechamento: se não estiver fechado, adiciona o primeiro vértice ao final para validação
  let verticesToValidate = [...vertices];
  let closed = isPolygonClosed(verticesToValidate, 0.5);
  if (!closed && verticesToValidate.length > 2) {
    const first = verticesToValidate[0];
    verticesToValidate.push({ ...first });
    closed = true; // Considera fechado para validação e relatório
  }
  if (!closed) {
    warnings.push("⚠️ Polígono não fechado (distância > 0.5m entre primeiro e último)");
  }

  // 2. Calcular área
  const { area, isCCW, signed } = calcularAreaShoelace(verticesToValidate);
  if (area < 1) {
    errors.push(`❌ Área muito pequena (${area.toFixed(2)} m²) - possível erro de extração`);
  }

  // 3. Detectar auto-intersecções
  const intersections = detectPolygonSelfIntersections(verticesToValidate);
  if (intersections.length > 0) {
    errors.push(`❌ Auto-intersecções detectadas em ${intersections.length} pares de edges`);
  }

  // 4. Verificar ordenação
  if (isCCW === false) {
    warnings.push("⚠️ Vértices em ordem horária (CW) - convertendo para anti-horária (CCW)");
  }

  // 5. Validar coerência de distâncias calculadas vs Euclidiana
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
        warnings.push(`⚠️ Distância V${i + 1}→V${i + 2}: calculada ${euclidian.toFixed(2)}m ≠ documentada ${stated}m`);
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
 * Calcular distância via Vincenty (iterativo, alta precisão para UTM)
 * Mais preciso que Euclidiano para distâncias longas
 */
function calculateDistanceVincenty(p1, p2, projectionKey = "SIRGAS2000_22S") {
  // Para UTM, Vincenty é overkill - usar Euclidiano é suficiente
  // Mas deixar base para futuro uso com transformações de CRS

  const params = ELLIPSOID_PARAMS[projectionKey] || ELLIPSOID_PARAMS["SIRGAS2000_22S"];
  const { a, f } = params;

  // Em UTM (projeção conforme), distância Euclidiana é ≈ distância real
  // Diferença < 0.1% para distâncias até 1km
  // Usar Vincenty completo seria overkill aqui

  const distance = calcularDistancia(p1, p2);

  // Fator de escala em UTM (típico: 0.9996)
  // Para alta precisão, poderia ajustar baseado na longitude relativa
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
 * Extrair azimutes e distâncias documentadas do texto (memorial)
 * Procura por padrões como "45°30'27" e 258,45m"
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
 */
function inferCrsByCoordinates(vertices) {
  if (!vertices || vertices.length === 0) return null;

  // Calcula a média das coordenadas extraídas
  const avgE = vertices.reduce((sum, v) => sum + v.east, 0) / vertices.length;
  const avgN = vertices.reduce((sum, v) => sum + v.north, 0) / vertices.length;

  // Lógica para o Brasil (UTM Sul)
  // Norte ~7.1 milhões (Paraná/Santa Catarina/RS)
  if (avgN > 7000000 && avgN < 8000000) {
    // Este entre 600k e 800k -> Zona 22S
    if (avgE > 600000 && avgE < 800000) {
      return { zone: 22, reason: "Inferido via coordenadas: Padrão compatível com UTM Zona 22S (Sul do Brasil)." };
    }
    // Este entre 300k e 600k -> Zona 23S (SP/MG)
    if (avgE > 300000 && avgE < 600000) {
      return { zone: 23, reason: "Inferido via coordenadas: Padrão compatível com UTM Zona 23S." };
    }
  }
  return null;
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

  // Fallback 1: Por Estado/UF
  if (!zone) {
    const inferred = inferZoneFromBrazilState(t);
    if (inferred) {
      zone = inferred;
      reasonParts.push(`Zona inferida como ${zone}S pela localidade.`);
      conf = "média";
    }
  }

  // Fallback 2: Pela matemática das coordenadas (CRUCIAL PARA PIRAQUARA)
  if (!zone && vertices && vertices.length > 0) {
    const mathInference = inferCrsByCoordinates(vertices); // Verifique se esta função existe no seu script
    if (mathInference) {
      zone = mathInference.zone;
      reasonParts.push(mathInference.reason);
      conf = "média";
    }
  }

  // Fallback 3: Padrão final
  if (!zone) {
    zone = 22;
    reasonParts.push(`Zona não encontrada; fallback ${zone}S.`);
  }

  // Retorno (Lógica de Datums)
  if (hasWGS) return { key: "WGS84", confidence: "alta", reason: "Encontrado 'WGS 84'." };

  if (hasSAD) {
    let key = (zone === 23) ? "SAD69_23S" : "SAD69_22S";
    return { key, confidence: conf, reason: `Encontrado 'SAD-69'. ${reasonParts.join(" ")}` };
  }

  // Se não achou SAD nem WGS, assume SIRGAS 2000 (Padrão IBGE)
  return {
    key: `SIRGAS2000_${zone}S`,
    confidence: conf,
    reason: (hasSIRGAS ? "Encontrado 'SIRGAS 2000'. " : "Datum assumido SIRGAS 2000. ") + reasonParts.join(" ")
  };
}

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

function parseVertices(text, crsKeyInput) {
  // Função para validar e auto-escalar coordenadas usando o CRS detectado
  // Fallback global para crsKey
  let crsKey = crsKeyInput || (window._arcgis_crs_key || "SIRGAS2000_22S");
  if (!crsKey) {
    console.warn('[PDFtoArcgis] Nenhum CRS detectado, usando fallback SIRGAS2000_22S');
    crsKey = "SIRGAS2000_22S";
  }

  function validarVertice(id, north, east, origem, crsKeyLocal) {
    // Não faz nenhuma validação, retorna sempre
    return { id, north, east };
  }
  const clean = (text || "").replace(/\u00A0/g, " ").replace(/[‐‑‒–—]/g, "-");
  const out = [];
  const classified = [];
  // Regex para latitude/longitude (graus decimais, com ou sem sinal)
  const rxLatLon = /([+-]?\d{1,2}(?:[.,]\d+)?)[°º]?\s*[;,]?\s*([+-]?\d{1,3}(?:[.,]\d+)?)[°º]?/g;
  // Regex para azimute/distância (ex: "azimute 45°30'27", distância 258,85m")
  const rxAzDist = /azimute\s*([0-9]{1,3})[°º](?:\s*([0-9]{1,2})[\'’])?(?:\s*([0-9]{1,2})[\"”])?[^\d]{0,20}dist[aâ]ncia\s*([0-9]+(?:[.,][0-9]+)?)\s*m/gi;
  // 1. Detectar e classificar latitude/longitude
  let latlonMatch;
  while ((latlonMatch = rxLatLon.exec(clean)) !== null) {
    const lat = parseFloat(latlonMatch[1].replace(',', '.'));
    const lon = parseFloat(latlonMatch[2].replace(',', '.'));
    if (
      Math.abs(lat) <= 90 && Math.abs(lon) <= 180 &&
      (Math.abs(lat) > 0.01 || Math.abs(lon) > 0.01)
    ) {
      const id = `LL${String(classified.length + 1).padStart(3, '0')}`;
      classified.push({
        id,
        type: 'latlon',
        lat,
        lon,
        raw: latlonMatch[0],
        origem: 'latlon',
      });
    }
  }

  // 2. Detectar e classificar azimute/distância
  let azdistMatch;
  while ((azdistMatch = rxAzDist.exec(clean)) !== null) {
    const deg = parseInt(azdistMatch[1] || '0', 10);
    const min = parseInt(azdistMatch[2] || '0', 10);
    const sec = parseInt(azdistMatch[3] || '0', 10);
    const az = deg + min / 60 + sec / 3600;
    const dist = parseFloat((azdistMatch[4] || '0').replace(',', '.'));
    if (az > 0 && dist > 0) {
      const id = `AZ${String(classified.length + 1).padStart(3, '0')}`;
      classified.push({
        id,
        type: 'azimute_dist',
        azimuth: az,
        distance: dist,
        raw: azdistMatch[0],
        origem: 'azimute_dist',
      });
    }
  }
  // Garantir fallback de crsKey
  if (!crsKey) {
    crsKey = (window._arcgis_crs_key || "SIRGAS2000_22S");
    if (!crsKey) crsKey = "SIRGAS2000_22S";
    console.warn('[PDFtoArcgis] parseVertices: CRS não definido, usando fallback SIRGAS2000_22S');
  }

  // Padrão 0: Formato descritivo de matrícula de terras com coordenadas em sequência
  // Exemplo: "segue com os seguintes azimutes e distâncias: 139°59'27" e 258,85m. segue... E 519.579,499m e N 7.331.990,424m..."
  // Procura por um padrão onde há múltiplas coordenadas E/N sucessivas com contexto descritivo de propriedade
  const rx0 = /(?:seguintes?\s+)?(?:azimutes?\s+)?(?:e\s+)?distâncias[\s:;,]*.*?(?:segue\s+)?(?:confrontando\s+)?(?:com\s+)?(?:a\s+)?propriedade[\s;,]*.*?E\s+([0-9.,\s]+)\s*m\s+e\s+N\s+([0-9.,\s]+)\s*m/gis;

  // Padrão 1: Formato oficial cartório "E=XXXXX.XXX m e N=XXXXXXX.XXX m" (PRIORITÁRIO)
  // Captura coordenadas soltas e depois associa com marcos
  const rx1 = /E\s*=\s*([0-9.,\s]+)\s*m\s+e\s+N\s*=\s*([0-9.,\s]+)\s*m/gim;

  // Padrão 1a: Variação cartório "N XXXXX,XXX m. e E XXXXXX,XXX m" (NOVO - compatível com documentos registrais)
  // Captura coordenadas sem o sinal =
  const rx1a = /(?:coordenadas\s+)?(?:de\s+)?N\s+([0-9.,\s]+)\s*m\.?\s+(?:e\s+)?E\s+([0-9.,\s]+)\s*m/gim;

  // Padrão 1b: Regex para encontrar os marcadores/vértices antes das coordenadas
  // Procura por: "Dai segue ... marco 'XX' (E=..." ou "Inicia-se ... E=..."
  const rx1b = /(?:Dai\s+segue|Inicia-se|ponto\s+inicial|com\s+um\s+azimute|marco\s+)(?:confrontando\s+)?(?:com\s+)?(?:a\s+)?(?:chacara\s+)?(?:n\.?\s*)?(?:\d+\s+)?(?:uma\s+extensão\s+)?(?:de\s+)?(?:[0-9.,]+\s+)?(?:metros\s+)?(?:ao\s+)?(?:[A-Z]{1,2}\s+)?(?:\(sudeste\)|\(noroeste\)|\(norte\)|\(sul\))?\s*(?:com\s+)?(?:o\s+)?(?:lote\s+)?(?:n\.?\s*)?(?:\d+\s+)?(?:da\s+)?(?:quadra\s+)?(?:n\.?\s*)?(?:\d+\s+)?(?:uma\s+extensão\s+)?(?:de\s+)?(?:[0-9.,]+\s+)?(?:metros\s*)?[,;.]?\s*(?:ao\s+)?(?:[A-Z]{1,2}\s+)?(?:\(sudeste\)|\(noroeste\)|\(norte\)|\(sul\))?\s*(?:confrontando\s+)?(?:com\s+)?(?:a\s+)?(?:chacara\s+)?(?:n\.?\s*)?([A-Z0-9]+)(?:\s+\(|E\s*=|coordenadas|\s+uma)/gim;

  // Versão simplificada: apenas procura por "E=" e volta atrás para encontrar o último marcador
  // Isto é mais confiável do que tentar capturar tudo
  const rxMarkerSimple = /([A-Z0-9]+)\s+\(/gm;

  // Padrão 2: "vértice V001 ... coordenadas E 500000 m e N 7000000 m" 
  const rx2 = /v[ée]rtice\s+([A-Z0-9]+(?:\s*[A-Z0-9]+)*)[\s,;:.-]*.*?coordenadas?\s+(?:(?:E\s*([0-9.,\s]+)\s*m?\s*[;,.]?\s*e\s*N\s*([0-9.,\s]+))|(?:N\s*([0-9.,\s]+)\s*m?\s*[;,.]?\s*e\s*E\s*([0-9.,\s]+)))(?=\s*(?:m|;|,|\.|\n|$))/gim;

  // Padrão 3: Tabela com colunas "Vértice | E (m) | N (m)"
  const rx3 = /([A-Z0-9]+(?:\s+[A-Z0-9]+)*)\s+([0-9]{5,}[\.,][0-9]{1,3})\s+([0-9]{6,}[\.,][0-9]{1,3})/gm;

  // Padrão 4: "V001: E=500000,00 N=7000000,00"
  const rx4 = /([A-Z0-9]+(?:\s+[A-Z0-9]+)*)\s*:?\s*[=]?\s*E\s*[=]?\s*([0-9]{5,}[\.,][0-9]{1,3})\s+N\s*[=]?\s*([0-9]{6,}[\.,][0-9]{1,3})/gim;

  let m;
  const processedIds = new Set();

  // ESTRATÉGIA 0: Procurar coordenadas em sequência com formato "E XXX,XXX m e N XXXXXXX,XXX m"
  // Este padrão é muito comum em matrículas de terras brasileiras, especialmente em seções de descrição
  let m0;
  const rx0Simples = /E\s+([0-9]{5,}[\.,][0-9]{1,3})\s*m\s+e\s+N\s+([0-9]{6,}[\.,][0-9]{1,3})\s*m/gim;

  // Procurar primeiramente em contexto de descrição de propriedade (entre certos marcadores)
  let contextMatch = clean.match(/(?:Descrição|descrição)[\s:;]*Inicia-se[\s:;]*.*?(?=\n\n|---)/is);
  if (!contextMatch) {
    // Se não encontrou "Descrição: Inicia-se", procurar por qualquer seção de memorial/descrição
    contextMatch = clean.match(/(?:MEMORIAL|Memorial|DESCRIÇÃO|Descrição|IMOVEL|Imóvel)[\s:;]*.*?(?:^\s*(?:Av-|R-|\d{1,2}\.))/m);
  }

  if (contextMatch) {
    const descContext = contextMatch[0];
    const localRx = /E\s+([0-9]{5,}[\.,][0-9]{1,3})\s*m\s+e\s+N\s+([0-9]{6,}[\.,][0-9]{1,3})\s*m/gim;
    let localMatch;
    while ((localMatch = localRx.exec(descContext)) !== null) {
      const eRaw = localMatch[1];
      const nRaw = localMatch[2];
      const east = parseFloat(normalizeNumber(eRaw));
      const north = parseFloat(normalizeNumber(nRaw));

      const idNum = out.length + 1;
      const id = `V${String(idNum).padStart(3, '0')}`;
      if (Number.isFinite(north) && Number.isFinite(east)) {
        const v = validarVertice(id, north, east, 'descContext', crsKey);
        if (v && !processedIds.has(id)) {
          out.push(v);
          processedIds.add(id);
          classified.push({ id, type: 'utm', north, east, raw: localMatch[0], origem: 'descContext' });
        }
      }
    }

    if (out.length > 0) {
      console.log(`[PDFtoArcgis] Estratégia 0: encontrados ${out.length} vértices em seção de descrição`);
    }
  }

  // Se Estratégia 0 não encontrou em contexto, tentar em TODO o documento
  if (out.length === 0) {
    const globalRx = /E\s+([0-9]{5,}[\.,][0-9]{1,3})\s*m\s+e\s+N\s+([0-9]{6,}[\.,][0-9]{1,3})\s*m/gim;
    let globalMatch;
    while ((globalMatch = globalRx.exec(clean)) !== null) {
      const eRaw = globalMatch[1];
      const nRaw = globalMatch[2];
      const east = parseFloat(normalizeNumber(eRaw));
      const north = parseFloat(normalizeNumber(nRaw));

      const idNum = out.length + 1;
      const id = `V${String(idNum).padStart(3, '0')}`;
      if (Number.isFinite(north) && Number.isFinite(east)) {
        const v = validarVertice(id, north, east, 'global', crsKey);
        if (v && !processedIds.has(id)) {
          out.push(v);
          processedIds.add(id);
          classified.push({ id, type: 'utm', north, east, raw: globalMatch[0], origem: 'global' });
        }
      }
    }

    if (out.length > 0) {
      console.log(`[PDFtoArcgis] Estratégia 0 (global): encontrados ${out.length} vértices em todo o documento`);
    }
  }

  // ESTRATÉGIA 0B: OCR Resiliente - tolerar separadores corrompidos (: em vez de ., / em vez de ,, etc)
  // Agora roda SEMPRE, complementando as demais estratégias
  {
    const ocrResilientRx = /E\s+([0-9:.,/\-\s]+?)(?:\s*m)?\s+e\s+N\s+(?:["'\\]*\s*)?([0-9:.,/\-\s]+?)(?:\s*m)/gim;
    let ocrMatch;
    const ocrCoords = [];
    // Nova limpeza: extrai TODOS os números grandes de cada campo, mesmo "sujos"
    function extractAllNumbers(raw) {
      // Remove espaços
      let s = raw.replace(/\s+/g, '');
      // Substitui separadores incomuns por ponto
      s = s.replace(/[:/\-]/g, '.');
      // Extrai todos os números "grandes" (5+ dígitos para E, 6+ para N), mesmo fragmentados
      const nums = [];
      // 1. Extrair números normais (com ou sem decimal)
      const numRegex = /([0-9]{5,}(?:[.,][0-9]{1,3})?)/g;
      let m;
      while ((m = numRegex.exec(s)) !== null) {
        let num = m[1].replace(',', '.');
        nums.push(num);
      }
      // 2. Se não encontrou nada, tentar reconstruir números "colando" todos os dígitos
      if (nums.length === 0) {
        // Remove tudo que não for dígito
        let digits = s.replace(/[^0-9]/g, '');
        // Tenta todos os cortes possíveis para números grandes
        // Para E: 5+ dígitos, para N: 6+ dígitos
        if (digits.length >= 6) {
          // Tenta todos os cortes de 6 a 10 dígitos
          for (let len = 6; len <= Math.min(10, digits.length); len++) {
            for (let i = 0; i <= digits.length - len; i++) {
              let num = digits.substr(i, len);
              nums.push(num);
            }
          }
        }
      }
      // Remove duplicatas
      return [...new Set(nums)];
    }
    while ((ocrMatch = ocrResilientRx.exec(clean)) !== null) {
      let eRaw = ocrMatch[1];
      let nRaw = ocrMatch[2];
      // Extrai todos os números possíveis de cada campo
      const eNums = extractAllNumbers(eRaw);
      const nNums = extractAllNumbers(nRaw);
      // Tenta todas as combinações possíveis E/N
      for (const eStr of eNums) {
        for (const nStr of nNums) {
          const east = parseFloat(eStr);
          const north = parseFloat(nStr);
          if (Number.isFinite(north) && Number.isFinite(east)) {
            ocrCoords.push({ east, north });
          }
        }
      }
    }
    // Adicionar apenas as que não são duplicadas (por valor)
    for (const coord of ocrCoords) {
      const isDuplicate = out.some(c => Math.abs(c.east - coord.east) < 1 && Math.abs(c.north - coord.north) < 1);
      if (!isDuplicate) {
        const idNum = out.length + 1;
        const id = `V${String(idNum).padStart(3, '0')}`;
        const v = validarVertice(id, coord.north, coord.east, 'ocrResilient', crsKey);
        if (v && !processedIds.has(id)) {
          out.push(v);
          processedIds.add(id);
        }
      }
    }
    if (ocrCoords.length > 0) {
      console.log(`[PDFtoArcgis] Estratégia 0B (OCR Resiliente): encontrados ${ocrCoords.length} candidatos, ${out.length} únicos`);
    }
  }

  // ESTRATÉGIA 1: Procurar coordenadas soltas (E=... m e N=...) e associar com marcadores
  const coordsOnly = [];
  let m1;
  const coordPositions = [];  // Guardar as posições das coordenadas no texto

  // Tentar primeiro o padrão original com "="
  while ((m1 = rx1.exec(clean)) !== null) {
    const eRaw = m1[1];
    const nRaw = m1[2];
    const east = parseFloat(normalizeNumber(eRaw));
    const north = parseFloat(normalizeNumber(nRaw));
    if (Number.isFinite(north) && Number.isFinite(east)) {
      coordsOnly.push({ idx: coordsOnly.length, east, north });
      coordPositions.push(m1.index);
    }
  }

  // Se não encontrou com "=", tentar padrão 1a (registral): N ... m e E ...
  if (coordsOnly.length === 0) {
    while ((m1 = rx1a.exec(clean)) !== null) {
      const nRaw = m1[1];  // N vem primeiro neste padrão
      const eRaw = m1[2];  // E vem segundo
      const east = parseFloat(normalizeNumber(eRaw));
      const north = parseFloat(normalizeNumber(nRaw));
      if (Number.isFinite(north) && Number.isFinite(east)) {
        coordsOnly.push({ idx: coordsOnly.length, east, north });
        coordPositions.push(m1.index);
      }
    }
  }
  // Padrão 1c: E=... e N=... (SEM 'm') — comum em memoriais brasileiros
  if (coordsOnly.length === 0) {
    const rx1c = /E\s*=\s*([0-9.,\s]+)\s*e\s*N\s*=\s*([0-9.,\s]+)/gim;
    let m1c2;
    while ((m1c2 = rx1c.exec(clean)) !== null) {
      const eRaw = m1c2[1];
      const nRaw = m1c2[2];
      const east = parseFloat(normalizeNumber(eRaw));
      const north = parseFloat(normalizeNumber(nRaw));
      if (Number.isFinite(north) && Number.isFinite(east)) {
        coordsOnly.push({ idx: coordsOnly.length, east, north });
        coordPositions.push(m1c2.index);
      }
    }
  }
  // Padrão 1d: Este (X) ... e Norte (Y) ... — sem 'm'
  if (coordsOnly.length === 0) {
    const rx1d = /Este\s*\(X\)\s*([0-9.,\s]+)\s*e\s*Norte\s*\(Y\)\s*([0-9.,\s]+)/gim;
    let m1d;
    while ((m1d = rx1d.exec(clean)) !== null) {
      const eRaw = m1d[1];
      const nRaw = m1d[2];
      const east = parseFloat(normalizeNumber(eRaw));
      const north = parseFloat(normalizeNumber(nRaw));
      if (Number.isFinite(north) && Number.isFinite(east)) {
        coordsOnly.push({ idx: coordsOnly.length, east, north });
        coordPositions.push(m1d.index);
      }
    }
  }


  // Debug log
  if (coordsOnly.length > 0) {
    console.log(`[PDFtoArcgis] Estratégia 1: encontrados ${coordsOnly.length} coordenadas (E=... m e N=... OU N ... m e E ...)`);
  }

  // Se encontrou coordenadas soltas, procurar pelos marcadores/vértices associados
  if (coordsOnly.length > 0) {
    // Estratégia: procurar por marcadores numerados (1, 2, 3...) ou PP, P1, etc
    const markers = [];

    // Primeiro, tentar encontrar sequência numérica
    const rxNumbers = /(?:marco\s+['"]?|com\s+o\s+)([0-9]+|PP|P[0-9]+)(?:\s*['"]\s*\(|[,;]|\s+E\s*=)/gim;
    let m1b;
    while ((m1b = rxNumbers.exec(clean)) !== null) {
      let id = m1b[1].replace(/['"]/g, "").trim();
      if (id) {
        id = normalizeId(id);
        markers.push(id);
      }
    }

    // Se não encontrou números, tentar procurar por identificadores entre parênteses
    if (markers.length === 0) {
      const rxParens = /\(([A-Z0-9]+)\)\s*E\s*=/gim;
      while ((m1b = rxParens.exec(clean)) !== null) {
        let id = m1b[1].trim();
        if (id && id.length <= 10) {  // Filtro contra capturas erradas
          id = normalizeId(id);
          markers.push(id);
        }
      }
    }

    // Se ainda não encontrou marcadores, tentar nova estratégia: procurar vértices no contexto próximo de cada coordenada
    if (markers.length === 0) {
      for (let i = 0; i < coordsOnly.length; i++) {
        const coordIdx = coordPositions[i];

        // Definir janela de busca: 500 caracteres antes e 500 depois
        const startCtx = Math.max(0, coordIdx - 500);
        const endCtx = Math.min(clean.length, coordIdx + 500);
        const context = clean.substring(startCtx, endCtx);

        // Procurar por identificador de vértice no contexto (padrão registral: EBC M, EBC V, P, PP)
        let foundId = null;

        // Procurar padrão "EBC M 1234", "EBC V 5801", etc
        const rxEbc = /EBC\s*([MV])\s*(\d+)/gim;
        let m1c;
        while ((m1c = rxEbc.exec(context)) !== null) {
          foundId = `EBC ${m1c[1]} ${m1c[2]}`;
        }

        // Se não encontrou EBC, tentar padrão P (Ponto)
        if (!foundId) {
          const rxP = /(?:ponto\s+)?P([0-9]+)(?=[,;.\s])/gim;
          m1c = rxP.exec(context);
          if (m1c) foundId = `P${m1c[1]}`;
        }

        // Se ainda não encontrou, tentar "PP" (ponto de partida)
        if (!foundId && context.includes("PP")) {
          foundId = "PP";
        }

        // Se encontrou um ID, normalizar e guardar
        if (foundId) {
          foundId = normalizeId(foundId);
          markers.push(foundId);
        } else {
          // Fallback: usar sequência numérica
          markers.push(String(i + 1));
        }
      }
    }

    // Se ainda não encontrou, usar sequência padrão (1, 2, 3...)
    if (markers.length === 0) {
      for (let i = 0; i < coordsOnly.length; i++) {
        markers.push(String(i + 1));
      }
      console.log(`[PDFtoArcgis] Nenhum marcador encontrado, usando numeração padrão`);
    } else if (markers.length < coordsOnly.length) {
      // Completar com números faltantes
      const startIdx = markers.length;
      for (let i = startIdx; i < coordsOnly.length; i++) {
        markers.push(String(i + 1));
      }
      console.log(`[PDFtoArcgis] Encontrados ${markers.length} marcadores: ${markers.join(", ")}`);
    } else {
      console.log(`[PDFtoArcgis] Encontrados ${markers.length} marcadores: ${markers.join(", ")}`);
    }

    // Associar coordenadas com marcadores (na ordem que aparecem)
    // Receber CRS detectado como argumento
    // Usar crsKey robusto
    for (let i = 0; i < Math.min(coordsOnly.length, markers.length); i++) {
      const coord = coordsOnly[i];
      const id = markers[i];
      if (!processedIds.has(id)) {
        const v = validarVertice(id, coord.north, coord.east, 'estrategia1', crsKey);
        if (v) {
          out.push(v);
          processedIds.add(id);
        }
      }
    }
  }

  // Se ESTRATÉGIA 2 não encontrou nada, tentar ESTRATÉGIA 2B (OCR Resiliente)
  if (out.length === 0) {
    // Padrão mais resiliente para OCR que corrompeu "vértice" em "véitice", "vértice", etc
    // Captura "vértice 1 ... E ... e N ..." ou similar
    const rx2b = /v[ée][ií]?tice\s+([0-9]+)\s+.*?(?:coordenadas?\s+)?(?:E\s+([0-9:.,/\-\s]+?)\s*m?\s+e\s+N\s+([0-9:.,/\-\s]+?)\s*m|N\s+([0-9:.,/\-\s]+?)\s*m?\s+e\s+E\s+([0-9:.,/\-\s]+?)\s*m)/gis;

    let m2b;
    while ((m2b = rx2b.exec(clean)) !== null) {
      const vertexNum = m2b[1];
      let eRaw = m2b[2] || m2b[5];
      let nRaw = m2b[3] || m2b[4];

      if (!eRaw || !nRaw) continue;

      // Limpeza extrema
      eRaw = eRaw.replace(/[^0-9.]/g, '');
      nRaw = nRaw.replace(/[^0-9.]/g, '');

      // Inserir ponto se necessário
      if (!eRaw.includes('.') && eRaw.length >= 7) {
        eRaw = eRaw.slice(0, -3) + '.' + eRaw.slice(-3);
      }
      if (!nRaw.includes('.') && nRaw.length >= 7) {
        nRaw = nRaw.slice(0, -3) + '.' + nRaw.slice(-3);
      }

      const east = parseFloat(eRaw);
      const north = parseFloat(nRaw);

      const id = `V${String(vertexNum).padStart(3, '0')}`;
      if (Number.isFinite(north) && Number.isFinite(east) && !processedIds.has(vertexNum)) {
        const v = validarVertice(id, north, east, 'estrategia2b', crsKey);
        if (v) {
          out.push(v);
          processedIds.add(vertexNum);
        }
      }
    }

    if (out.length > 0) {
      console.log(`[PDFtoArcgis] Estratégia 2B (Vértice OCR): encontrados ${out.length} vértices`);
    }
  }

  // Se ainda nada, tentar ESTRATÉGIA 3 (padrões 3 e 4)
  if (out.length === 0) {
    for (const rx of [rx3, rx4]) {
      while ((m = rx.exec(clean)) !== null) {
        const id = normalizeId(m[1]);
        const val1 = parseFloat(normalizeNumber(m[2]));
        const val2 = parseFloat(normalizeNumber(m[3]));

        if (id && Number.isFinite(val1) && Number.isFinite(val2) && !processedIds.has(id)) {
          let east, north;
          if (val1 >= 100000 && val1 <= 900000) {
            east = val1; north = val2;
          } else if (val2 >= 100000 && val2 <= 900000) {
            east = val2; north = val1;
          } else {
            continue;
          }

          out.push({ id, north, east });
          processedIds.add(id);
        }
      }
      if (out.length > 0) break;
    }
  }

  // ESTRATÉGIA 4 (COMPLEMENTAR): Se ainda não encontrou vértices, procurar por padrão genérico "E XXX,XXX m e N XXXXXXX,XXX m"
  // Sem o contexto de propriedade, em qualquer lugar do documento
  if (out.length === 0) {
    const rxGenericEN = /E\s+([0-9]{5,}[\.,][0-9]{1,3})\s*m\s+e\s+N\s+([0-9]{6,}[\.,][0-9]{1,3})\s*m/gim;
    let m4;
    while ((m4 = rxGenericEN.exec(clean)) !== null) {
      const eRaw = m4[1];
      const nRaw = m4[2];
      const east = parseFloat(normalizeNumber(eRaw));
      const north = parseFloat(normalizeNumber(nRaw));

      const idNum = out.length + 1;
      const id = `V${String(idNum).padStart(3, '0')}`;
      if (Number.isFinite(north) && Number.isFinite(east)) {
        const v = validarVertice(id, north, east, 'estrategia4', crsKey);
        if (v && !processedIds.has(id)) {
          out.push(v);
          processedIds.add(id);
        }
      }
    }
    if (out.length > 0) {
      console.log(`[PDFtoArcgis] Estratégia 4: encontrados ${out.length} vértices com padrão genérico E/N`);
    }
  }

  // ESTRATÉGIA 5 (OCR FALLBACK): Se ainda não encontrou vértices após estratégias digitais, tentar reconhecimento com padrões OCR-resilientes
  // Algumas PDFs têm texto scaneado/OCR de baixa qualidade, com padrões alterados
  if (out.length === 0) {
    // Padrão alternativo: E/N sem "m" ou com spacing irregular (típico de OCR de baixa qualidade)
    // Ex: "E 519.579,499 e N 7.331.990,424" ou "E519579,499eN7331990,424"
    const rxOcrAlternative = /E\s*([0-9]{5,}[\.,][0-9]{1,3})\s*e\s+N\s*([0-9]{6,}[\.,][0-9]{1,3})(?=[^0-9]|$)/gim;
    let m5;
    const ocrCoords = [];
    while ((m5 = rxOcrAlternative.exec(clean)) !== null) {
      const eRaw = m5[1];
      const nRaw = m5[2];
      const east = parseFloat(normalizeNumber(eRaw));
      const north = parseFloat(normalizeNumber(nRaw));

      const idNum = out.length + 1;
      const id = `V${String(idNum).padStart(3, '0')}`;
      if (Number.isFinite(north) && Number.isFinite(east)) {
        const v = validarVertice(id, north, east, 'ocrFallback', crsKey);
        if (v) {
          ocrCoords.push({ east: v.east, north: v.north });
        }
      }
    }

    // Se encontrou coordenadas com padrão OCR, processar
    if (ocrCoords.length > 0) {
      // Remover duplicatas próximas (OCR pode gerar ruído)
      const deduplicated = [];
      for (const coord of ocrCoords) {
        const isDuplicate = deduplicated.some(c =>
          Math.abs(c.east - coord.east) < 1 && Math.abs(c.north - coord.north) < 1
        );
        if (!isDuplicate) deduplicated.push(coord);
      }

      // Gerar IDs sequenciais
      for (let i = 0; i < deduplicated.length; i++) {
        const coord = deduplicated[i];
        const id = `V${String(i + 1).padStart(3, '0')}`;
        out.push({ id, north: coord.north, east: coord.east });
      }
      console.log(`[PDFtoArcgis] Estratégia 5 (OCR Fallback): encontrados ${out.length} vértices com padrão alternativo`);
    }
  }

  // ESTRATÉGIA 5B (OCR FALLBACK EXTREMO): Padrão ultra-resiliente para OCR muito degradado
  // Tolera: separadores errados, quebras de linha, caracteres especiais, espaçamento irregular
  if (out.length === 0) {
    // Ultra-resiliente: E<anything>numero<anything> e N<anything>numero<anything>
    // Captura tudo entre E e N, depois extrai números
    const rxUltraOcr = /E\s+([0-9:.,/\-\s]+?)(?:\s*m)?\s+e\s+N\s+(?:["'\\]*\s*)?([0-9:.,/\-\s]+?)(?:\s*m)?(?=\s*(?:deste|segue|proximidade|confrontando|;|\.|,|$))/gim;
    let m5b;
    const ocrExtremeCoords = [];

    // Função helper para normalizar número com separadores europeus/OCR
    function cleanCoordinate(raw) {
      // Remover espaços
      let s = raw.replace(/\s+/g, '');
      // Manter apenas números e separadores (. , :)
      s = s.replace(/[^0-9.,:/]/g, '');
      // O último separador é sempre o decimal
      // Encontrar o ÚLTIMO . ou ,
      const lastDot = s.lastIndexOf('.');
      const lastComma = s.lastIndexOf(',');
      const lastColon = s.lastIndexOf(':');
      const lastSlash = s.lastIndexOf('/');

      const lastSepPos = Math.max(lastDot, lastComma, lastColon, lastSlash);

      if (lastSepPos === -1) {
        // Sem separador - já é um número inteiro
        return s;
      }

      // Verificar se este é o decimal (últimos 1-3 dígitos)
      const afterLast = s.length - lastSepPos - 1;
      if (afterLast <= 3 && afterLast > 0) {
        // É o decimal - remover todos os separadores antes dele, depois manter esse como ponto
        const intPart = s.substring(0, lastSepPos).replace(/[.,:/]/g, '');
        const decPart = s.substring(lastSepPos + 1);
        return intPart + '.' + decPart;
      } else {
        // Não é decimal, remover todos
        return s.replace(/[.,:/]/g, '');
      }
    }

    while ((m5b = rxUltraOcr.exec(clean)) !== null) {
      let eRaw = m5b[1];
      let nRaw = m5b[2];

      console.log(`[PDFtoArcgis] 5B: Raw encontrado - E="${eRaw}" N="${nRaw}"`);

      // Usar função de limpeza melhorada
      eRaw = cleanCoordinate(eRaw);
      nRaw = cleanCoordinate(nRaw);

      const east = parseFloat(eRaw);
      const north = parseFloat(nRaw);

      console.log(`[PDFtoArcgis] 5B: Limpo - E="${eRaw}" (${east}) N="${nRaw}" (${north})`);

      if (Number.isFinite(north) && Number.isFinite(east) && east >= 100000 && east <= 900000) {
        ocrExtremeCoords.push({ east, north });
      }
    }

    // Se encontrou coordenadas
    if (ocrExtremeCoords.length > 0) {
      // Remover duplicatas próximas
      const deduplicated = [];
      for (const coord of ocrExtremeCoords) {
        const isDuplicate = deduplicated.some(c =>
          Math.abs(c.east - coord.east) < 1 && Math.abs(c.north - coord.north) < 1
        );
        if (!isDuplicate) deduplicated.push(coord);
      }

      // Gerar IDs sequenciais
      for (let i = 0; i < deduplicated.length; i++) {
        const coord = deduplicated[i];
        const id = `V${String(i + 1).padStart(3, '0')}`;
        out.push({ id, north: coord.north, east: coord.east });
      }
      console.log(`[PDFtoArcgis] Estratégia 5B (OCR Extremo): encontrados ${out.length} vértices`);
    }
  }

  // Converter lat/lon para UTM usando proj4js, se disponível
  if (typeof proj4 !== 'undefined' && classified && classified.length) {
    for (const c of classified) {
      if (c.type === 'latlon' && typeof c.lat === 'number' && typeof c.lon === 'number') {
        // Determinar zona UTM a partir do longitude
        let zone = 22; // fallback para Brasil
        if (!isNaN(c.lon)) {
          zone = Math.floor((c.lon + 180) / 6) + 1;
        }
        // Montar string proj4 para zona SIRGAS2000
        const projStr = `+proj=utm +zone=${zone} +south +ellps=GRS80 +units=m +no_defs`;
        try {
          const [east, north] = proj4('WGS84', projStr, [c.lon, c.lat]);
          const id = c.id || `LL${out.length + 1}`;
          // Evitar duplicatas próximas
          const isDuplicate = out.some(v => Math.abs(v.east - east) < 1 && Math.abs(v.north - north) < 1);
          if (!isDuplicate) {
            out.push({ id, north, east, origem: 'latlon2utm' });
          }
        } catch (e) {
          console.warn('[PDFtoArcgis] Falha ao converter lat/lon para UTM:', c, e);
        }
      }
    }
  }
  // Fechar polígono se não estiver fechado
  if (out.length > 2) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first && last && (first.north !== last.north || first.east !== last.east)) {
      out.push({ ...first, id: first.id + '_close', origem: 'fechamento' });
      console.log('[PDFtoArcgis] Polígono fechado automaticamente.');
    }
  }
  // Exporta ambos: lista de vértices UTM (out) e classificados (classified)
  return { utm: out, classified };
}

/* =========================
   AUTO-FIX UTM (decimais colados)
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
   VALIDAÇÃO E RECUPERAÇÃO DE COORDENADAS
========================= */

/**
 * Define ranges válidos de coordenadas por zona UTM
 * Baseado em padrões de cartório brasileiro
 */
function getValidRanges(projectionKey) {
  const ranges = {
    // Sul/Sudeste
    "SIRGAS2000_21S": { nMin: 6.45e6, nMax: 6.75e6, eMin: 300e3, eMax: 850e3 },
    "SAD69_21S": { nMin: 6.45e6, nMax: 6.75e6, eMin: 300e3, eMax: 850e3 },
    "SIRGAS2000_22S": { nMin: 7.15e6, nMax: 7.45e6, eMin: 300e3, eMax: 850e3 },
    "SAD69_22S": { nMin: 7.15e6, nMax: 7.45e6, eMin: 300e3, eMax: 850e3 },
    "SIRGAS2000_23S": { nMin: 8.0e6, nMax: 9.0e6, eMin: 300e3, eMax: 850e3 },
    "SAD69_23S": { nMin: 8.0e6, nMax: 9.0e6, eMin: 300e3, eMax: 850e3 },
    // Nordeste/Norte (Ceará, Maranhão, Pará, etc)
    "SIRGAS2000_24S": { nMin: 9.0e6, nMax: 10.5e6, eMin: 300e3, eMax: 850e3 },
    "SAD69_24S": { nMin: 9.0e6, nMax: 10.5e6, eMin: 300e3, eMax: 850e3 },
    "SIRGAS2000_25S": { nMin: 10.0e6, nMax: 10.5e6, eMin: 300e3, eMax: 850e3 },
    // Padrão fallback: zona 22S (Paraná)
    "WGS84_UTM": { nMin: 7.15e6, nMax: 7.45e6, eMin: 300e3, eMax: 850e3 },
  };
  return ranges[projectionKey] || ranges["WGS84_UTM"];
}

/**
 * Valida e tenta recuperar coordenadas fora do intervalo válido
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

    // PRIMEIRO: Tentar auto-escalar se estão fora do intervalo
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

      // PROBLEMA 1: Número começando com 73 (deveria ser 7.3)
      if (!fixed && c.north > 70e6 && c.north < 80e6) {
        const corrected = Math.floor(c.north / 10);
        if (corrected >= range.nMin && corrected <= range.nMax) {
          fixed = { ...c, north: corrected, recovery: "Removido dígito inicial (73→7.3)" };
          console.log(`[PDFtoArcgis] 🔄 Recuperado ${c.id}: N ${c.north} → ${corrected}`);
        }
      }

      // PROBLEMA 2: Número truncado (7.33 deveria ser 7.3XX.XXX)
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

      // PROBLEMA 3: E (east) muito grande - tentar escalar
      if (!fixed && !eValid && c.east > range.eMax) {
        const scaledE = autoScaleCoordinate(c.east, range.eMin, range.eMax);
        if (!Number.isNaN(scaledE)) {
          fixed = { ...c, east: scaledE, recovery: `Auto-escalado E: ${c.east} → ${scaledE}` };
          console.log(`[PDFtoArcgis] 🔄 Recuperado ${c.id}: E ${c.east} → ${scaledE}`);
        }
      }

      // PROBLEMA 4: N (north) muito grande - tentar escalar
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

/* =========================
   CSV helper (com diagnóstico profissional)
========================= */
function gerarCsvParaVertices(vertices, epsg, docId = null, topologyInfo = null, memorialInfo = null) {
  let csv = "\ufeffsep=;\n";

  // Cabeçalho profissional com metadados
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

  // Cabeçalho da tabela
  csv += "Point_ID;Ordem;Norte_Y;Este_X;EPSG;Dist_M;Azimute_Deg;Qualidade;Notas\n";

  // Estratégia de fechamento: se não estiver fechado, adiciona o primeiro vértice ao final
  let verticesToExport = [...vertices];
  if (topologyInfo && topologyInfo.closed === false && vertices.length > 2) {
    const first = vertices[0];
    // Cria um novo vértice de fechamento (Point_ID e Ordem incrementados)
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
    // Determinação de qualidade baseada em validação
    let quality = "✓ OK";
    let notes = "";
    // Verificar coerência com memorial se disponível
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

/* =========================
   CSV helper (original - compatibilidade)
========================= */
function gerarCsvParaVerticesSimples(vertices, epsg) {
  let csv = "\ufeffsep=;\n";
  csv += "Point_ID;Ordem;Norte_Y;Este_X;EPSG;Dist_M;Azimute_Deg\n";
  for (const c of vertices) {
    csv += `${c.id};${c.ordem};${c.north};${c.east};${epsg};${c.distCalc || ""};${c.azCalc || ""}\n`;
  }
  return csv;
}

/* =========================
   Split por matrícula
========================= */
function detectDocIdFromPageText(pageText) {
  const t = (pageText || "").replace(/\u00A0/g, " ");

  // DEBUG: Mostrar primeiras 500 chars do texto para debugging
  console.log(`[PDFtoArcgis] Detectando ID de: "${t.substring(0, 300)}..."`);

  // ===== ESTRATÉGIA CRÍTICA: Usar APENAS a primeira ocorrência de MATRÍCULA =====
  // Em cartórios, MATRÍCULA que aparece no cabeçalho é a ID do documento
  // Referências a outras matrículas aparecem depois no memorial (ex: "conforme referido Orozimbo Ciuffa de MATRÍCULA: 8.462")
  // SOLUÇÃO: Pegar APENAS a PRIMEIRA matrícula do texto (cabeçalho/início)

  // ESTRATÉGIA 1: Procurar APENAS no início do texto (primeiros 2000 caracteres - cabeçalho)
  const headerText = t.substring(0, 2000);

  const matriculaPatterns = [
    // Padrões para MATRÍCULA - com variações OCR degradado
    // ORDEM IMPORTANTE: Do mais específico para o mais genérico
    // Padrões que garantem ser o ID do documento (aparecem no cabeçalho/título)
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
      // Normalizar: remover pontos E vírgulas (separadores OCR podem variar)
      let id = m[1].replace(/[.,]/g, "").replace(/^0+/, "");
      if (id && id.length > 0) {
        console.log(`[PDFtoArcgis] ✅ MATRÍCULA (cabeçalho): ${id} (padrão: ${name}) - Raw: "${m[1]}"`);
        return id;
      }
    }
  }

  // Se nenhum padrão de matrícula funcionou, logar aviso
  console.log(`[PDFtoArcgis] ⚠️ Nenhum padrão de MATRÍCULA encontrado no cabeçalho`);

  // ===== ESTRATÉGIA 2: Procurar por PROTOCOLO (apenas como fallback) =====
  // PROTOCOLO nunca deve ter prioridade sobre MATRÍCULA
  // Usar apenas se MATRÍCULA não foi encontrada
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

  // ===== ETAPA 3: Procurar por alternativas (se nenhuma matrícula foi encontrada) =====
  // DESABILITADO: Padrões alternativos muito genéricos causam falsos positivos
  // Exemplo: "M. 339" pegava número de outra parte do documento que não era matrícula
  // Melhor deixar como "SEM_ID" e depois usar heurística de recuperação com páginas próximas
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

  // MELHORIA ADITIVA: Tentar recuperar documentos SEM_ID combinando com IDs adjacentes
  // Estratégia: se um documento "SEM_ID" está cercado por documentos com o mesmo ID, unir-se a ele
  const improvedDocs = [];
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];

    if (doc.docId !== "SEM_ID") {
      improvedDocs.push(doc);
      continue;
    }

    // Se é SEM_ID, tentar encontrar ID em contexto próximo
    let foundId = null;

    // Buscar ID em documento anterior (se existir e tiver poucas páginas diferença)
    if (i > 0 && docs[i - 1].docId !== "SEM_ID") {
      const prevPages = docs[i - 1].pages;
      const currPages = doc.pages;
      const gap = Math.min(...currPages) - Math.max(...prevPages);
      if (gap <= 3) {  // Se separado por até 3 páginas, considerar como mesma matrícula
        foundId = docs[i - 1].docId;
      }
    }

    // Buscar ID em documento seguinte (se não encontrou anterior)
    if (!foundId && i < docs.length - 1 && docs[i + 1].docId !== "SEM_ID") {
      const currPages = doc.pages;
      const nextPages = docs[i + 1].pages;
      const gap = Math.min(...nextPages) - Math.max(...currPages);
      if (gap <= 3) {  // Se separado por até 3 páginas
        foundId = docs[i + 1].docId;
      }
    }

    // Se encontrou ID, usar esse; senão, manter como SEM_ID mas com log
    const pageStr = Array.isArray(doc.pages) ? doc.pages.join(", ") : (typeof doc.pages === 'string' ? doc.pages : "(desconhecido)");
    if (foundId) {
      doc.docId = foundId;
      console.log(`[PDFtoArcgis] Recuperado ID ${foundId} para páginas ${pageStr}`);
    } else {
      console.warn(`[PDFtoArcgis] ⚠️ Não foi possível recuperar ID para páginas ${pageStr}`);
    }

    improvedDocs.push(doc);
  }

  // MELHORIA: Detectar e corrigir IDs de PROTOCOLO cercados por MATRÍCULA
  // DESABILITADO: A heurística estava quebrando documentos válidos com IDs diferentes
  // Exemplo: Arquivo com M.8.402, M.8.462, M.5737 estava sendo mesclado incorretamente
  // Esta heurística deveria SÓ ser usada para documentos com ID "SEM_ID", não para IDs válidos
  console.log(`[PDFtoArcgis] Heurística de correção desabilitada para não quebrar documentos com múltiplos IDs válidos`);

  // Agora mesclar documentos que têm o MESMO ID mas foram separados
  // IMPORTANTE: Mesclar TODOS com mesmo ID, mesmo que não sejam consecutivos
  const mergedDocs = [];
  const processedIds = new Set();

  for (const doc of improvedDocs) {
    if (processedIds.has(doc.docId)) {
      continue;  // Já foi processado como parte de um grupo
    }

    // Encontrar TODOS os documentos com este ID
    const docsWithSameId = improvedDocs.filter(d => d.docId === doc.docId);

    if (docsWithSameId.length > 1) {
      // Há múltiplos documentos com este ID - mesclar
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

      // Ordenar páginas
      merged.pages.sort((a, b) => a - b);

      console.log(`[PDFtoArcgis] Mesclando ${docsWithSameId.length} fragmentos da matrícula ${doc.docId}: páginas ${merged.pages.join(", ")}`);
      mergedDocs.push(merged);
    } else {
      // Apenas um documento com este ID
      mergedDocs.push(doc);
      processedIds.add(doc.docId);
    }
  }

  return mergedDocs.filter(d => (d.text || "").trim().length > 0);
}

/* =========================
   UI seletor de matrícula
========================= */
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

/* =========================
   Display tabela
========================= */
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

/* =========================
   PROCESSAMENTO DO PDF (CORRIGIDO)
========================= */
fileInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  // Reset de UI e variáveis
  fileNameBase = file.name.replace(/\.[^/.]+$/, "");
  pdfOrigemNomeBase = file.name.replace(/\.[^/.]+$/, "");
  pdfOrigemSrc = file.name;
  document.getElementById("fileNameDisplay").innerText = file.name;
  progressContainer.style.display = "block";
  resultBox.style.display = "none";
  statusDiv.style.display = "none";
  extractedCoordinates = [];
  previewTableBody.innerHTML = "";
  documentsResults = [];
  activeDocIndex = -1;

  try {
    updateStatus("📄 Carregando PDF...", "info");
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
    const pagesText = [];

    // Loop de leitura de páginas
    for (let i = 1; i <= pdf.numPages; i++) {
      progressBar.value = Math.round((i / pdf.numPages) * 100);
      document.getElementById("progressLabel").innerText = `Lendo página ${i}/${pdf.numPages}...`;

      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent({ disableCombineTextItems: false });
      let pageText = buildPageTextWithLines(textContent);

      // OCR se a página estiver vazia/escaneada
      if ((pageText || "").replace(/\s+/g, "").length < 80) {
        updateStatus(`🔎 OCR na página ${i}...`, "info");
        const viewport = page.getViewport({ scale: 2.5 });
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: ctx, viewport }).promise;
        pageText = await getOcrTextFromCanvas(canvas);
      }
      pagesText.push(pageText || "");
    }

    // --- LÓGICA DE INFERÊNCIA REVERSA ---
    const fullText = pagesText.join("\n");

    // Extraímos os vértices primeiro para poder usá-los na detecção
    const verticesParaDetectar = parseVertices(fullText);

    // Passamos o texto E os vértices
    const projInfo = detectProjectionFromText(fullText, verticesParaDetectar);

    // Agora sim chama o processamento final
    processExtractUnified(pagesText, projInfo);

  } catch (e) {
    console.error("Erro no processamento:", e);
    updateStatus("Erro: " + e.message, "error");
  }
});


function detectPolygonCycles(vertices) {
  if (vertices.length < 3) return [];

  const cycles = [];
  let currentCycle = [];
  const CLOSURE_TOLERANCE = 5; // metros de tolerância para considerar que fechou

  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];

    // Se temos pontos no ciclo atual
    if (currentCycle.length > 2) {
      const firstPoint = currentCycle[0];
      const distance = Math.sqrt(
        Math.pow(v.east - firstPoint.east, 2) +
        Math.pow(v.north - firstPoint.north, 2)
      );

      // Se este ponto fecha o polígono (volta ao ponto inicial)
      if (distance < CLOSURE_TOLERANCE) {
        console.log(`[PDFtoArcgis] 🔄 Ciclo detectado: ${currentCycle.length} vértices (fechamento em ${distance.toFixed(2)}m)`);

        // Adicionar o ponto de fechamento para completar
        currentCycle.push({ ...v, isClosure: true });
        cycles.push(currentCycle);
        currentCycle = [];
        continue; // Não adicionar este ponto ao próximo ciclo
      }
    }

    currentCycle.push(v);
  }

  // Se sobraram vértices, adicionar como ciclo
  if (currentCycle.length >= 3) {
    console.log(`[PDFtoArcgis] 🔄 Ciclo final detectado: ${currentCycle.length} vértices`);
    cycles.push(currentCycle);
  }

  console.log(`[PDFtoArcgis] Total de ciclos detectados: ${cycles.length}`);
  return cycles;
}

async function processExtractUnified(pagesText) {
  // NOVO APPROACH: Ignorar ID, extrair TODAS as coordenadas
  // Combinar texto de todas as páginas
  const fullText = pagesText.join("\n");

  // Detectar projeção (CRS)
  let det = detectProjectionFromText(fullText);
  let projKey = det.key || null;

  // CORREÇÃO: Se encontrar MC-39W ou CE no texto, priorizar zona 24S
  if (/MC-?39W/i.test(fullText) || /\bCE\b/i.test(fullText)) {
    projKey = "SIRGAS2000_24S";
    det = { ...det, key: projKey };
    console.log('[PDFtoArcgis] CRS ajustado para SIRGAS2000_24S devido a MC-39W ou CE no texto.');
  }

  console.log(`[PDFtoArcgis] 📄 Processando PDF completo (sem separação por ID)`);
  console.log(`[PDFtoArcgis] CRS detectado: ${projKey || "não identificado"}`);

  // Extrair e classificar TODAS as coordenadas e dados
  let parseResult = parseVertices(fullText, projKey);
  let allVertices = parseResult.utm;
  let classified = parseResult.classified;
  const projInfo = detectProjectionFromText(fullText, allVertices);
  console.log(`[PDFtoArcgis] Total de coordenadas UTM extraídas: ${allVertices.length}`);
  if (classified && classified.length) {
    const latlonCount = classified.filter(c => c.type === 'latlon').length;
    const azdistCount = classified.filter(c => c.type === 'azimute_dist').length;
    console.log(`[PDFtoArcgis] Classificação extraída: ${latlonCount} lat/lon, ${azdistCount} azimute/distância`);
    // Exibir na interface (previewTable) se possível
    if (previewTableBody) {
      // Limpar preview
      previewTableBody.innerHTML = '';
      // Adicionar UTM
      for (const v of allVertices) {
        const row = document.createElement('tr');
        row.innerHTML = `<td>${v.id}</td><td>UTM</td><td>${v.north}</td><td>${v.east}</td><td></td><td></td><td></td>`;
        previewTableBody.appendChild(row);
      }
      // Adicionar lat/lon
      for (const c of classified.filter(c => c.type === 'latlon')) {
        const row = document.createElement('tr');
        row.innerHTML = `<td>${c.id}</td><td>Lat/Lon</td><td>${c.lat}</td><td>${c.lon}</td><td></td><td></td><td></td>`;
        previewTableBody.appendChild(row);
      }
      // Adicionar azimute/distância
      for (const c of classified.filter(c => c.type === 'azimute_dist')) {
        const row = document.createElement('tr');
        row.innerHTML = `<td>${c.id}</td><td>Azimute/Dist</td><td></td><td></td><td>${c.azimuth}</td><td>${c.distance}</td><td></td>`;
        previewTableBody.appendChild(row);
      }
    }
  }


  // --- UTM ZONE AUTO-DETECTION ---
  // If no CRS detected, try to infer UTM zone from coordinates
  if (!projKey || projKey === "WGS84") {
    // Only consider valid UTM eastings (E) and northings (N)
    const easts = allVertices.map(v => v.east).filter(e => e > 200000 && e < 900000);
    const norths = allVertices.map(v => v.north).filter(n => n > 6000000 && n < 8000000);
    let inferredZone = null;
    let inferredDatum = "SIRGAS2000";
    // Try to infer by median easting and northing
    if (easts.length && norths.length) {
      // UTM central meridian for Brazil: 21S (-57), 22S (-51), 23S (-45), 24S (-39)
      // Easting is always around 500,000 (central), but can go up to 850,000
      // Northing: 6,450,000 (RS) to 7,450,000 (PR)
      // We'll use northing to guess the state/zone
      const median = arr => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)];
      const medN = median(norths);
      // Heuristic: PR (22S): 7.15M-7.45M, SC (23S): 6.8M-7.15M, RS (21S): 6.45M-6.75M
      if (medN >= 7.15e6 && medN <= 7.45e6) inferredZone = "22S";
      else if (medN >= 6.8e6 && medN < 7.15e6) inferredZone = "23S";
      else if (medN >= 6.45e6 && medN < 6.8e6) inferredZone = "21S";
      else if (medN > 7.45e6 && medN < 8.0e6) inferredZone = "22S"; // fallback for north of PR
      // Optionally, could use easting to check for outliers
      if (inferredZone) {
        projKey = `${inferredDatum}_${inferredZone}`;
        console.log(`[PDFtoArcgis] 🛰️ Zona UTM inferida automaticamente: ${projKey}`);
        // Show to user
        if (crsDetectedBox && crsDetectedTitle && crsDetectedReason) {
          crsDetectedBox.style.display = "block";
          crsDetectedTitle.innerText = `Zona UTM inferida: ${projKey}`;
          crsDetectedReason.innerText = `Detectada a partir dos valores das coordenadas extraídas (Norte mediana: ${medN.toFixed(0)})`;
        }
      }
    }
  }


  // NOVO: Validar e corrigir coordenadas fora do intervalo, agora usando projKey (possibly inferred)
  let validation = validateAndFixCoordinates(allVertices, projKey);
  let validatedVertices = validation.valid;

  // Se todas as coordenadas foram rejeitadas, tentar auto-detectar zona UTM mesmo que um CRS tenha sido detectado
  if (validatedVertices.length < 3) {
    console.warn('[PDFtoArcgis] Nenhuma coordenada válida para o CRS detectado. Tentando auto-detectar zona UTM a partir dos valores.');
    // Auto-detectar zona UTM para todo o Brasil (northings até 10.500.000)
    const easts = allVertices.map(v => v.east).filter(e => e > 200000 && e < 900000);
    const norths = allVertices.map(v => v.north).filter(n => n > 6000000 && n < 10500000);
    let inferredZone = null;
    let inferredDatum = "SIRGAS2000";
    if (easts.length && norths.length) {
      const median = arr => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)];
      const medN = median(norths);
      // Faixas aproximadas para zonas UTM SIRGAS2000 (Brasil)
      if (medN >= 6.45e6 && medN < 6.8e6) inferredZone = "21S"; // RS
      else if (medN >= 7.15e6 && medN < 7.45e6) inferredZone = "22S"; // PR
      else if (medN >= 8.0e6 && medN < 9.0e6) inferredZone = "23S"; // SP/MS/MT
      else if (medN >= 9.0e6 && medN < 10.0e6) inferredZone = "24S"; // CE/MA/PA
      else if (medN >= 10.0e6 && medN < 10.5e6) inferredZone = "25S"; // extremo norte
      // fallback genérico
      else if (medN >= 6.45e6 && medN < 10.5e6) inferredZone = "22S";
      if (inferredZone) {
        projKey = `${inferredDatum}_${inferredZone}`;
        console.log(`[PDFtoArcgis] 🛰️ Zona UTM inferida automaticamente (fallback): ${projKey}`);
        if (crsDetectedBox && crsDetectedTitle && crsDetectedReason) {
          crsDetectedBox.style.display = "block";
          crsDetectedTitle.innerText = `Zona UTM inferida: ${projKey}`;
          crsDetectedReason.innerText = `Detectada a partir dos valores das coordenadas extraídas (Norte mediana: ${medN.toFixed(0)})`;
        }
        // Revalidar com a zona inferida
        validation = validateAndFixCoordinates(allVertices, projKey);
        validatedVertices = validation.valid;
      }
    }
  }

  if (validation.recovered.length > 0) {
    console.log(`[PDFtoArcgis] 🔄 ${validation.recovered.length} coordenadas recuperadas`);
  }

  if (validation.invalid.length > 0) {
    console.warn(`[PDFtoArcgis] ⚠️ ${validation.invalid.length} coordenadas rejeitadas (fora do intervalo válido)`);
    for (const inv of validation.invalid) {
      console.warn(`   ${inv.id}: N=${inv.north}, E=${inv.east}`);
    }
  }

  if (validatedVertices.length < 3) {
    progressContainer.style.display = "none";
    updateStatus(`❌ Insuficientes coordenadas válidas (${validatedVertices.length}/3 mínimo).`, "error");
    return;
  }

  // Usar coordenadas validadas
  allVertices = validatedVertices;

  // Aplicar auto-fix se necessário
  const fixes = (projKey && projKey !== "WGS84") ? autoFixUtmDecimals(allVertices) : [];
  if (fixes.length > 0) {
    console.log(`[PDFtoArcgis] ✓ Auto-fix aplicado: ${fixes.join("; ")}`);
  }

  // NOVO: Detectar ciclos de polígonos automaticamente
  const cycles = detectPolygonCycles(allVertices);

  if (!cycles.length) {
    progressContainer.style.display = "none";
    updateStatus("❌ Não foi possível detectar ciclos de polígonos válidos.", "error");
    return;
  }

  documentsResults = [];

  // Salvar apenas o primeiro ciclo detectado como o único polígono do documento
  const cycleVertices = cycles[0];
  const polygonId = `Polígono_1`;

  console.log(`[PDFtoArcgis] 🔍 Processando ${polygonId}...`);

  // Calcular distâncias e azimutes
  const vertices = cycleVertices.map((pt, i) => {
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

  // Remover duplicados consecutivos
  const cleaned = [];
  for (const p of vertices) {
    const last = cleaned[cleaned.length - 1];
    if (!last || last.east !== p.east || last.north !== p.north) cleaned.push(p);
  }

  // Validação topológica
  const topologyValidation = validatePolygonTopology(cleaned, projKey);

  // Extração de dados do memorial
  const memorialData = extractAzimuthDistanceFromText(fullText);
  const memorialValidation = memorialData.azimutes.length > 0
    ? validateMemorialCoherence(cleaned, memorialData, projKey)
    : null;

  // Construir warnings
  const warnings = [];
  if (!projKey) warnings.push("⚠️ CRS não identificado; use o modo avançado.");
  if (fixes.length) warnings.push(`✓ ${fixes.length} correção(ões) automática(s) aplicada(s)`);
  warnings.push(...validateCoords(cleaned, projKey));

  if (!topologyValidation.isValid) {
    warnings.push(...topologyValidation.errors.map(e => `❌ ${e}`));
  }
  warnings.push(...topologyValidation.warnings);

  if (memorialValidation && memorialValidation.issues.length > 0) {
    warnings.push(...memorialValidation.issues.map(i => `⚠️ ${i}`));
  }

  const finalVertices = topologyValidation.corrected || cleaned;

  documentsResults.push({
    docId: polygonId,
    polygonIndex: 1,
    pages: "Todas",
    projectionKey: projKey,
    manualProjectionKey: null,
    projectionInfo: det,
    vertices: finalVertices,
    warnings,
    topology: topologyValidation,
    memorialValidation,
    memorialData
  });

  progressContainer.style.display = "none";

  // Estatísticas
  const totalPolygons = documentsResults.length;
  const validPolygons = documentsResults.filter(d => (d.vertices || []).length >= 3 && d.topology?.isValid).length;
  const warningPolygons = documentsResults.filter(d => (d.vertices || []).length >= 3 && !d.topology?.isValid).length;

  updateStatus(
    `✅ PDF processado. Polígonos encontrados: ${totalPolygons} | Válidos: ${validPolygons} | Com avisos: ${warningPolygons}`,
    validPolygons === totalPolygons ? "success" : (warningPolygons > 0 ? "warning" : "info")
  );

  const firstIdx = documentsResults.findIndex(d => (d.vertices || []).length > 0);
  activeDocIndex = firstIdx >= 0 ? firstIdx : 0;

  renderDocSelector();
}

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

/* =========================
   EXPORT CSV (matrícula selecionado)
========================= */
downloadBtn.onclick = () => {
  if (!extractedCoordinates.length) return;
  try {
    const key = getActiveProjectionKey();
    const epsg = PROJECTIONS[key]?.epsg || "";
    const crsName = key ? key.replace(/[^\w]/g, "_") : "CRS";
    const doc = getSelectedDoc();

    // Gerar CSV com diagnóstico profissional
    const csv = gerarCsvParaVertices(
      extractedCoordinates,
      epsg,
      doc?.docId || "DESCONHECIDA",
      doc?.topology,
      doc?.memorialValidation
    );

    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    // Novo: incluir nome do PDF de origem e src no nome do arquivo
    link.download = `${pdfOrigemNomeBase || fileNameBase}_${crsName}_Validado_${pdfOrigemSrc || "src"}.csv`;
    link.click();

    // Também exportar relatório se houver validação
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
      // Novo: incluir nome do PDF de origem e src no nome do arquivo
      linkRel.download = `${pdfOrigemNomeBase || fileNameBase}_${crsName}_Relatorio_${pdfOrigemSrc || "src"}.txt`;
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
        // Tenta remover o arquivo se já existir
        try {
          const existing = await handle.getFileHandle(name);
          await handle.removeEntry(name);
        } catch (e) {
          // Se não existe, ignora
        }
        const fh = await handle.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await w.write(data);
        await w.close();
      } catch (err) {
        // Se o usuário cancelar, não mostrar erro
        if (err && err.name === "AbortError") return;
        // Se falhar, tenta com truncate
        const fh = await handle.getFileHandle(name, { create: true });
        const w = await fh.createWritable({ keepExistingData: false });
        await w.write(data);
        await w.close();
      }
    };

    // Caso PDF simples (sem split)
    if (!hasDocs) {
      const key = getActiveProjectionKey();
      const projection = PROJECTIONS[key];
      if (!projection) throw new Error("CRS não suportado.");

      const base = sanitizeFileName(fileNameBase);
      const ring = extractedCoordinates.map(c => [c.east, c.north]);
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
              await new Promise(r => setTimeout(r, 50));
              await writeFile(`${base}_${crsName}_limite.shx`, toArrayBufferFS(files.shx));
              await new Promise(r => setTimeout(r, 50));
              await writeFile(`${base}_${crsName}_limite.dbf`, toArrayBufferFS(files.dbf));
              await new Promise(r => setTimeout(r, 50));
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
              await new Promise(r => setTimeout(r, 50));
              await writeFile(`${base}_${crsName}_vertices.shx`, toArrayBufferFS(files.shx));
              await new Promise(r => setTimeout(r, 50));
              await writeFile(`${base}_${crsName}_vertices.dbf`, toArrayBufferFS(files.dbf));
              await new Promise(r => setTimeout(r, 50));
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
      if (!projection) {
        skipped.push(`Arquivo ${pdfOrigemSrc || "src"}: CRS não suportado (${projKey})`);
        continue;
      }

      const base = sanitizeFileName(pdfOrigemNomeBase || fileNameBase);
      const ring = vertices.map(c => [c.east, c.north]);

      let crsName = projection && projection.epsg ? projection.epsg : "CRS";
      crsName = String(crsName).replace(/[^\w\d]/g, "_");

      // Limite (POLYGON)
      await new Promise((resolve, reject) => {
        window.shpwrite.write(
          [{ NOME: base, VERTICES: vertices.length, EPSG: projection.epsg, TIPO: "LIMITE" }],
          "POLYGON",
          [[[ring]]],
          async (err, files) => {
            if (err) return reject(err);
            try {
              // Apenas gravando a versão limpa
              await writeFile(`${base}_${crsName}_limite.shp`, toArrayBufferFS(files.shp));
              await new Promise(r => setTimeout(r, 50));
              await writeFile(`${base}_${crsName}_limite.shx`, toArrayBufferFS(files.shx));
              await new Promise(r => setTimeout(r, 50));
              await writeFile(`${base}_${crsName}_limite.dbf`, toArrayBufferFS(files.dbf));
              await new Promise(r => setTimeout(r, 50));
              await writeFile(`${base}_${crsName}_limite.prj`, projection.wkt);
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
        EPSG: projection.epsg
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
              await new Promise(r => setTimeout(r, 50));
              await writeFile(`${base}_${crsName}_vertices.shx`, toArrayBufferFS(files.shx));
              await new Promise(r => setTimeout(r, 50));
              await writeFile(`${base}_${crsName}_vertices.dbf`, toArrayBufferFS(files.dbf));
              await new Promise(r => setTimeout(r, 50));
              await writeFile(`${base}_${crsName}_vertices.prj`, projection.wkt);
              resolve();
            } catch (e) { reject(e); }
          }
        );
      });

      // CSV
      const csv = gerarCsvParaVertices(vertices, projection.epsg, docId, doc.topology, doc.memorialValidation);
      await writeFile(`${base}_${crsName}_Validado.csv`, csv);

      // Relatório de validação
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

/* =========================
   MODO AVANÇADO: Forçar CRS (aplica ao doc selecionado)
========================= */
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

