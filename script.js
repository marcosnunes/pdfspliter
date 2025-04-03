// Carrega o jsPDF, pdf.js e pdf-lib de forma assíncrona
let jsPDF; // Variável global para jsPDF (mantido, pode ser útil)
let Tesseract; // Variável global para Tesseract
let pdfjsLib; // Variável global para pdf.js
let PDFLib; // Variável global para pdf-lib

// Função para rolar a página para baixo suavemente
function scrollToPdfPagesContainer() {
    const pdfPagesContainer = document.getElementById("pdf-pages-container");
    if (pdfPagesContainer) {
        const headerElement = pdfPagesContainer.previousElementSibling; // H2 "Páginas Processadas"
        const elementToScrollTo = headerElement || pdfPagesContainer;
        elementToScrollTo.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }
}

// Função para carregar scripts dinamicamente
function loadScript(url, callback, id = null) {
    if (id && document.getElementById(id)) {
        if (callback) callback();
        return;
    }
    const script = document.createElement("script");
    if (id) script.id = id;
    script.type = "text/javascript";
    script.src = url;
    script.onload = callback;
    script.onerror = () => {
        console.error(`Erro ao carregar o script: ${url}`);
        displayLogMessage(`Erro ao carregar biblioteca essencial: ${url}. Recarregue a página.`);
        const processButton = document.getElementById("processarPDF");
        if(processButton) processButton.disabled = true;
    };
    document.head.appendChild(script);
}

// Função para exibir mensagens de log na interface e no console
function displayLogMessage(message) {
    const logMessages = document.getElementById("log-messages");
    if (logMessages) {
        logMessages.textContent = message;
    }
    console.log("Log:", message);
}

// Função assíncrona para ler arquivo como ArrayBuffer
function readFileAsync(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target.result);
        reader.onerror = (event) => reject(new Error(`Erro ao ler o arquivo: ${event.target.error}`));
        reader.readAsArrayBuffer(file);
    });
}

// Função para atualizar o nome do arquivo selecionado na UI
// (Removido 'window.' - será anexada via addEventListener)
function updateFileName() {
    const fileInput = document.getElementById("pdfUpload");
    const fileSelectedName = document.getElementById("file-selected-name");
    const pdfPagesContainer = document.getElementById("pdf-pages-container");
    const logMessages = document.getElementById("log-messages");
    const processButton = document.getElementById("processarPDF"); // Pegar botão para checar estado

    if (fileInput.files.length > 0) {
        fileSelectedName.textContent = "Arquivo selecionado: " + fileInput.files[0].name;
    } else {
        fileSelectedName.textContent = "Nenhum arquivo selecionado";
    }
    // Limpa resultados anteriores ao selecionar novo arquivo
    if (pdfPagesContainer) pdfPagesContainer.innerHTML = "";

    // Atualiza mensagem de log baseado no estado das libs e do botão
    if (Tesseract && pdfjsLib && PDFLib && processButton && !processButton.disabled) {
       // Só mostra pronto se TUDO carregou e botão está habilitado
       displayLogMessage("Pronto para processar. Selecione um PDF.");
    } else if (!Tesseract || !pdfjsLib || !PDFLib) {
       // Se alguma lib ainda não carregou
       displayLogMessage("Carregando bibliotecas, aguarde...");
    } else {
       // Se libs carregaram mas botão ainda está desabilitado (durante inicialização final)
       displayLogMessage("Inicializando...");
    }
};

