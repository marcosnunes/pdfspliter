// Carrega o jsPDF e pdf.js de forma assíncrona
let jsPDF; // Variável global para jsPDF
let Tesseract; // Variável global para Tesseract

// Função para rolar a página para baixo suavemente
function scrollToPdfPagesContainer() {
    const pdfPagesContainer = document.getElementById("pdf-pages-container");
    if (pdfPagesContainer) {
        // Encontra o elemento H2 "Páginas Processadas" para alinhar a rolagem
        const headerElement = pdfPagesContainer.previousElementSibling;
        const elementToScrollTo = headerElement || pdfPagesContainer; // Usa H2 ou o container
        elementToScrollTo.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }
}

// Função para carregar scripts dinamicamente
function loadScript(url, callback) {
    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = url;
    script.onload = callback;
    script.onerror = () => {
        console.error(`Erro ao carregar o script: ${url}`);
        displayLogMessage(`Erro ao carregar biblioteca essencial: ${url}. Recarregue a página.`);
        // Poderia desabilitar o botão permanentemente aqui se uma lib essencial falhar
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
    console.log("Log:", message); // Log também no console para depuração
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
    // Limpa resultados e logs anteriores ao selecionar novo arquivo
    if (pdfPagesContainer) pdfPagesContainer.innerHTML = "";
    if (Tesseract) { // Só mostra "pronto" se Tesseract carregou
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
    if (!Tesseract || !jsPDF || !pdfjsLib) {
        alert("Erro: Uma ou mais bibliotecas essenciais não foram carregadas. Tente recarregar a página.");
        console.error("Bibliotecas ausentes:", { Tesseract, jsPDF, pdfjsLib });
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

    // Prepara a UI para o processamento
    pdfPagesContainer.innerHTML = "";
    displayLogMessage("Iniciando processamento...");
    processarPDFButton.textContent = "Processando...";
    processarPDFButton.disabled = true;

    try {
        const typedarray = await readFileAsync(file);
        displayLogMessage("Arquivo lido. Carregando PDF...");

        const loadingTask = pdfjsLib.getDocument({ data: typedarray });
        const pdfDocument = await loadingTask.promise;
        const numPages = pdfDocument.numPages;
        displayLogMessage(`PDF carregado (${numPages} páginas). Processando páginas...`);

        let processingPromises = [];
        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
            // Inicia o processamento de cada página em paralelo
            processingPromises.push(processarPagina(pdfDocument, pageNum, numPages));
        }

        // Aguarda a conclusão de todas as páginas
        const pageResults = await Promise.all(processingPromises);

        // Ordena os resultados pelo número da página
        pageResults.sort((a, b) => a.pageNum - b.pageNum);

        // Adiciona os resultados (links de download) ao container
        pageResults.forEach(result => {
            if (result && result.element) {
                pdfPagesContainer.appendChild(result.element);
            } else {
                console.warn(`Resultado inválido ou elemento faltando para a página ${result?.pageNum}`);
                // Adiciona um item de erro visual para a página que falhou
                const errorItem = document.createElement("div");
                errorItem.classList.add("custom-pdf-page-item", "error-item");
                errorItem.textContent = `Falha Pág ${result?.pageNum || '?'}`;
                pdfPagesContainer.appendChild(errorItem);
            }
        });

        displayLogMessage("Concluído! Links para download disponíveis abaixo.");
        scrollToPdfPagesContainer(); // Rola para a seção de resultados

    } catch (error) {
        console.error("Erro durante o processamento do PDF:", error);
        displayLogMessage(`Erro: ${error.message || 'Ocorreu um erro desconhecido durante o processamento.'}`);
        alert("Ocorreu um erro ao processar o PDF. Verifique o console para mais detalhes.");
    } finally {
        // Restaura o botão ao final, seja sucesso ou falha
        processarPDFButton.textContent = "Processar PDF";
        processarPDFButton.disabled = false;
    }
}

// Função para processar uma única página do PDF
async function processarPagina(pdfDocument, pageNum, totalPages) {
    let nomeIdentificado = null; // Nome extraído (Prestador, Paciente, etc.)
    let canvas; // Elemento Canvas para renderização e OCR
    let viewport; // Viewport da página

    try {
        displayLogMessage(`Processando página ${pageNum}/${totalPages}...`);
        const page = await pdfDocument.getPage(pageNum);
        // Ajuste a escala conforme necessário (1.5 é um bom começo)
        viewport = page.getViewport({ scale: 1.5 });

        // Cria um canvas para renderizar a página
        canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", {
            alpha: false, // Melhora performance se não precisar de transparência
            willReadFrequently: true // Hint para otimizar leitura do canvas pelo OCR
        });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const renderContext = { canvasContext: context, viewport: viewport };

        // Renderiza a página no canvas
        await page.render(renderContext).promise;
        displayLogMessage(`Página ${pageNum}/${totalPages} renderizada. Extraindo texto...`);

        // --- Extração de Texto e Nome ---
        let textoExtraido = null;
        let ocrRealizado = false;

        // 1. Tentar extrair texto diretamente (PDFs com texto selecionável)
        try {
            const textContent = await page.getTextContent();
            textoExtraido = textContent.items.map(item => item.str).join('\n'); // Junta com quebras de linha
            const info = extractNameInfo(textoExtraido, pageNum); // Usa a função melhorada
            nomeIdentificado = info.nome;

             // Heurística: Se texto direto é muito curto, pode ser imagem.
             const textoDiretoCurto = textoExtraido.replace(/\s/g, '').length < 150; // Limite ajustável

            // 2. Se não encontrou nome OU texto direto é curto, tentar OCR
            if (!nomeIdentificado && textoDiretoCurto) {
                 displayLogMessage(`Texto direto curto ou nome não encontrado na pág ${pageNum}. Tentando OCR...`);
                 console.log(`Iniciando OCR para a página ${pageNum}`);
                 ocrRealizado = true;
                 let worker = null;
                 try {
                     worker = await Tesseract.createWorker('por', 1, { // 'por' para Português
                         logger: m => { // Feedback de progresso do OCR
                             if (m.status === 'recognizing text') {
                                 const progress = (m.progress * 100).toFixed(0);
                                 displayLogMessage(`OCR Página ${pageNum}: ${progress}%`);
                             } else {
                                 console.log(`OCR Status Pg ${pageNum}: ${m.status}`);
                             }
                         }
                     });
                     const { data: { text: ocrText } } = await worker.recognize(canvas);
                     textoExtraido = ocrText; // Usa o texto do OCR
                     console.log(`OCR para página ${pageNum} concluído.`);
                     displayLogMessage(`OCR Pág ${pageNum} concluído. Re-extraindo nome...`);
                     // Tenta extrair o nome novamente com o texto do OCR
                     const infoOcr = extractNameInfo(textoExtraido, pageNum, true); // Passa flag de OCR
                     nomeIdentificado = infoOcr.nome;

                 } catch (ocrError) {
                     console.error(`Erro durante OCR na página ${pageNum}:`, ocrError);
                     displayLogMessage(`Erro no OCR da página ${pageNum}. Usando nome padrão.`);
                     // Continua sem nome se OCR falhar, mas com o texto do OCR se disponível
                 } finally {
                     if (worker) await worker.terminate(); // Finaliza o worker
                 }
            }

        } catch (textExtractError) {
            console.error(`Erro ao extrair texto direto da página ${pageNum}:`, textExtractError);
            displayLogMessage(`Erro extraindo texto direto da pág ${pageNum}. Tentando OCR...`);
             // Se a extração direta falhar, tentar OCR de qualquer forma
             // (Duplicação da lógica de OCR - pode ser refatorado, mas deixado para clareza)
             console.log(`Iniciando OCR (fallback) para a página ${pageNum}`);
             ocrRealizado = true;
             let worker = null;
             try {
                 worker = await Tesseract.createWorker('por', 1, {
                     logger: m => {
                         if (m.status === 'recognizing text') {
                             const progress = (m.progress * 100).toFixed(0);
                             displayLogMessage(`OCR Página ${pageNum}: ${progress}%`);
                         } else {
                             console.log(`OCR Status Pg ${pageNum}: ${m.status}`);
                         }
                     }
                 });
                 const { data: { text: ocrText } } = await worker.recognize(canvas);
                 textoExtraido = ocrText;
                 console.log(`OCR (fallback) para página ${pageNum} concluído.`);
                 displayLogMessage(`OCR Pág ${pageNum} concluído. Re-extraindo nome...`);
                 const infoOcr = extractNameInfo(textoExtraido, pageNum, true);
                 nomeIdentificado = infoOcr.nome;
             } catch (ocrError) {
                 console.error(`Erro durante OCR (fallback) na página ${pageNum}:`, ocrError);
                 displayLogMessage(`Erro no OCR (fallback) da página ${pageNum}. Usando nome padrão.`);
             } finally {
                 if (worker) await worker.terminate();
             }
        }

        // Define o nome final para o arquivo/link
        // Transforma em MAIÚSCULAS aqui
        const finalNameUpper = (nomeIdentificado || "Pagina").toUpperCase();

        // Cria o PDF de página única
        const pdf = new jsPDF({
            orientation: viewport.width > viewport.height ? 'l' : 'p', // 'landscape' ou 'portrait'
            unit: 'px',
            format: [viewport.width, viewport.height]
        });

        const imgData = canvas.toDataURL('image/png'); // PNG geralmente melhor para texto/OCR
        pdf.addImage(imgData, 'PNG', 0, 0, viewport.width, viewport.height);
        const pdfData = pdf.output('datauristring'); // Gera Data URI

        // Cria o link de download
        const downloadLink = document.createElement("a");
        downloadLink.href = pdfData;
        // Sanitiza o nome para o arquivo (remove caracteres inválidos), *depois* de passar para maiúsculas
        const safeFileName = finalNameUpper.replace(/[/\\?%*:|"<>]/g, '_').replace(/\s+/g, '_');
        downloadLink.download = `${safeFileName}_pagina_${pageNum}.pdf`;
        // Texto do link mostra o nome em maiúsculas (se encontrado)
        downloadLink.textContent = `Página ${pageNum}${nomeIdentificado ? ` (${finalNameUpper})` : ''}`;

        // Cria o elemento visual para esta página
        const pageItem = document.createElement("div");
        pageItem.classList.add("custom-pdf-page-item");
        pageItem.appendChild(downloadLink);

        return { pageNum: pageNum, element: pageItem }; // Retorna sucesso

    } catch (error) {
        console.error(`Erro fatal ao processar a página ${pageNum}:`, error);
        displayLogMessage(`Erro grave ao processar página ${pageNum}.`);
        return { pageNum: pageNum, element: null }; // Retorna falha
    } finally {
        // Limpa o canvas para liberar memória, se ele existir
        if (canvas) {
             canvas.width = 0;
             canvas.height = 0;
             canvas.remove(); // Tenta remover o elemento do DOM também
        }
    }
}


/**
 * Extrai informações de nome de um bloco de texto.
 * Tenta identificar nomes completos baseados em padrões e rótulos.
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
    // 1. Padrões baseados em Rótulos (Prioridade Alta)
    // 2. Padrões de Nomes Compostos Capitalizados (Prioridade Média)
    // 3. Heurística Simples (Prioridade Baixa)

    // Expressões Regulares (Case-Insensitive, Multi-linha)
    // ([A-ZÀ-ÖØ-ÞÁÉÍÓÚÂÊÎÔÛÃÕÇÑ]...) : Inclui maiúsculas acentuadas comuns em PT/ES
    const nameCaptureGroup = "([A-ZÀ-ÖØ-ÞÁÉÍÓÚÂÊÎÔÛÃÕÇÑ][a-zà-öø-ÿáéíóúâêîôûãõçñ']+(?:\\s+(?:de|da|do|dos|das)\\s+)?(?:\\s+[A-ZÀ-ÖØ-ÞÁÉÍÓÚÂÊÎÔÛÃÕÇÑ][a-zà-öø-ÿáéíóúâêîôûãõçñ']+)+)";

    const patterns = [
        // --- Rótulos Específicos ---
        // Captura na mesma linha ou na próxima linha não vazia após o rótulo
        { regex: /(?:NOME\s*DO\s*PACIENTE|PACIENTE|NOME\s*DO\s*CLIENTE|CLIENTE|NOME\s*DO\s*SEGURADO|SEGURADO|NOME\s*DO\s*BENEFICIÁRIO|BENEFICIÁRIO|NOME\s*COMPLETO|NOME\s*DO\s*CONTRATANTE|CONTRATANTE)\s*[:\-]?\s*$/gim, captureNextLine: true, label: "Nome (Paciente/Cliente/Etc Label)" },
        { regex: /(?:NOME\s*DO\s*PACIENTE|PACIENTE|NOME\s*DO\s*CLIENTE|CLIENTE|NOME\s*DO\s*SEGURADO|SEGURADO|NOME\s*DO\s*BENEFICIÁRIO|BENEFICIÁRIO|NOME\s*COMPLETO|NOME\s*DO\s*CONTRATANTE|CONTRATANTE)\s*[:\-]?\s*` + nameCaptureGroup/gim, captureNextLine: false, label: "Nome (Paciente/Cliente/Etc)" },
        { regex: /PRESTADOR\s*(?:DE\s*SERVIÇO(?:S)?)?\s*[:\-]?\s*$/gim, captureNextLine: true, label: "Prestador (Label)" },
        { regex: /PRESTADOR\s*(?:DE\s*SERVIÇO(?:S)?)?\s*[:\-]?\s*` + nameCaptureGroup/gim, captureNextLine: false, label: "Prestador" },
        { regex: /NOME\s*[:\-]?\s*$/gim, captureNextLine: true, label: "Nome Genérico (Label)" },
        { regex: /NOME\s*[:\-]?\s*` + nameCaptureGroup/gim, captureNextLine: false, label: "Nome Genérico" },

        // --- Padrão Geral de Nome Composto ---
        // Procura por 2 a 5 palavras capitalizadas seguidas (incluindo preposições comuns)
        // Deve estar no início de uma linha ou precedido por espaço/tabulação.
         { regex: /(?:\s|^)` + nameCaptureGroup/gim, captureNextLine: false, label: "Nome Composto Capitalizado" }
    ];

    const lines = textToSearch.split('\n');
    let potentialMatch = null;

    for (let i = 0; i < lines.length; i++) {
        const currentLine = lines[i].trim();
        if (!currentLine) continue; // Pula linhas vazias

        for (const pattern of patterns) {
            pattern.regex.lastIndex = 0; // Reseta o índice para regex global
            const match = pattern.regex.exec(currentLine);

            if (match) {
                if (pattern.captureNextLine) {
                    // Procura na próxima linha não vazia
                    for (let j = i + 1; j < lines.length; j++) {
                        const nextLine = lines[j].trim();
                        if (nextLine) {
                            // Tenta um match mais simples na próxima linha (padrão capitalizado)
                            const nameMatch = nextLine.match(new RegExp("^" + nameCaptureGroup, "i"));
                            if (nameMatch && nameMatch[1]) {
                                potentialMatch = nameMatch[1].trim();
                                console.log(`Nome encontrado via '${pattern.label}' (linha seguinte) na pág ${pageNumber}: ${potentialMatch}`);
                                break; // Sai do loop de procura da próxima linha
                            }
                            break; // Para na primeira linha não vazia encontrada
                        }
                    }
                } else if (match[1]) {
                     potentialMatch = match[1].trim();
                     console.log(`Nome encontrado via '${pattern.label}' na pág ${pageNumber}: ${potentialMatch}`);
                }

                // Se encontrou um match potencial, valida e possivelmente encerra
                if (potentialMatch && isValidName(potentialMatch)) {
                    nomeEncontrado = potentialMatch;
                    break; // Para de procurar padrões nesta linha
                } else {
                    potentialMatch = null; // Descarta se inválido
                }
            }
        }
        if (nomeEncontrado) break; // Para de procurar linhas se já achou um nome válido
    }

    if (!nomeEncontrado) {
         console.warn(`Nenhum nome válido encontrado com os padrões na página ${pageNumber}.`);
         // Poderia adicionar uma heurística de último recurso aqui, se necessário
    }

    // Limpeza final (remove espaços múltiplos)
    if (nomeEncontrado) {
        nomeEncontrado = nomeEncontrado.replace(/\s\s+/g, ' ');
    }

    return { nome: nomeEncontrado };
}

/**
 * Validação básica de um nome potencial.
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
    if (/(?:RUA|AV|AVENIDA|PRAÇA|ALAMEDA|TRAVESSA|N[º°]|S\/N|CEP|CPF|CNPJ|RG\b)/i.test(trimmedName)) return false; // Evitar termos de endereço/documento
    if (/(?:DECLARO|ASSINATURA|PROTOCOLO|RECIBO|COMPROVANTE| LTDA| S\.?A\.?)/i.test(trimmedName)) return false; // Evitar termos comuns de formulário/empresa

    return true; // Passou nas validações básicas
}


// --- Inicialização ---
document.addEventListener('DOMContentLoaded', function() {
    const pdfjsLibUrl = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/";
    const pdfjsWorkerUrl = pdfjsLibUrl + "build/pdf.worker.min.js";
    const pdfjsLibBuildUrl = pdfjsLibUrl + "build/pdf.min.js";
    const tesseractUrl = "https://cdn.jsdelivr.net/npm/tesseract.js@5"; // Usar Tesseract.js v5 (ou a mais recente estável)

    const initialProcessButton = document.getElementById("processarPDF");

    // Desabilita o botão inicialmente e mostra mensagem de carregamento
    if (initialProcessButton) {
        initialProcessButton.disabled = true;
        initialProcessButton.textContent = "Carregando bibliotecas...";
    }
    displayLogMessage("Carregando bibliotecas, aguarde...");

    // Carrega as bibliotecas em sequência para garantir dependências
    loadScript(pdfjsLibBuildUrl, () => {
        console.log("pdf.js carregado.");
        if (typeof pdfjsLib === 'undefined') {
             console.error("pdfjsLib não está definido após carregar o script.");
             displayLogMessage("Erro crítico ao carregar pdf.js. Recarregue a página.");
             return;
        }
        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

        loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js", () => {
            console.log("jsPDF carregado.");
             if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF === 'undefined') {
                 console.error("jsPDF não está definido corretamente após carregar o script.");
                 displayLogMessage("Erro crítico ao carregar jsPDF. Recarregue a página.");
                 return;
             }
            jsPDF = window.jspdf.jsPDF; // Atribui a instância carregada

            // Carrega Tesseract por último
            loadScript(tesseractUrl + '/dist/tesseract.min.js', () => {
                console.log("Tesseract.js carregado.");
                 if (typeof window.Tesseract === 'undefined') {
                     console.error("Tesseract não está definido após carregar o script.");
                     displayLogMessage("Erro crítico ao carregar Tesseract.js (OCR). Recarregue a página.");
                     return;
                 }
                Tesseract = window.Tesseract; // Atribui a instância

                // Habilita o botão e associa a função de processamento APÓS TUDO carregar
                if (initialProcessButton) {
                    initialProcessButton.addEventListener("click", processarPdf);
                    initialProcessButton.disabled = false; // Habilita o botão
                    initialProcessButton.textContent = "Processar PDF"; // Restaura texto original
                    displayLogMessage("Pronto para processar. Selecione um PDF.");
                } else {
                    console.error("Botão 'processarPDF' não encontrado no DOM após carregamento.");
                }
            });
        });
    });
});