// --- START OF FILE script.js ---

// Carrega o jsPDF, pdf.js e pdf-lib de forma assíncrona
let jsPDF; // Variável global para jsPDF (ainda pode ser útil para outras coisas, mas não para criar a página)
let Tesseract; // Variável global para Tesseract
let pdfjsLib; // Variável global para pdf.js
let PDFLib; // Variável global para pdf-lib

// Função para rolar a página para baixo suavemente
function scrollToPdfPagesContainer() {
    const pdfPagesContainer = document.getElementById("pdf-pages-container");
    if (pdfPagesContainer) {
        const headerElement = pdfPagesContainer.previousElementSibling;
        const elementToScrollTo = headerElement || pdfPagesContainer;
        elementToScrollTo.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }
}

// Função para carregar scripts dinamicamente
function loadScript(url, callback, id = null) {
    // Evita carregar o mesmo script múltiplas vezes se o ID for fornecido e já existir
    if (id && document.getElementById(id)) {
        if (callback) callback(); // Chama o callback se já carregado
        return;
    }
    const script = document.createElement("script");
    if (id) script.id = id; // Atribui ID se fornecido
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
window.updateFileName = function() {
    const fileInput = document.getElementById("pdfUpload");
    const fileSelectedName = document.getElementById("file-selected-name");
    const pdfPagesContainer = document.getElementById("pdf-pages-container");
    const logMessages = document.getElementById("log-messages");

    if (fileInput.files.length > 0) {
        fileSelectedName.textContent = "Arquivo selecionado: " + fileInput.files[0].name;
    } else {
        fileSelectedName.textContent = "Nenhum arquivo selecionado";
    }
    if (pdfPagesContainer) pdfPagesContainer.innerHTML = "";
    // Verifica se todas as libs carregaram antes de mostrar "pronto"
    if (Tesseract && pdfjsLib && PDFLib) {
       displayLogMessage("Pronto para processar. Selecione um PDF.");
    } else {
       displayLogMessage("Carregando bibliotecas, aguarde...");
    }
};

// Função principal para processar o PDF
async function processarPdf() {
    const fileInput = document.getElementById("pdfUpload");
    const file = fileInput.files[0];
    const processarPDFButton = document.getElementById("processarPDF");
    const pdfPagesContainer = document.getElementById("pdf-pages-container");

    // Verifica se as bibliotecas e o arquivo estão prontos
    if (!Tesseract || !pdfjsLib || !PDFLib) { // Adicionado cheque para PDFLib
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

    try {
        const arrayBuffer = await readFileAsync(file); // Usar ArrayBuffer para pdf-lib
        displayLogMessage("Arquivo lido. Carregando PDF...");

        // Carregar com pdf.js (para extração de nome via render/OCR)
        const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }); // pdf.js precisa de TypedArray
        const pdfJsDoc = await loadingTask.promise;
        const numPages = pdfJsDoc.numPages;

        // Carregar o mesmo ArrayBuffer com pdf-lib (para cópia de página)
        const pdfLibDoc = await PDFLib.PDFDocument.load(arrayBuffer);

        displayLogMessage(`PDF carregado (${numPages} páginas). Processando páginas...`);

        let processingPromises = [];
        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
            // Passar ambos os documentos e o índice correto para pdf-lib (0-based)
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
        displayLogMessage(`Erro: ${error.message || 'Ocorreu um erro desconhecido durante o processamento.'}`);
        alert("Ocorreu um erro ao processar o PDF. Verifique o console para mais detalhes.");
    } finally {
        processarPDFButton.textContent = "Processar PDF";
        processarPDFButton.disabled = false;
    }
}

