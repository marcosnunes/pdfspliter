import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';

async function splitPDF() {
    try {
        const pdfUpload = document.getElementById('pdfUpload');
        const linksDiv = document.getElementById('links');
        const file = pdfUpload.files[0];

        if (!file) {
            alert('Por favor, selecione um arquivo PDF.');
            return;
        }

        await processPDF(file, linksDiv);

    } catch (error) {
        console.error("Erro ao executar splitPDF:", error);
        alert("Ocorreu um erro ao processar o PDF. Verifique o console.");
    }
}

async function processPDF(file, linksDiv) {
    try {
        const fileReader = new FileReader();

        fileReader.onload = async function() {
            try {
                pdfjsLib.GlobalWorkerOptions.workerSrc = 'dist/pdf.worker.js';
                console.log('PDF.js worker source:', pdfjsLib.GlobalWorkerOptions.workerSrc);

                const originalArrayBuffer = this.result; // ArrayBuffer

                const originalArray = new Uint8Array(originalArrayBuffer); // Uint8Array para pdfjsLib

                const pdfDocProxy = await pdfjsLib.getDocument(originalArray).promise;

                if (!pdfDocProxy || typeof pdfDocProxy.numPages !== 'number') {
                    console.error('Falha ao carregar o documento PDF.');
                    linksDiv.innerHTML = '<p style="color: red;">Falha ao carregar o documento PDF.</p>';
                    return;
                }

                console.log('PDF carregado com sucesso:', pdfDocProxy);
                linksDiv.innerHTML = '';

                let hasErrors = false;

                for (let i = 1; i <= pdfDocProxy.numPages; i++) {
                    try {
                        const page = await pdfDocProxy.getPage(i);

                        if (!page) {
                            console.warn(`Não foi possível obter a página ${i}.`);
                            linksDiv.innerHTML += `<p style="color: red;">Erro ao obter página ${i}.</p>`;
                            hasErrors = true;
                            continue;
                        }

                        const pageContent = await page.getTextContent();

                        if (!pageContent || !pageContent.items) {
                            console.warn(`Não foi possível obter o conteúdo da página ${i}.`);
                            linksDiv.innerHTML += `<p style="color: red;">Erro ao obter conteúdo da página ${i}.</p>`;
                            hasErrors = true;
                            continue;
                        }

                        let nomePrestador = extractPrestadorName(pageContent.items);
                        console.log(`Nome do prestador extraído da página ${i}:`, nomePrestador);

                        if (!nomePrestador) {
                            nomePrestador = 'Nome_Não_Encontrado';
                        }

                        // Copia o ArrayBuffer antes de passá-lo para createSinglePagePDF
                        const arrayBufferCopy = originalArrayBuffer.slice(0);
                        const pdfBytes = await createSinglePagePDF(arrayBufferCopy, i);

                        if (pdfBytes) {
                            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                            const link = document.createElement('a');
                            link.href = URL.createObjectURL(blob);
                            link.download = `${nomePrestador}.pdf`;
                            link.innerText = `Download Página ${i} (${nomePrestador}.pdf)`;
                            linksDiv.appendChild(link);
                            linksDiv.appendChild(document.createElement('br'));
                        } else {
                            linksDiv.innerHTML += `<p style="color: red;">Erro ao criar PDF para a página ${i}.</p>`;
                            hasErrors = true;
                        }

                    } catch (pageError) {
                        console.error(`Erro ao processar a página ${i}:`, pageError);
                        linksDiv.innerHTML += `<p style="color: red;">Erro ao processar a página ${i}. Veja o console.</p>`;
                        hasErrors = true;
                    }
                }

                if (hasErrors) {
                    alert('Um ou mais erros ocorreram durante o processamento. Verifique o console para obter mais detalhes.');
                }

            } catch (error) {
                console.error('Erro ao processar o PDF:', error);
                alert('Erro ao processar o PDF. Verifique o console para obter mais detalhes.');
            }
        };

        fileReader.readAsArrayBuffer(file);
    }  catch (error) {
        console.error("Erro na função processPDF:", error);
        alert("Ocorreu um erro ao processar o PDF. Verifique o console.");
    }
}

async function createSinglePagePDF(originalArrayBuffer, pageNumber) {
    try {
        console.log("createSinglePagePDF chamada para a página:", pageNumber);
        console.log("ArrayBuffer recebido:", originalArrayBuffer);

        if (!originalArrayBuffer) {
            console.error("ArrayBuffer is null or undefined");
            return null;
        }

        if (!(originalArrayBuffer instanceof ArrayBuffer)) {
            console.error("originalArrayBuffer is not an ArrayBuffer");
            return null;
        }

        console.log("Tamanho do ArrayBuffer:", originalArrayBuffer.byteLength);

        try {
            // Crie uma cópia do ArrayBuffer como Uint8Array
            const uint8Array = new Uint8Array(originalArrayBuffer);
            const pdfDoc = await PDFDocument.load(uint8Array); // Carrega o documento original

            console.log("PDFDocument.load executado com sucesso");
            const newPdf = await PDFDocument.create();

            if (!newPdf) {
                console.warn('Falha ao criar um novo documento PDF.');
                return null;
            }

            const [copiedPage] = await newPdf.copyPages(pdfDoc, [pageNumber - 1]); // Copia a página do documento original

            if (!copiedPage || copiedPage.length === 0) {
                console.warn(`Não foi possível copiar a página ${pageNumber}.`);
                return null;
            }

            newPdf.addPage(copiedPage[0]);

            const pdfBytes = await newPdf.save();
            return pdfBytes;
        } catch (innerError) {
            console.error("Erro interno ao processar PDFDocument:", innerError);
            return null;
        }
    } catch (error) {
        console.error("Erro ao criar PDF de página única:", error);
        return null;
    }
}

function extractPrestadorName(items) {
    for (let i = 0; i < items.length; i++) {
        const item = items[i].str;
        const regex = /Prestador\s*de\s*Serviço:?\s*([A-Za-zÀ-ÿ\s]+)/i;
        const match = item.match(regex);

        if (match && match[1]) {
            return match[1].trim();
        }
    }

    console.warn("Nome do prestador não encontrado na página.");
    return 'Nome_Não_Encontrado';
}

window.splitPDF = splitPDF;