// Função principal para processar o PDF (com carregamento sequencial)
async function processarPdf() {
    const fileInput = document.getElementById("pdfUpload");
    const file = fileInput.files[0];
    const processarPDFButton = document.getElementById("processarPDF");
    const pdfPagesContainer = document.getElementById("pdf-pages-container");

    // Verifica se as bibliotecas e o arquivo estão prontos
    if (!Tesseract || !pdfjsLib || !PDFLib) {
        alert("Erro: Uma ou mais bibliotecas essenciais (Tesseract, pdf.js, pdf-lib) não foram carregadas. Tente recarregar a página.");
        console.error("Bibliotecas ausentes:", { Tesseract, pdfjsLib, PDFLib });
        return;
    }
    if (!file) {
        alert("Por favor, selecione um arquivo PDF.");
        return;
    }
    if (file.type !== "application/pdf") {
        alert("Por favor, selecione um arquivo PDF válido.");
        return;
    }

    pdfPagesContainer.innerHTML = "";
    displayLogMessage("Iniciando processamento...");
    processarPDFButton.textContent = "Processando...";
    processarPDFButton.disabled = true;

    let pdfJsDoc = null; // Declarar fora do try
    let pdfLibDoc = null; // Declarar fora do try
    let numPages = 0;     // Declarar fora do try

    try {
        // 1. Ler o arquivo UMA VEZ como ArrayBuffer
        const originalArrayBuffer = await readFileAsync(file);
        displayLogMessage("Arquivo lido. Preparando carregamento...");

        // --- Etapa 1: Carregar COMPLETAMENTE com pdf-lib ---
        const pdfLibBuffer = originalArrayBuffer.slice(0); // Cópia para pdf-lib
        displayLogMessage("Carregando estrutura com pdf-lib...");
        try {
            pdfLibDoc = await PDFLib.PDFDocument.load(pdfLibBuffer); // Espera terminar
            numPages = pdfLibDoc.getPageCount();
            displayLogMessage(`Estrutura pdf-lib carregada (${numPages} páginas).`);
        } catch (pdfLibError) {
            console.error("Erro fatal ao carregar com pdf-lib:", pdfLibError);
            displayLogMessage(`Erro crítico ao carregar PDF com pdf-lib: ${pdfLibError.message}. Impossível continuar.`);
            alert("Erro ao carregar a estrutura do PDF. O arquivo pode estar corrompido ou incompatível com pdf-lib.");
            return; // Sai da função processarPdf
        }

        // --- Etapa 2: Carregar COMPLETAMENTE com pdf.js SÓ DEPOIS do pdf-lib ---
        const pdfjsBuffer = originalArrayBuffer.slice(0); // Nova cópia para pdf.js
        displayLogMessage("Carregando com pdf.js para extração/OCR...");
        try {
            const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfjsBuffer) });
            pdfJsDoc = await loadingTask.promise; // Espera terminar
            displayLogMessage("pdf.js carregado.");
            if (pdfJsDoc.numPages !== numPages) {
                console.warn(`Contagem de páginas diverge: pdf.js=${pdfJsDoc.numPages}, pdf-lib=${numPages}. Usando ${numPages}.`);
            }
        } catch (pdfjsError) {
            console.error("Erro ao carregar com pdf.js:", pdfjsError);
            displayLogMessage(`Aviso: Erro ao carregar com pdf.js (${pdfjsError.message}). Extração de nome e OCR podem falhar.`);
            // pdfJsDoc permanecerá null. processarPagina lidará com isso.
        }

        // --- Etapa 3: Processamento das páginas ---
        if (!pdfLibDoc) {
             throw new Error("Documento pdf-lib não foi carregado. Impossível processar páginas.");
        }

        displayLogMessage(`Iniciando processamento das ${numPages} páginas...`);

        let processingPromises = [];
        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
            processingPromises.push(processarPagina(pdfJsDoc, pdfLibDoc, pageNum, pageNum - 1, numPages));
        }

        const pageResults = await Promise.all(processingPromises);
        pageResults.sort((a, b) => a.pageNum - b.pageNum);

        pageResults.forEach(result => {
            if (result && result.element) {
                pdfPagesContainer.appendChild(result.element);
            } else {
                console.warn(`Resultado inválido ou elemento faltando para a página ${result?.pageNum}`);
                const errorItem = document.createElement("div");
                errorItem.classList.add("custom-pdf-page-item", "error-item");
                errorItem.textContent = `Falha Pág ${result?.pageNum || '?'}`;
                pdfPagesContainer.appendChild(errorItem);
            }
        });

        displayLogMessage("Concluído! Links para download disponíveis abaixo.");
        scrollToPdfPagesContainer();

    } catch (error) {
        console.error("Erro durante o processamento do PDF:", error);
        if (error instanceof TypeError && error.message.includes('detached ArrayBuffer')) {
             console.error("DETAILED STACK TRACE (DETACHED BUFFER):", error.stack);
             displayLogMessage("Erro crítico: Ocorreu um problema de acesso aos dados do PDF (detached ArrayBuffer). Verifique o console.");
             alert("Erro interno crítico (detached ArrayBuffer) ao processar o PDF. Recarregue a página ou tente outro arquivo.");
        } else {
             displayLogMessage(`Erro: ${error.message || 'Ocorreu um erro desconhecido.'}`);
             alert("Ocorreu um erro ao processar o PDF. Verifique o console para mais detalhes.");
        }
    } finally {
        processarPDFButton.textContent = "Processar PDF";
        processarPDFButton.disabled = false;
    }
}

