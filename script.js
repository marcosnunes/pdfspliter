// Função principal para processar o PDF
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

    let pdfJsDoc = null; // Declarar fora do try para poder usar no loop
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
            // Limpar e reativar botão no finally
            return; // Sai da função processarPdf
        }


        // --- Etapa 2: Carregar COMPLETAMENTE com pdf.js SÓ DEPOIS do pdf-lib ---
        const pdfjsBuffer = originalArrayBuffer.slice(0); // Nova cópia para pdf.js
        displayLogMessage("Carregando com pdf.js para extração/OCR...");
        try {
            // É crucial criar o Uint8Array aqui, a partir da cópia fresca
            const loadingTask = pdfjsLib.getDocument({
                data: new Uint8Array(pdfjsBuffer),
                // Opcional: Desabilitar o worker para teste (pode impactar performance)
                // worker: null
            });
            pdfJsDoc = await loadingTask.promise; // Espera terminar
            displayLogMessage("pdf.js carregado.");

            // Verificação de consistência (opcional mas útil)
            if (pdfJsDoc.numPages !== numPages) {
                console.warn(`Contagem de páginas diverge (após carregamento sequencial): pdf.js=${pdfJsDoc.numPages}, pdf-lib=${numPages}. Usando ${numPages} (da pdf-lib).`);
                // Pode ser necessário ajustar 'numPages' se a contagem do pdf.js for mais confiável em algum caso,
                // mas geralmente usar a contagem da primeira biblioteca que carregou com sucesso (pdf-lib) é seguro.
            }
        } catch (pdfjsError) {
            console.error("Erro ao carregar com pdf.js:", pdfjsError);
            // Decide se quer continuar sem pdf.js (sem OCR/extração de texto via pdf.js)
            // ou se é um erro fatal. Por agora, vamos avisar e tentar continuar
            // só com pdf-lib, mas a extração de nome vai falhar.
            displayLogMessage(`Aviso: Erro ao carregar com pdf.js (${pdfjsError.message}). Extração de nome e OCR podem falhar.`);
            // pdfJsDoc permanecerá null. A função processarPagina precisa lidar com isso.
             // Se pdf.js for essencial, pode ser melhor tratar como erro fatal:
             // throw new Error(`Falha ao carregar PDF com pdf.js: ${pdfjsError.message}`);
        }

        // --- Etapa 3: Processamento das páginas ---
        if (!pdfLibDoc) {
             throw new Error("Documento pdf-lib não foi carregado. Impossível processar páginas.");
        }
        // pdfJsDoc pode ser null se o carregamento falhou mas decidimos continuar

        displayLogMessage(`Iniciando processamento das ${numPages} páginas...`);

        let processingPromises = [];
        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
            // Passa os documentos (pdfJsDoc pode ser null)
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
        // Log mais detalhado para o erro específico
        if (error instanceof TypeError && error.message.includes('detached ArrayBuffer')) {
             console.error("DETAILED STACK TRACE (DETACHED BUFFER):", error.stack);
             displayLogMessage("Erro crítico: Ocorreu um problema de acesso aos dados do PDF (detached ArrayBuffer) mesmo com carregamento sequencial. Verifique o console.");
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

// --- Modificação necessária em processarPagina para lidar com pdfJsDoc == null ---

async function processarPagina(pdfJsDoc, pdfLibDoc, pageNum, pageIndex, totalPages) {
    let nomeIdentificado = null;
    let canvas = null;

    try {
        // --- PARTE 1: Extração de Nome (APENAS SE pdfJsDoc ESTIVER DISPONÍVEL) ---
        if (pdfJsDoc) {
            displayLogMessage(`Processando página ${pageNum}/${totalPages}... (Extraindo nome com pdf.js)`);
            const page = await pdfJsDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale: 1.5 });

            canvas = document.createElement("canvas");
            const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const renderContext = { canvasContext: context, viewport: viewport };

            let textoExtraido = null;
            let ocrRealizado = false;

            try {
                const textContent = await page.getTextContent();
                textoExtraido = textContent.items.map(item => item.str).join('\n');
                const info = extractNameInfo(textoExtraido, pageNum);
                nomeIdentificado = info.nome;
                const textoDiretoCurto = textoExtraido.replace(/\s/g, '').length < 150;

                if ((!nomeIdentificado || textoDiretoCurto) && Tesseract) {
                    displayLogMessage(`Texto direto curto ou nome não encontrado na pág ${pageNum}. Tentando OCR...`);
                    await page.render(renderContext).promise;
                    displayLogMessage(`Página ${pageNum}/${totalPages} renderizada para OCR.`);
                    ocrRealizado = true;
                    // ... (lógica OCR como antes) ...
                    let worker = null;
                     try {
                         worker = await Tesseract.createWorker('por', 1, { /* logger */ });
                         const { data: { text: ocrText } } = await worker.recognize(canvas);
                         textoExtraido = ocrText;
                         displayLogMessage(`OCR Pág ${pageNum} concluído. Re-extraindo nome...`);
                         const infoOcr = extractNameInfo(textoExtraido, pageNum, true);
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
                if (Tesseract) {
                    try {
                        await page.render(renderContext).promise;
                        displayLogMessage(`Página ${pageNum}/${totalPages} renderizada para OCR (fallback).`);
                        ocrRealizado = true;
                         // ... (lógica OCR fallback como antes) ...
                         let worker = null;
                         try {
                             worker = await Tesseract.createWorker('por', 1, { /* logger */ });
                             const { data: { text: ocrText } } = await worker.recognize(canvas);
                             textoExtraido = ocrText;
                             displayLogMessage(`OCR Pág ${pageNum} concluído (fallback). Re-extraindo nome...`);
                             const infoOcr = extractNameInfo(textoExtraido, pageNum, true);
                             nomeIdentificado = infoOcr.nome;
                         } catch (ocrErrorFallback) {
                             console.error(`Erro durante OCR (fallback) na página ${pageNum}:`, ocrErrorFallback);
                             displayLogMessage(`Erro no OCR (fallback) da página ${pageNum}.`);
                         } finally {
                             if (worker) await worker.terminate();
                         }
                    } catch (renderError) {
                        console.error(`Erro ao renderizar página ${pageNum} para OCR (fallback):`, renderError);
                        displayLogMessage(`Erro ao renderizar Pág ${pageNum} para OCR.`);
                    }
                } else {
                   displayLogMessage(`Tesseract não disponível para OCR na Pág ${pageNum}.`);
                }
            }
        } else {
            // Se pdfJsDoc não carregou, não podemos extrair nome
            displayLogMessage(`Aviso: pdf.js não carregado para pág ${pageNum}. Usando nome padrão.`);
            nomeIdentificado = null; // Garante que usará o nome padrão
        }

        // Define o nome final (MESMO SE pdf.js FALHOU)
        const finalNameUpper = (nomeIdentificado || `Pagina_${pageNum}`).toUpperCase();
        const safeFileName = finalNameUpper.replace(/[/\\?%*:|"<>]/g, '_').replace(/\s+/g, '_');
        const downloadFileName = `${safeFileName}.pdf`;

        displayLogMessage(`Nome para pág ${pageNum}: ${nomeIdentificado || 'Padrão'}. Gerando PDF selecionável...`);

        // --- PARTE 2: Criação do PDF com pdf-lib (INDEPENDENTE do pdf.js) ---
        const newPdfDoc = await PDFLib.PDFDocument.create();
        const [copiedPage] = await newPdfDoc.copyPages(pdfLibDoc, [pageIndex]);
        newPdfDoc.addPage(copiedPage);

        const pdfBytes = await newPdfDoc.save();
        const pdfDataUri = URL.createObjectURL(new Blob([pdfBytes], { type: 'application/pdf' }));

        // Cria o link de download
        const downloadLink = document.createElement("a");
        downloadLink.href = pdfDataUri;
        downloadLink.download = downloadFileName;
        downloadLink.textContent = `Página ${pageNum}${nomeIdentificado ? ` (${finalNameUpper})` : ''}`;
        downloadLink.target = "_blank";

        const pageItem = document.createElement("div");
        pageItem.classList.add("custom-pdf-page-item");
        pageItem.appendChild(downloadLink);

        return { pageNum: pageNum, element: pageItem };

    } catch (error) {
        console.error(`Erro fatal ao processar a página ${pageNum}:`, error);
        // Adiciona log específico se for erro de pdf-lib ao copiar/salvar
        if (error.message.includes('PDFDocument') || error.message.includes('copyPages') || error.message.includes('save')) {
             displayLogMessage(`Erro crítico (pdf-lib) ao gerar PDF para pág ${pageNum}: ${error.message}`);
        } else {
             displayLogMessage(`Erro grave ao processar página ${pageNum}.`);
        }
        return { pageNum: pageNum, element: null };
    } finally {
        if (canvas) {
             canvas.width = 0;
             canvas.height = 0;
             canvas = null;
        }
    }
}