// --- VARIÁVEIS DE ESTADO GLOBAIS ---
let pdfDoc = null;
let currentPageNum = 1; 
let pdfPage = null;
let pageRendering = false;
let pageNumPending = null;

// --- VARIÁVEIS DE CROPPING ---
let isCropping = false;
let startX, startY, endX, endY;
let cropRect = { x: 0, y: 0, width: 0, height: 0 };
let viewScale = 1; 
const OCR_SCALE = 4; 
// Ajuste para permitir o uso da largura máxima do contêiner (maior área de recorte)
const PADDING_FOR_CONTAINER = 0; 

const canvas = document.getElementById('pdfCanvas');
const ctx = canvas.getContext('2d');
const fileInput = document.getElementById('fileInput');
const processBtn = document.getElementById('processBtn');
const statusDiv = document.getElementById('status');
const cropOverlay = document.getElementById('cropOverlay');
const canvasContainer = document.getElementById('canvasContainer');
const ocrProgress = document.getElementById('ocrProgress');
const pageNumInput = document.getElementById('pageNumInput');
const goToPageBtn = document.getElementById('goToPageBtn');
const pageSelector = document.getElementById('pageSelector');

let fileNameBase = 'extracao_geral';

// Define o caminho para o worker do PDF.js
if (typeof pdfjsLib !== 'undefined') {
  try {
                pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/3.11.174/pdf.worker.min.js";
  } catch (e) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
            "/vendor/pdfjs/3.11.174/pdf.worker.min.js";
  }
}

// ----------------------------------------------------
// --- FUNÇÃO DE PRÉ-PROCESSAMENTO (BINARIZAÇÃO) ---
// ----------------------------------------------------
/**
 * Aplica binarização (preto/branco) no canvas para melhorar o contraste para OCR.
 */
function binarizeImage(ctx, width, height) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const threshold = 180; 

    for (let i = 0; i < data.length; i += 4) {
        const avg = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        const color = avg > threshold ? 255 : 0; 
        
        data[i] = color;     
        data[i + 1] = color; 
        data[i + 2] = color; 
    }
    ctx.putImageData(imageData, 0, 0);
}


// ----------------------------------------------------
// --- FUNÇÃO AUXILIAR: DETECÇÃO DE TABELA (HEURÍSTICA SIMPLES) ---
// ----------------------------------------------------
/**
 * Tenta detectar se o texto extraído é uma tabela usando uma heurística simples.
 */
function isTable(text) {
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    if (lines.length < 3) return false; 
    
    let tableLineCount = 0;
    
    lines.forEach(line => {
        const potentialColumns = (line.match(/\s{2,}/g) || []).length; 
        
        if (potentialColumns >= 2) { 
            tableLineCount++;
        }
    });

    return (tableLineCount / lines.length) > 0.6; 
}


// ----------------------------------------------------
// --- FUNÇÃO CENTRAL: EXTRAÇÃO DE TEXTO SELECIONÁVEL (PDF NATIVO) ---
// ----------------------------------------------------
/**
 * Tenta extrair texto da camada de texto nativa do PDF dentro do retângulo de recorte.
 */
async function extractPdfTextLayer(page, cropRect, viewScale) {
    const textContent = await page.getTextContent();
    
    const viewport = page.getViewport({ scale: viewScale }); 
    
    let extractedText = [];

    const cropX1 = cropRect.x;
    const cropY1 = cropRect.y;
    const cropX2 = cropRect.x + cropRect.width;
    const cropY2 = cropRect.y + cropRect.height;
    
    for (const item of textContent.items) {
        const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]); 
        
        if (
            x >= cropX1 && 
            x <= cropX2 && 
            y >= cropY1 && 
            y <= cropY2
        ) {
            extractedText.push(item.str);
            if (item.hasWhiteSpace) {
                extractedText.push(' ');
            }
        }
    }

    let finalString = extractedText.join('').replace(/\s{2,}/g, ' ').trim();
    
    return finalString.length > 5 ? finalString : null;
}

// ----------------------------------------------------
// --- ETAPA 1: CARREGAR E EXIBIR PDF PARA RECORTE ---
// ----------------------------------------------------

fileInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    fileNameBase = file.name.replace(/\.[^/.]+$/, ""); 
    
    document.getElementById('fileInputLabel').innerText = 'Arquivo Carregado';
    document.getElementById('fileNameDisplay').innerText = file.name;

    statusDiv.classList.remove('is-danger', 'is-success');
    statusDiv.classList.add('is-info');
    statusDiv.innerText = 'Carregando arquivo...';
    processBtn.disabled = true;
    pageNumInput.value = 1;
    pageSelector.style.display = 'flex';
    pageNumInput.disabled = file.type !== 'application/pdf';
    goToPageBtn.disabled = file.type !== 'application/pdf';
    document.getElementById('downloadBtn').style.display = 'none';
    document.getElementById('output').innerText = '';

    try {
        if (file.type === 'application/pdf') {
            const pdfData = await file.arrayBuffer();
            pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;
            pageNumInput.max = pdfDoc.numPages;
            pageSelector.style.display = 'flex';
            pageNumInput.disabled = false;
            goToPageBtn.disabled = false;
            await renderPage(1);
        } else if (file.type.startsWith('image/')) {
            pdfDoc = null;
            pdfPage = null;
            const img = new Image();
            const imgURL = URL.createObjectURL(file);
            img.onload = () => {
                const containerWidth = canvasContainer.clientWidth - PADDING_FOR_CONTAINER;
                viewScale = containerWidth / img.width;
                canvas.width = containerWidth;
                canvas.height = img.height * viewScale;
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                statusDiv.innerText = 'Imagem carregada. Arraste para selecionar a área de interesse.';
                processBtn.disabled = true;
            };
            img.src = imgURL;

        } else {
            throw new Error('Formato de arquivo não suportado. Use PDF ou Imagem (PNG/JPG).');
        }

    } catch (e) {
        statusDiv.classList.remove('is-info');
        statusDiv.classList.add('is-danger');
        statusDiv.innerText = `❌ Erro ao carregar arquivo: ${e.message}`;
        console.error(e);
    }
});

goToPageBtn.addEventListener('click', async () => {
    let pageNum = parseInt(pageNumInput.value);
    if (pdfDoc && pageNum >= 1 && pageNum <= pdfDoc.numPages) {
        await renderPage(pageNum);
    } else {
        alert(`Número de página inválido.`);
    }
});

async function renderPage(num) {
    if (pageRendering) {
        pageNumPending = num;
        return;
    }
    pageRendering = true;
    currentPageNum = num;
    pageNumInput.value = num;

    try {
        pdfPage = await pdfDoc.getPage(num);
        
        const viewport1 = pdfPage.getViewport({ scale: 1 });

        // calcula escala para caber na tela inteira (largura + altura)
        const scaleX = (canvasContainer.clientWidth - PADDING_FOR_CONTAINER) / viewport1.width;
        const scaleY = window.innerHeight / viewport1.height;

        viewScale = Math.min(scaleX, scaleY);
        
        const viewport = pdfPage.getViewport({ scale: viewScale });
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
            canvasContext: ctx,
            viewport: viewport
        };

        await pdfPage.render(renderContext).promise;
        statusDiv.innerText = `PDF carregado. Página ${num} de ${pdfDoc.numPages}. Arraste para selecionar a área de interesse.`;

        cropRect = { x: 0, y: 0, width: 0, height: 0 };
        cropOverlay.style.display = 'none';
        processBtn.disabled = true;
        document.getElementById('downloadBtn').style.display = 'none';

    } catch (e) {
        statusDiv.innerText = `Erro ao renderizar a página ${num}.`;
        console.error(e);
    } finally {
        pageRendering = false;
        if (pageNumPending !== null) {
            renderPage(pageNumPending);
            pageNumPending = null;
        }
    }
}

// ----------------------------------------------------
// --- ETAPA 2: LÓGICA DE CROPPING (RECORTAR) ---
// ----------------------------------------------------
canvas.addEventListener('mousedown', (e) => {
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    
    startX = (e.clientX - rect.left);
    startY = (e.clientY - rect.top);

    isCropping = true;
    
    cropOverlay.style.display = 'block';
    cropOverlay.style.left = `${startX}px`;
    cropOverlay.style.top = `${startY}px`;
    // CORREÇÃO: Usando aspas simples
    cropOverlay.style.width = '0px'; 
    cropOverlay.style.height = '0px'; 
    processBtn.disabled = true;
    document.getElementById('downloadBtn').style.display = 'none';
});