// Função para processar uma única página do PDF (adaptada para pdfJsDoc opcional)
async function processarPagina(pdfJsDoc, pdfLibDoc, pageNum, pageIndex, totalPages) {
    let nomeIdentificado = null;
    let canvas = null; // Canvas só é necessário se pdfJsDoc e Tesseract estiverem disponíveis

    try {
        // --- PARTE 1: Extração de Nome (APENAS SE pdfJsDoc ESTIVER DISPONÍVEL) ---
        if (pdfJsDoc) {
            displayLogMessage(`Processando página ${pageNum}/${totalPages}... (Extraindo nome com pdf.js)`);
            const page = await pdfJsDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale: 1.5 }); // Escala para OCR

            // Cria canvas SÓ SE for usar OCR
            let needCanvas = false;
            try {
                const textContent = await page.getTextContent();
                const textoExtraidoTemp = textContent.items.map(item => item.str).join('\n');
                const infoTemp = extractNameInfo(textoExtraidoTemp, pageNum);
                 if (!infoTemp.nome || textoExtraidoTemp.replace(/\s/g, '').length < 150) {
                     if (Tesseract) needCanvas = true; // Precisa de canvas se for tentar OCR
                 }
            } catch (e) {
                // Se extração direta falhar, tentar OCR (precisa de canvas)
                if (Tesseract) needCanvas = true;
            }

            if (needCanvas) {
                canvas = document.createElement("canvas");
                const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                const renderContext = { canvasContext: context, viewport: viewport };
                await page.render(renderContext).promise; // Renderiza SÓ SE precisar do canvas
                displayLogMessage(`Página ${pageNum}/${totalPages} renderizada para OCR.`);
            }

            let textoExtraido = null;
            let ocrRealizado = false;

            // Tenta extrair texto direto novamente (pode ter sido feito acima, mas refazer aqui é mais seguro)
            try {
                const textContent = await page.getTextContent();
                textoExtraido = textContent.items.map(item => item.str).join('\n');
                const info = extractNameInfo(textoExtraido, pageNum);
                nomeIdentificado = info.nome;

                const textoDiretoCurto = textoExtraido.replace(/\s/g, '').length < 150;

                // Tenta OCR se nome não encontrado OU texto curto, e se Tesseract e Canvas estão disponíveis
                if ((!nomeIdentificado || textoDiretoCurto) && Tesseract && canvas) {
                    displayLogMessage(`Texto direto curto ou nome não encontrado na pág ${pageNum}. Tentando OCR...`);
                    console.log(`Iniciando OCR para a página ${pageNum}`);
                    ocrRealizado = true;
                    let worker = null;
                    try {
                        worker = await Tesseract.createWorker('por', 1, {
                            logger: m => {
                                if (m.status === 'recognizing text') {
                                    const progress = (m.progress * 100).toFixed(0);
                                    displayLogMessage(`OCR Página ${pageNum}: ${progress}%`);
                                } else { console.log(`OCR Status Pg ${pageNum}: ${m.status}`); }
                            }
                        });
                        const { data: { text: ocrText } } = await worker.recognize(canvas);
                        console.log(`OCR para página ${pageNum} concluído.`);
                        displayLogMessage(`OCR Pág ${pageNum} concluído. Re-extraindo nome...`);
                        // Usa o texto do OCR para re-extração
                        const infoOcr = extractNameInfo(ocrText, pageNum, true);
                        if (infoOcr.nome && (!nomeIdentificado || textoDiretoCurto)) {
                            nomeIdentificado = infoOcr.nome;
                        } else if (!nomeIdentificado && infoOcr.nome) {
                            nomeIdentificado = infoOcr.nome;
                        }
                    } catch (ocrError) {
                        console.error(`Erro durante OCR na página ${pageNum}:`, ocrError);
                        displayLogMessage(`Erro no OCR da página ${pageNum}.`);
                    } finally {
                        if (worker) await worker.terminate();
                    }
                }

            } catch (textExtractError) {
                console.error(`Erro ao extrair texto direto da pág ${pageNum} com pdf.js:`, textExtractError);
                displayLogMessage(`Erro extraindo texto direto pág ${pageNum}. Tentando OCR fallback...`);
                 // Tenta OCR como fallback se Tesseract e Canvas estiverem disponíveis
                 if (Tesseract && canvas) {
                    console.log(`Iniciando OCR (fallback) para a página ${pageNum}`);
                    ocrRealizado = true;
                    let worker = null;
                    try {
                        worker = await Tesseract.createWorker('por', 1, { logger: m => { /* ... logger ... */ } });
                        const { data: { text: ocrText } } = await worker.recognize(canvas);
                        console.log(`OCR (fallback) para página ${pageNum} concluído.`);
                        displayLogMessage(`OCR Pág ${pageNum} concluído (fallback). Re-extraindo nome...`);
                        const infoOcr = extractNameInfo(ocrText, pageNum, true);
                        nomeIdentificado = infoOcr.nome; // Usa o nome do OCR se encontrado
                    } catch (ocrErrorFallback) {
                        console.error(`Erro durante OCR (fallback) na página ${pageNum}:`, ocrErrorFallback);
                        displayLogMessage(`Erro no OCR (fallback) da página ${pageNum}.`);
                    } finally {
                        if (worker) await worker.terminate();
                    }
                 } else if (!canvas) {
                     displayLogMessage(`Canvas não disponível para OCR fallback na Pág ${pageNum}.`);
                 } else {
                    displayLogMessage(`Tesseract não disponível para OCR na Pág ${pageNum}.`);
                 }
            }
        } else {
            // Se pdfJsDoc não carregou, não podemos extrair nome
            displayLogMessage(`Aviso: pdf.js não carregado para pág ${pageNum}. Usando nome padrão.`);
            nomeIdentificado = null;
        }

        // Define o nome final (MESMO SE pdf.js FALHOU)
        const finalNameUpper = (nomeIdentificado || `Pagina_${pageNum}`).toUpperCase();
        const safeFileName = finalNameUpper.replace(/[/\\?%*:|"<>]/g, '_').replace(/\s+/g, '_');
        const downloadFileName = `${safeFileName}.pdf`;

        displayLogMessage(`Nome para pág ${pageNum}: ${nomeIdentificado || 'Padrão'}. Gerando PDF selecionável...`);

        // --- PARTE 2: Criação do PDF com pdf-lib (INDEPENDENTE do pdf.js) ---
        const newPdfDoc = await PDFLib.PDFDocument.create();
        // Copia a página original do documento pdf-lib
        const [copiedPage] = await newPdfDoc.copyPages(pdfLibDoc, [pageIndex]);
        newPdfDoc.addPage(copiedPage);

        // Salva o novo PDF como bytes e cria Object URL
        const pdfBytes = await newPdfDoc.save();
        const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
        const pdfDataUri = URL.createObjectURL(pdfBlob);

        // Cria o link de download
        const downloadLink = document.createElement("a");
        downloadLink.href = pdfDataUri;
        downloadLink.download = downloadFileName;
        downloadLink.textContent = `Página ${pageNum}${nomeIdentificado ? ` (${finalNameUpper})` : ''}`;
        downloadLink.target = "_blank"; // Abrir em nova aba para preview

        // Adiciona um listener para revogar o Object URL após o clique (melhor que timeout)
        downloadLink.addEventListener('click', () => {
             // Pequeno delay para garantir que o download iniciou antes de revogar
             setTimeout(() => URL.revokeObjectURL(pdfDataUri), 100);
        }, { once: true }); // O listener só precisa rodar uma vez

        const pageItem = document.createElement("div");
        pageItem.classList.add("custom-pdf-page-item");
        pageItem.appendChild(downloadLink);

        return { pageNum: pageNum, element: pageItem };

    } catch (error) {
        console.error(`Erro fatal ao processar a página ${pageNum}:`, error);
        if (error.message.includes('PDFDocument') || error.message.includes('copyPages') || error.message.includes('save')) {
             displayLogMessage(`Erro crítico (pdf-lib) ao gerar PDF para pág ${pageNum}: ${error.message}`);
        } else {
             displayLogMessage(`Erro grave ao processar página ${pageNum}.`);
        }
        return { pageNum: pageNum, element: null };
    } finally {
        // Limpa o canvas se foi usado
        if (canvas) {
             canvas.width = 0;
             canvas.height = 0;
             // Não é necessário remover do DOM pois não foi adicionado
             canvas = null;
        }
    }
}