// Função para processar uma única página do PDF
// Recebe agora o documento pdf.js (pdfJsDoc), o documento pdf-lib (pdfLibDoc),
// o número da página (pageNum, 1-based) e o índice da página (pageIndex, 0-based)
async function processarPagina(pdfJsDoc, pdfLibDoc, pageNum, pageIndex, totalPages) {
    let nomeIdentificado = null;
    let canvas = null; // Canvas ainda necessário para OCR

    try {
        displayLogMessage(`Processando página ${pageNum}/${totalPages}... (Extraindo nome)`);

        // --- PARTE 1: Extração de Nome (usando pdf.js e Tesseract como antes) ---
        const page = await pdfJsDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.5 }); // Escala para OCR

        // Cria canvas *apenas* se for potencialmente necessário para OCR
        canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const renderContext = { canvasContext: context, viewport: viewport };

        let textoExtraido = null;
        let ocrRealizado = false;

        // 1. Tentar extrair texto diretamente de pdf.js
        try {
            const textContent = await page.getTextContent();
            textoExtraido = textContent.items.map(item => item.str).join('\n');
            const info = extractNameInfo(textoExtraido, pageNum);
            nomeIdentificado = info.nome;

            const textoDiretoCurto = textoExtraido.replace(/\s/g, '').length < 150;

            // 2. Se não encontrou nome OU texto direto é curto, tentar OCR
            if ((!nomeIdentificado || textoDiretoCurto) && Tesseract) {
                 displayLogMessage(`Texto direto curto ou nome não encontrado na pág ${pageNum}. Tentando OCR...`);
                 await page.render(renderContext).promise; // Renderiza SÓ AGORA, se for fazer OCR
                 displayLogMessage(`Página ${pageNum}/${totalPages} renderizada para OCR.`);
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
                     textoExtraido = ocrText; // Usa o texto do OCR para re-extração
                     console.log(`OCR para página ${pageNum} concluído.`);
                     displayLogMessage(`OCR Pág ${pageNum} concluído. Re-extraindo nome...`);
                     const infoOcr = extractNameInfo(textoExtraido, pageNum, true);
                     // Prioriza nome do OCR se ele encontrar algo e o direto não, ou se texto direto era curto
                     if (infoOcr.nome && (!nomeIdentificado || textoDiretoCurto)) {
                        nomeIdentificado = infoOcr.nome;
                     } else if (!nomeIdentificado && infoOcr.nome) { // Se texto direto deu erro e OCR achou
                        nomeIdentificado = infoOcr.nome;
                     }

                 } catch (ocrError) {
                     console.error(`Erro durante OCR na página ${pageNum}:`, ocrError);
                     displayLogMessage(`Erro no OCR da página ${pageNum}. Usando nome padrão ou do texto direto se houver.`);
                 } finally {
                     if (worker) await worker.terminate();
                 }
            }

        } catch (textExtractError) {
            console.error(`Erro ao extrair texto direto da página ${pageNum} com pdf.js:`, textExtractError);
            displayLogMessage(`Erro extraindo texto direto da pág ${pageNum}. Tentando OCR...`);
             // Tentar OCR como fallback
             if (Tesseract) {
                 try {
                     await page.render(renderContext).promise; // Renderiza para OCR
                     displayLogMessage(`Página ${pageNum}/${totalPages} renderizada para OCR (fallback).`);
                     ocrRealizado = true;
                     let worker = null;
                     try {
                         worker = await Tesseract.createWorker('por', 1, { logger: m => { /*...*/ } });
                         const { data: { text: ocrText } } = await worker.recognize(canvas);
                         textoExtraido = ocrText;
                         console.log(`OCR (fallback) para página ${pageNum} concluído.`);
                         displayLogMessage(`OCR Pág ${pageNum} concluído. Re-extraindo nome...`);
                         const infoOcr = extractNameInfo(textoExtraido, pageNum, true);
                         nomeIdentificado = infoOcr.nome; // Usa o nome do OCR se encontrado
                     } catch (ocrErrorFallback) {
                         console.error(`Erro durante OCR (fallback) na página ${pageNum}:`, ocrErrorFallback);
                         displayLogMessage(`Erro no OCR (fallback) da página ${pageNum}. Usando nome padrão.`);
                     } finally {
                         if (worker) await worker.terminate();
                     }
                 } catch (renderError) {
                     console.error(`Erro ao renderizar página ${pageNum} para OCR (fallback):`, renderError);
                     displayLogMessage(`Erro ao renderizar Pág ${pageNum} para OCR. Usando nome padrão.`);
                 }
             } else {
                displayLogMessage(`Tesseract não disponível para OCR na Pág ${pageNum}.`);
             }
        }

        // Define o nome final para o arquivo/link (MAIÚSCULAS)
        const finalNameUpper = (nomeIdentificado || `Pagina_${pageNum}`).toUpperCase(); // Garante um nome base
        const safeFileName = finalNameUpper.replace(/[/\\?%*:|"<>]/g, '_').replace(/\s+/g, '_');
        const downloadFileName = `${safeFileName}.pdf`; // Nome já inclui número se nome não for encontrado

        displayLogMessage(`Nome para pág ${pageNum}: ${nomeIdentificado || 'Não encontrado'}. Gerando PDF selecionável...`);

        // --- PARTE 2: Criação do PDF de Página Única com Texto Selecionável (usando pdf-lib) ---
        const newPdfDoc = await PDFLib.PDFDocument.create();
        // Copia a página *original* do documento carregado pelo pdf-lib
        // Usa pageIndex (0-based) que foi passado para a função
        const [copiedPage] = await newPdfDoc.copyPages(pdfLibDoc, [pageIndex]);
        newPdfDoc.addPage(copiedPage);

        // Salva o novo PDF como Data URI
        const pdfBytes = await newPdfDoc.save();
        const pdfDataUri = URL.createObjectURL(new Blob([pdfBytes], { type: 'application/pdf' }));

        // Cria o link de download
        const downloadLink = document.createElement("a");
        downloadLink.href = pdfDataUri;
        downloadLink.download = downloadFileName;
        downloadLink.textContent = `Página ${pageNum}${nomeIdentificado ? ` (${finalNameUpper})` : ''}`;
        downloadLink.target = "_blank"; // Opcional: abrir em nova aba para preview

        // Limpa o Object URL após o download (ou navegação) para liberar memória
        // Uma abordagem simples é revogar após um tempo, ou idealmente no evento de clique (mais complexo de gerenciar com múltiplos links)
        // setTimeout(() => URL.revokeObjectURL(pdfDataUri), 60000); // Revoga após 1 minuto

        const pageItem = document.createElement("div");
        pageItem.classList.add("custom-pdf-page-item");
        pageItem.appendChild(downloadLink);

        return { pageNum: pageNum, element: pageItem };

    } catch (error) {
        console.error(`Erro fatal ao processar a página ${pageNum}:`, error);
        displayLogMessage(`Erro grave ao processar página ${pageNum}.`);
        return { pageNum: pageNum, element: null };
    } finally {
        // Limpa o canvas se foi usado
        if (canvas) {
             canvas.width = 0;
             canvas.height = 0;
             canvas = null; // Ajuda GC
             // Não precisa remover do DOM pois não foi adicionado
        }
    }
}


