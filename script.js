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

    try {
        // 1. Ler o arquivo UMA VEZ como ArrayBuffer
        const originalArrayBuffer = await readFileAsync(file);
        displayLogMessage("Arquivo lido. Carregando PDF...");

        // 2. Criar CÓPIAS do ArrayBuffer para cada biblioteca/operação
        const pdfjsBuffer = originalArrayBuffer.slice(0); // Cria uma cópia para pdf.js
        const pdfLibBuffer = originalArrayBuffer.slice(0); // Cria uma cópia para pdf-lib

        // 3. Carregar com pdf.js (usando sua cópia)
        //    É importante criar o Uint8Array A PARTIR DA CÓPIA
        const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfjsBuffer) });
        const pdfJsDoc = await loadingTask.promise;
        const numPages = pdfJsDoc.numPages;

        // 4. Carregar com pdf-lib (usando sua cópia)
        const pdfLibDoc = await PDFLib.PDFDocument.load(pdfLibBuffer);

        // Verifica se o número de páginas coincide (sanity check)
        if (numPages !== pdfLibDoc.getPageCount()) {
             console.warn(`Contagem de páginas diverge entre pdf.js (${numPages}) e pdf-lib (${pdfLibDoc.getPageCount()}). Usando contagem do pdf.js.`);
             // Poderia lançar um erro ou usar Math.min/max se preferir
        }

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
        // Verifica se o erro é o de ArrayBuffer destacado para dar uma mensagem mais útil
        if (error instanceof TypeError && error.message.includes('detached ArrayBuffer')) {
             displayLogMessage("Erro: Ocorreu um problema ao compartilhar dados do PDF entre bibliotecas. Tente recarregar a página ou usar um PDF diferente.");
             alert("Erro interno ao processar os dados do PDF. Por favor, recarregue a página e tente novamente.");
        } else {
             displayLogMessage(`Erro: ${error.message || 'Ocorreu um erro desconhecido durante o processamento.'}`);
             alert("Ocorreu um erro ao processar o PDF. Verifique o console para mais detalhes.");
        }
    } finally {
        processarPDFButton.textContent = "Processar PDF";
        processarPDFButton.disabled = false;
    }
}