/**
 * Extrai informações de nome de um bloco de texto.
 * (Função extractNameInfo - sem alterações, usando a versão robusta anterior)
 * @param {string} textToSearch O texto completo extraído da página (direto ou OCR).
 * @param {number} pageNumber O número da página (para logging).
 * @param {boolean} isOcr Indica se o texto veio do OCR (para logging).
 * @returns {{nome: string|null}} Objeto contendo o nome encontrado ou null.
 */
function extractNameInfo(textToSearch, pageNumber, isOcr = false) {
    if (!textToSearch) {
        return { nome: null };
    }

    console.log(`Iniciando extração de nome na pág ${pageNumber} (${isOcr ? 'OCR' : 'Texto Direto'}).`);

    const namePart = "[A-ZÀ-ÖØ-ÞÁÉÍÓÚÂÊÎÔÛÃÕÇÑ][a-zà-öø-ÿáéíóúâêîôûãõçñ']+";
    const preposition = "(?:\\s+(?:de|da|do|dos|das)\\s+)";
    const nameCaptureGroup = `(${namePart}(?:${preposition}?${namePart}){1,5})`; // 2 a 6 partes

    const patterns = [
        { regex: new RegExp(`(?:NOME\\s*DO\\s*PACIENTE|PACIENTE|NOME\\s*DO\\s*CLIENTE|CLIENTE|NOME\\s*DO\\s*SEGURADO|SEGURADO|NOME\\s*DO\\s*BENEFICIÁRIO|BENEFICIÁRIO|NOME\\s*COMPLETO|NOME\\s*DO\\s*CONTRATANTE|CONTRATANTE)\\s*[:\\-]?\\s*$`, 'gim'), captureNextLine: true, label: "Nome (Paciente/Cliente/Etc Label)" },
        { regex: new RegExp(`(?:NOME\\s*DO\\s*PACIENTE|PACIENTE|NOME\\s*DO\\s*CLIENTE|CLIENTE|NOME\\s*DO\\s*SEGURADO|SEGURADO|NOME\\s*DO\\s*BENEFICIÁRIO|BENEFICIÁRIO|NOME\\s*COMPLETO|NOME\\s*DO\\s*CONTRATANTE|CONTRATANTE)\\s*[:\\-]?\\s*${nameCaptureGroup}`, 'gim'), captureNextLine: false, label: "Nome (Paciente/Cliente/Etc)" },
        { regex: new RegExp(`PRESTADOR\\s*(?:DE\\s*SERVIÇO(?:S)?)?\\s*[:\\-]?\\s*$`, 'gim'), captureNextLine: true, label: "Prestador (Label)" },
        { regex: new RegExp(`PRESTADOR\\s*(?:DE\\s*SERVIÇO(?:S)?)?\\s*[:\\-]?\\s*${nameCaptureGroup}`, 'gim'), captureNextLine: false, label: "Prestador" },
        { regex: new RegExp(`(?:NOME|REMETENTE|DESTINATÁRIO)\\s*[:\\-]?\\s*$`, 'gim'), captureNextLine: true, label: "Nome/Remetente/Destinatário Genérico (Label)" },
        { regex: new RegExp(`(?:NOME|REMETENTE|DESTINATÁRIO)\\s*[:\\-]?\\s*${nameCaptureGroup}`, 'gim'), captureNextLine: false, label: "Nome/Remetente/Destinatário Genérico" },
        { regex: new RegExp(`(?:^|\\s|:)${nameCaptureGroup}`, 'gim'), captureNextLine: false, label: "Nome Composto Capitalizado" }
    ];

    const lines = textToSearch.split('\n');
    let bestMatch = null;

    for (let i = 0; i < lines.length; i++) {
        const currentLine = lines[i].trim();
        if (!currentLine) continue;

        for (const pattern of patterns) {
            pattern.regex.lastIndex = 0; // Reset regex index
            let match;
            while ((match = pattern.regex.exec(currentLine)) !== null) {
                let potentialMatch = null;
                if (pattern.captureNextLine) {
                    for (let j = i + 1; j < lines.length; j++) {
                        const nextLine = lines[j].trim();
                        if (nextLine) {
                            const nameMatchNextLine = nextLine.match(new RegExp(`^${nameCaptureGroup}`, "i"));
                            if (nameMatchNextLine && nameMatchNextLine[1]) {
                                potentialMatch = nameMatchNextLine[1].trim();
                                if (isValidName(potentialMatch)) {
                                    console.log(`Nome encontrado (linha seguinte) via '${pattern.label}' na pág ${pageNumber}: ${potentialMatch}`);
                                    bestMatch = potentialMatch;
                                    break;
                                } else { potentialMatch = null; }
                            }
                           break;
                        }
                    }
                } else if (match[1]) {
                     potentialMatch = match[1].trim();
                     if (isValidName(potentialMatch)) {
                         console.log(`Nome encontrado via '${pattern.label}' na pág ${pageNumber}: ${potentialMatch}`);
                         bestMatch = potentialMatch;
                     } else { potentialMatch = null; }
                }
                if (bestMatch && pattern.captureNextLine) break;
            }
            if (bestMatch) break;
        }
        // Continuar procurando em outras linhas pode achar um rótulo mais específico
        // if (bestMatch) break; // Descomentar para parar na primeira linha com match
    }

    if (!bestMatch) {
         console.warn(`Nenhum nome válido encontrado com os padrões na página ${pageNumber}.`);
    }

    if (bestMatch) {
        bestMatch = bestMatch.replace(/\s\s+/g, ' ').trim();
    }

    return { nome: bestMatch };
}