/**
 * Extrai informações de nome de um bloco de texto.
 * Tenta identificar nomes completos baseados em padrões e rótulos.
 * (Função extractNameInfo permanece igual - sem modificações necessárias aqui)
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
    let nomeEncontrado = null;

    // --- Estratégia de Padrões ---
    // Expressões Regulares (Case-Insensitive, Multi-linha)
    // Adaptação para capturar nomes com apóstrofos e acentos comuns em PT/ES
    // Inclui flexibilidade para diferentes formas de "de", "da", "do", "dos", "das"
    const namePart = "[A-ZÀ-ÖØ-ÞÁÉÍÓÚÂÊÎÔÛÃÕÇÑ][a-zà-öø-ÿáéíóúâêîôûãõçñ']+"; // Parte do nome (e.g., João, D'Ávila)
    const preposition = "(?:\\s+(?:de|da|do|dos|das)\\s+)"; // Preposição opcional
    // Captura 2 a 6 partes de nome, permitindo preposições entre elas
    const nameCaptureGroup = `(${namePart}(?:${preposition}?${namePart}){1,5})`; // Nome composto

    const patterns = [
        // --- Rótulos Específicos (Prioridade Alta) ---
        // Captura na mesma linha ou na próxima linha não vazia após o rótulo
        { regex: new RegExp(`(?:NOME\\s*DO\\s*PACIENTE|PACIENTE|NOME\\s*DO\\s*CLIENTE|CLIENTE|NOME\\s*DO\\s*SEGURADO|SEGURADO|NOME\\s*DO\\s*BENEFICIÁRIO|BENEFICIÁRIO|NOME\\s*COMPLETO|NOME\\s*DO\\s*CONTRATANTE|CONTRATANTE)\\s*[:\\-]?\\s*$`, 'gim'), captureNextLine: true, label: "Nome (Paciente/Cliente/Etc Label)" },
        { regex: new RegExp(`(?:NOME\\s*DO\\s*PACIENTE|PACIENTE|NOME\\s*DO\\s*CLIENTE|CLIENTE|NOME\\s*DO\\s*SEGURADO|SEGURADO|NOME\\s*DO\\s*BENEFICIÁRIO|BENEFICIÁRIO|NOME\\s*COMPLETO|NOME\\s*DO\\s*CONTRATANTE|CONTRATANTE)\\s*[:\\-]?\\s*${nameCaptureGroup}`, 'gim'), captureNextLine: false, label: "Nome (Paciente/Cliente/Etc)" },
        { regex: new RegExp(`PRESTADOR\\s*(?:DE\\s*SERVIÇO(?:S)?)?\\s*[:\\-]?\\s*$`, 'gim'), captureNextLine: true, label: "Prestador (Label)" },
        { regex: new RegExp(`PRESTADOR\\s*(?:DE\\s*SERVIÇO(?:S)?)?\\s*[:\\-]?\\s*${nameCaptureGroup}`, 'gim'), captureNextLine: false, label: "Prestador" },
        { regex: new RegExp(`(?:NOME|REMETENTE|DESTINATÁRIO)\\s*[:\\-]?\\s*$`, 'gim'), captureNextLine: true, label: "Nome/Remetente/Destinatário Genérico (Label)" }, // Adicionado Remetente/Destinatário
        { regex: new RegExp(`(?:NOME|REMETENTE|DESTINATÁRIO)\\s*[:\\-]?\\s*${nameCaptureGroup}`, 'gim'), captureNextLine: false, label: "Nome/Remetente/Destinatário Genérico" },

        // --- Padrão Geral de Nome Composto (Prioridade Média/Baixa) ---
        // Procura por nomes capitalizados no início de linha ou após espaço/dois pontos
        // Tenta evitar capturar títulos ou cabeçalhos curtos.
        { regex: new RegExp(`(?:^|\\s|:)${nameCaptureGroup}`, 'gim'), captureNextLine: false, label: "Nome Composto Capitalizado" }
    ];


    const lines = textToSearch.split('\n');
    let potentialMatch = null;
    let bestMatch = null; // Guarda o melhor match encontrado até agora

    for (let i = 0; i < lines.length; i++) {
        const currentLine = lines[i].trim();
        if (!currentLine) continue;

        for (const pattern of patterns) {
            pattern.regex.lastIndex = 0; // Reset regex index
            let match;
             // Executa o regex repetidamente na linha para encontrar todas as ocorrências (útil para nomes que não estão no início)
            while ((match = pattern.regex.exec(currentLine)) !== null) {
                if (pattern.captureNextLine) {
                    for (let j = i + 1; j < lines.length; j++) {
                        const nextLine = lines[j].trim();
                        if (nextLine) {
                            // Na próxima linha, procura por um padrão de nome capitalizado no início
                            const nameMatchNextLine = nextLine.match(new RegExp(`^${nameCaptureGroup}`, "i"));
                            if (nameMatchNextLine && nameMatchNextLine[1]) {
                                potentialMatch = nameMatchNextLine[1].trim();
                                if (isValidName(potentialMatch)) {
                                    console.log(`Nome encontrado (linha seguinte) via '${pattern.label}' na pág ${pageNumber}: ${potentialMatch}`);
                                    bestMatch = potentialMatch; // Encontrou um match válido
                                    break; // Para de procurar na próxima linha
                                } else {
                                     potentialMatch = null; // Descarta se inválido
                                }
                            }
                           break; // Para na primeira linha não vazia encontrada
                        }
                    }
                } else if (match[1]) { // O grupo de captura principal (índice 1)
                     potentialMatch = match[1].trim();
                     if (isValidName(potentialMatch)) {
                         console.log(`Nome encontrado via '${pattern.label}' na pág ${pageNumber}: ${potentialMatch}`);
                         bestMatch = potentialMatch; // Encontrou um match válido
                         // Não quebra o loop while aqui, pode haver um match melhor na mesma linha com outra regra
                     } else {
                        potentialMatch = null; // Descarta se inválido
                     }
                }
                // Se um bestMatch foi encontrado (por linha seguinte), para de procurar padrões nesta linha
                if (bestMatch && pattern.captureNextLine) break;
            }
            // Se um bestMatch foi encontrado (pela regra atual ou da linha seguinte), para de testar outros padrões nesta linha
            if (bestMatch) break;
        }
        // Se já encontrou um nome válido, podemos parar de processar linhas (decisão de performance vs robustez)
        // Vamos continuar para caso um nome mais específico (e.g., "Paciente:") apareça depois
        // if (bestMatch) break; // Descomente para parar na primeira linha com match válido
    }

    if (!bestMatch) {
         console.warn(`Nenhum nome válido encontrado com os padrões na página ${pageNumber}.`);
    }

    // Limpeza final
    if (bestMatch) {
        bestMatch = bestMatch.replace(/\s\s+/g, ' ').trim();
    }

    return { nome: bestMatch };
}


/**
 * Validação básica de um nome potencial.
 * (Função isValidName permanece igual - sem modificações necessárias aqui)
 * @param {string} name String a ser validada.
 * @returns {boolean} True se parece um nome válido, False caso contrário.
 */