canvas.addEventListener('mousemove', (e) => {
    if (!isCropping) return;

    const rect = canvas.getBoundingClientRect();

    endX = (e.clientX - rect.left);
    endY = (e.clientY - rect.top);

    cropRect = {
        x: Math.min(startX, endX),
        y: Math.min(startY, endY),
        width: Math.abs(endX - startX),
        height: Math.abs(endY - startY)
    };

    cropOverlay.style.left = (canvas.offsetLeft + cropRect.x) + 'px';
    cropOverlay.style.top = (canvas.offsetTop + cropRect.y) + 'px';
    cropOverlay.style.width = cropRect.width + 'px';
    cropOverlay.style.height = cropRect.height + 'px';
    cropOverlay.style.display = 'block';
});

canvas.addEventListener('mouseup', () => {
    if (!isCropping || !canvas) return;
    isCropping = false;

    const left = Math.min(startX, endX);
    const top = Math.min(startY, endY);
    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);

    if (width > 10 && height > 10) {
        cropRect = { x: left, y: top, width: width, height: height };
        processBtn.disabled = false;
        statusDiv.innerText = 'Área selecionada. Clique em "Processar" para iniciar a extração.';
    } else {
        cropOverlay.style.display = 'none';
        processBtn.disabled = true;
        statusDiv.innerText = 'Seleção muito pequena. Arraste para selecionar a área de interesse.';
        cropRect = { x: 0, y: 0, width: 0, height: 0 };
    }
});