/**
 * Validação básica de um nome potencial.
 * (Função isValidName - sem alterações, usando a versão robusta anterior)
 * @param {string} name String a ser validada.
 * @returns {boolean} True se parece um nome válido, False caso contrário.
 */
function isValidName(name) {
    if (!name) return false;
    const trimmedName = name.trim();
    if (trimmedName.length < 5 || trimmedName.length > 80) return false;
    if (/^\d+$/.test(trimmedName)) return false;
    if (/\d{3,}/.test(trimmedName)) return false;
    if (/(?:RUA|AV|AVENIDA|PRAÇA|ALAMEDA|TRAVESSA|ESTRADA|RODOVIA|N[º°]|S\/N|CEP|CPF|CNPJ|RG\b|INSC|IE\b|IM\b|CÓDIGO|NUMERO|NÚMERO|SERVIÇO|TOTAL|DATA|HORA|PÁGINA|PAGINA|FOLHA)/i.test(trimmedName)) return false;
    if (/(?:DECLARO|ASSINATURA|PROTOCOLO|RECIBO|COMPROVANTE| LTDA| S\.?A\.?| EIRELI| MEI\b| EPP\b)/i.test(trimmedName)) return false;
    if (trimmedName.toUpperCase() === trimmedName && trimmedName.length > 15) return false;
    if (!trimmedName.includes(' ')) return false; // Exige pelo menos um espaço (nome composto)
    return true;
}