function isValidName(name) {
    if (!name) return false;

    const trimmedName = name.trim();
    // Filtros básicos:
    if (trimmedName.length < 5 || trimmedName.length > 80) return false; // Comprimento razoável
    if (/^\d+$/.test(trimmedName)) return false; // Não ser só números
    if (/\d{3,}/.test(trimmedName)) return false; // Não conter sequências longas de números (provavelmente ID, CPF)
    if (/(?:RUA|AV|AVENIDA|PRAÇA|ALAMEDA|TRAVESSA|ESTRADA|RODOVIA|N[º°]|S\/N|CEP|CPF|CNPJ|RG\b|INSC|IE\b|IM\b|CÓDIGO|NUMERO|NÚMERO|SERVIÇO|TOTAL|DATA|HORA|PÁGINA|PAGINA|FOLHA)/i.test(trimmedName)) return false; // Evitar termos de endereço/documento/outros
    if (/(?:DECLARO|ASSINATURA|PROTOCOLO|RECIBO|COMPROVANTE| LTDA| S\.?A\.?| EIRELI| MEI\b| EPP\b)/i.test(trimmedName)) return false; // Evitar termos comuns de formulário/empresa
    if (trimmedName.toUpperCase() === trimmedName && trimmedName.length > 15) return false; // Evitar textos longos totalmente em maiúsculas (provavelmente títulos)
    // Verifica se há pelo menos duas partes separadas por espaço (indicativo de nome e sobrenome)
    if (!trimmedName.includes(' ')) return false;

    return true; // Passou nas validações básicas
}