// ----------------------------------------------------
// --- ETAPA 3: PROCESSAMENTO OCR HÍBRIDO (COM EXPORTAÇÃO CSV/DOC) ---
// ----------------------------------------------------
processBtn.addEventListener('click', async () => {
    if (cropRect.width === 0) {
        alert('Selecione uma área de recorte primeiro!');
        return;
    }

    statusDiv.classList.remove('is-danger', 'is-success');
    statusDiv.classList.add('is-primary');
    statusDiv.innerText = 'Preparando extração...';
    ocrProgress.style.display = 'block';
    ocrProgress.value = 0;
    
    let finalExtractedText = null;

    try {
        // --- 1. TENTAR EXTRAÇÃO DA CAMADA DE TEXTO NATIVA (Se for PDF) ---
        if (pdfPage) {
            statusDiv.innerText = 'Tentando extração do texto selecionável...';
            const pdfText = await extractPdfTextLayer(pdfPage, cropRect, viewScale); 
            
            if (pdfText) {
                finalExtractedText = pdfText;
                statusDiv.innerText = '✅ Texto selecionável extraído com sucesso!';
            }
        }
        
 // --- 2. FALLBACK/IMAGEM: EXECUTAR OCR ---
if (!finalExtractedText) {
    statusDiv.innerText = 'Executando OCR avançado...';

    const tempCanvas = document.createElement('canvas');
    const tctx = tempCanvas.getContext('2d');

    const maxOcrDimension = 2200;
    const maxOcrPixels = 6000000;
    const cropDimension = Math.max(cropRect.width, cropRect.height, 1);
    const cropPixels = Math.max(cropRect.width * cropRect.height, 1);
    const scale = Math.min(
        5,
        maxOcrDimension / cropDimension,
        Math.sqrt(maxOcrPixels / cropPixels)
    );

    // renderiza página inteira em alta resolução
    const viewport = pdfPage
        ? pdfPage.getViewport({ scale })
        : null;

    if (pdfPage) {
        tempCanvas.width = viewport.width;
        tempCanvas.height = viewport.height;

        await pdfPage.render({
            canvasContext: tctx,
            viewport: viewport
        }).promise;

        // AGORA recorta depois do render (método correto!)
        const imageData = tctx.getImageData(
            cropRect.x * scale,
            cropRect.y * scale,
            cropRect.width * scale,
            cropRect.height * scale
        );

        // Redimensiona canvas para área recortada
        tempCanvas.width = cropRect.width * scale;
        tempCanvas.height = cropRect.height * scale;

        tctx.putImageData(imageData, 0, 0);

    } else {
        tempCanvas.width = cropRect.width * scale;
        tempCanvas.height = cropRect.height * scale;

        tctx.drawImage(
            canvas,
            cropRect.x, cropRect.y, cropRect.width, cropRect.height,
            0, 0, tempCanvas.width, tempCanvas.height
        );
    }

    // --- BINARIZAÇÃO FORTE (fundamental) ---
    const img = tctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    const d = img.data;

    for (let i = 0; i < d.length; i += 4) {
        const gray = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
        const v = gray > 170 ? 255 : 0;

        d[i] = v;
        d[i + 1] = v;
        d[i + 2] = v;
    }

    tctx.putImageData(img, 0, 0);

    // OCR local no navegador (Tesseract); nenhum dado sai do dispositivo.
    if (!window.Tesseract || typeof window.Tesseract.createWorker !== 'function') {
        throw new Error('Biblioteca de OCR local indisponível.');
    }
    const base = '../PDFtoArcgis/vendor/tesseract/';
    const ocrWorker = await window.Tesseract.createWorker('por', window.Tesseract.OEM.LSTM_ONLY, {
        workerPath: new URL(base + 'worker.min.js', document.baseURI).href,
        corePath: new URL(base + 'tesseract-core.wasm.js', document.baseURI).href,
        langPath: new URL(base + 'lang-data', document.baseURI).href,
        gzip: true
    });
    try {
        const result = await ocrWorker.recognize(tempCanvas);
        finalExtractedText = String(result?.data?.text || '').trim();
    } finally {
        await ocrWorker.terminate();
    }
}

        // --- 3. EXIBIR RESULTADO E PREPARAR DOWNLOAD (CSV/DOC) ---
        ocrProgress.style.display = 'none'; 
        const rawText = finalExtractedText.trim();
        
        // Exibe o texto bruto (com quebras de linha preservadas) na pré-visualização.
        document.getElementById('output').innerText = rawText;


        let fileContent;
        let fileExtension;
        let downloadButtonText;

        // 4. DETECÇÃO E PROCESSAMENTO INTELIGENTE
        if (isTable(rawText)) {
            // --- É TABELA: PREPARA CSV ---
            statusDiv.innerText = '✅ Extração concluída. Estrutura de TABELA detectada. Gerando CSV (Excel).';
            
            const lines = rawText.split('\n').filter(l => l.trim() !== '');
            
            const csvLines = lines.map(l => {
                let processedLine = l.replace(/(\d),(\d)/g, '$1.$2'); 
                processedLine = processedLine.replace(/[°'"]/g, '');

                // Remove MULTIPLOS espaços e tabs, substituindo-os por uma única vírgula (SEPARADOR DE COLUNAS)
                return processedLine.trim().split(/\s{2,}/).join(','); 
            });
            
            fileContent = csvLines.join('\n');
            fileExtension = '.csv';
            downloadButtonText = '📥 Baixar CSV (Excel)';
            
        } else {
            // --- É TEXTO CORRIDO: PREPARA DOC ---
            statusDiv.innerText = '✅ Extração concluída. Estrutura de TEXTO CORRIDO detectada. Gerando DOC (Word).';
            
            fileContent = rawText; 
            fileExtension = '.doc'; 
            downloadButtonText = '📄 Baixar DOC (Word)'; 
        }

        
        // Habilita download
        const downloadBtn = document.getElementById('downloadBtn');
        downloadBtn.style.display = 'inline';
        downloadBtn.innerHTML = downloadButtonText; // Atualiza o texto do botão

        downloadBtn.onclick = () => {
            const mimeType = (fileExtension === '.csv') 
                ? 'text/csv;charset=utf-8;' 
                : 'application/msword;charset=utf-8;'; // MimeType para Word

            const blob = new Blob([fileContent], { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const pageSuffix = pdfDoc ? `_p${currentPageNum}` : '';
            a.download = `${fileNameBase}${pageSuffix}${fileExtension}`; 
            a.click();
            URL.revokeObjectURL(url);
        };
        
        statusDiv.classList.remove('is-primary');
        statusDiv.classList.add('is-success');

    } catch (error) {
        ocrProgress.style.display = 'none'; 
        statusDiv.classList.remove('is-primary');
        statusDiv.classList.add('is-danger');
        statusDiv.innerText = `❌ Erro na extração: ${error.message}`;
        console.error('Erro no processamento:', error);
    }
});

// ----------------------------------------------------\
// --- FUNÇÕES DE UTILIDADE ---
// ----------------------------------------------------

window.addEventListener('resize', () => {
    if (pdfPage) {
        renderPage(currentPageNum);
    }
});

// Menu lateral e integração Android
function openNav() { document.getElementById("mySidenav").style.width = "250px"; }
function closeNav() { document.getElementById("mySidenav").style.width = "0"; }
function exitApp() {
    if (window.Android && typeof window.Android.exitApp === 'function') {
        window.Android.exitApp();
    }
}