// --- Inicialização ---
document.addEventListener('DOMContentLoaded', function() {
    // URLs das bibliotecas
    const pdfjsLibUrl = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/";
    const pdfjsWorkerUrl = pdfjsLibUrl + "build/pdf.worker.min.js";
    const pdfjsLibBuildUrl = pdfjsLibUrl + "build/pdf.min.js";
    const tesseractUrl = "https://cdn.jsdelivr.net/npm/tesseract.js@5";
    const pdfLibUrl = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";
    const jspdfUrl = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";

    // Elementos do DOM
    const initialProcessButton = document.getElementById("processarPDF");
    const fileInput = document.getElementById("pdfUpload");

    // *** Adiciona Event Listener para o input de ficheiro ***
    if (fileInput) {
        fileInput.addEventListener('change', updateFileName); // Anexa a função via JS
    } else {
        console.error("Elemento de input 'pdfUpload' não encontrado!");
    }

    // Configuração inicial do botão e log
    if (initialProcessButton) {
        initialProcessButton.disabled = true;
        initialProcessButton.textContent = "Carregando bibliotecas...";
    }
    displayLogMessage("Carregando bibliotecas, aguarde...");

    // Carregamento sequencial das bibliotecas
    loadScript(pdfjsLibBuildUrl, () => {
        console.log("pdf.js carregado.");
        if (typeof window.pdfjsLib === 'undefined') {
             console.error("pdfjsLib não está definido."); displayLogMessage("Erro: Falha ao carregar pdf.js."); return;
        }
        pdfjsLib = window.pdfjsLib;
        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

        loadScript(jspdfUrl, () => { // Carrega jsPDF (opcional)
            console.log("jsPDF carregado.");
             if (typeof window.jspdf !== 'undefined' && typeof window.jspdf.jsPDF !== 'undefined') {
                jsPDF = window.jspdf.jsPDF;
             } else { console.warn("jsPDF não carregado corretamente."); }

             loadScript(pdfLibUrl, () => { // Carrega pdf-lib (ESSENCIAL)
                 console.log("pdf-lib carregado.");
                 if (typeof window.PDFLib === 'undefined') {
                    console.error("PDFLib não está definido."); displayLogMessage("Erro: Falha ao carregar pdf-lib."); return;
                 }
                 PDFLib = window.PDFLib;

                 loadScript(tesseractUrl + '/dist/tesseract.min.js', () => { // Carrega Tesseract (ESSENCIAL para OCR)
                    console.log("Tesseract.js carregado.");
                     if (typeof window.Tesseract === 'undefined') {
                         console.error("Tesseract não está definido."); displayLogMessage("Erro: Falha ao carregar Tesseract.js (OCR)."); return;
                     }
                    Tesseract = window.Tesseract;

                    // TUDO CARREGADO - Habilita o botão e define estado final
                    if (initialProcessButton) {
                        initialProcessButton.addEventListener("click", processarPdf); // Anexa o processamento ao clique
                        initialProcessButton.disabled = false;
                        initialProcessButton.textContent = "Processar PDF";
                        // Chama updateFileName para definir estado inicial ("Nenhum arquivo...", "Pronto...")
                        updateFileName();
                    } else {
                        console.error("Botão 'processarPDF' não encontrado no DOM após carregamento.");
                    }
                 }, 'tesseract-script');
             }, 'pdf-lib-script');
        }, 'jspdf-script');
    }, 'pdfjs-script');
});