// --- Inicialização ---
document.addEventListener('DOMContentLoaded', function() {
    const pdfjsLibUrl = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/"; // Use uma versão estável
    const pdfjsWorkerUrl = pdfjsLibUrl + "build/pdf.worker.min.js";
    const pdfjsLibBuildUrl = pdfjsLibUrl + "build/pdf.min.js";
    const tesseractUrl = "https://cdn.jsdelivr.net/npm/tesseract.js@5"; // v5 é mais recente
    const pdfLibUrl = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js"; // URL CDN para pdf-lib

    const initialProcessButton = document.getElementById("processarPDF");

    if (initialProcessButton) {
        initialProcessButton.disabled = true;
        initialProcessButton.textContent = "Carregando bibliotecas...";
    }
    displayLogMessage("Carregando bibliotecas, aguarde...");

    // Carrega pdf.js primeiro
    loadScript(pdfjsLibBuildUrl, () => {
        console.log("pdf.js carregado.");
        if (typeof window.pdfjsLib === 'undefined') {
             console.error("pdfjsLib não está definido após carregar o script.");
             displayLogMessage("Erro crítico ao carregar pdf.js. Recarregue a página."); return;
        }
        pdfjsLib = window.pdfjsLib;
        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

        // Carrega jsPDF (ainda mantido caso precise no futuro, mas não essencial para a divisão)
        loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js", () => {
            console.log("jsPDF carregado.");
             if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF === 'undefined') {
                 console.error("jsPDF não está definido corretamente."); // Não crítico agora
             } else {
                jsPDF = window.jspdf.jsPDF;
             }

             // Carrega pdf-lib
             loadScript(pdfLibUrl, () => {
                 console.log("pdf-lib carregado.");
                 if (typeof window.PDFLib === 'undefined') {
                    console.error("PDFLib não está definido após carregar o script.");
                    displayLogMessage("Erro crítico ao carregar pdf-lib. Recarregue a página."); return;
                 }
                 PDFLib = window.PDFLib; // Atribui a instância global

                 // Carrega Tesseract por último
                 loadScript(tesseractUrl + '/dist/tesseract.min.js', () => {
                    console.log("Tesseract.js carregado.");
                     if (typeof window.Tesseract === 'undefined') {
                         console.error("Tesseract não está definido após carregar o script.");
                         displayLogMessage("Erro crítico ao carregar Tesseract.js (OCR). Recarregue a página."); return;
                     }
                    Tesseract = window.Tesseract;

                    // Habilita o botão APÓS TUDO carregar
                    if (initialProcessButton) {
                        initialProcessButton.addEventListener("click", processarPdf);
                        initialProcessButton.disabled = false;
                        initialProcessButton.textContent = "Processar PDF";
                        displayLogMessage("Pronto para processar. Selecione um PDF.");
                    } else {
                        console.error("Botão 'processarPDF' não encontrado no DOM após carregamento.");
                    }
                 }, 'tesseract-script'); // ID para Tesseract
             }, 'pdf-lib-script'); // ID para pdf-lib
        }, 'jspdf-script'); // ID para jsPDF
    }, 'pdfjs-script'); // ID para pdf.js
});
// --- END OF FILE script.js ---