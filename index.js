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

        // Usando uma função async para ler o arquivo e obter o ArrayBuffer
        const originalArrayBuffer = await readFileAsArrayBuffer(file);

        if (!originalArrayBuffer) {
            console.error("Falha ao ler o arquivo como ArrayBuffer.");
            alert("Falha ao ler o arquivo PDF.");
            return;
        }

        console.log("ArrayBuffer após a leitura do arquivo:", originalArrayBuffer);
        console.log("Tamanho do ArrayBuffer após a leitura do arquivo:", originalArrayBuffer.byteLength);

        const pdfDocProxy = await pdfjsLib.getDocument(new Uint8Array(originalArrayBuffer)).promise;

        if (!pdfDocProxy || typeof pdfDocProxy.numPages !== 'number') {
            console.error('Falha ao carregar o documento PDF.');
            linksDiv.innerHTML = '<p style="color: red;">Falha ao carregar o documento PDF.</p>';
            return;
        }

        console.log('PDF carregado com sucesso:', pdfDocProxy);
        linksDiv.innerHTML = '';

        let hasErrors = false; // Variável para rastrear erros gerais

        for (let i = 1; i <= pdfDocProxy.numPages; i++) {
            try {
                const page = await pdfDocProxy.getPage(i);

                if (!page) {
                    console.warn(`Não foi possível obter a página ${i}.`);
                    linksDiv.innerHTML += `<p style="color: red;">Erro ao obter página ${i}.</p>`;
                    hasErrors = true; // Registra um erro na página
                    continue; // Ir para a próxima iteração
                }

                const pageContent = await page.getTextContent();

                if (!pageContent || !pageContent.items) {
                    console.warn(`Não foi possível obter o conteúdo da página ${i}.`);
                    linksDiv.innerHTML += `<p style="color: red;">Erro ao obter conteúdo da página ${i}.</p>`;
                    hasErrors = true; // Registra um erro na página
                    continue; // Ir para a próxima iteração
                }

                // Passar o array de items para a função extractPrestadorName
                let nomePrestador = extractPrestadorName(pageContent.items);
                console.log(`Nome do prestador extraído da página ${i}:`, nomePrestador);

                if (!nomePrestador) {
                    nomePrestador = 'Nome_Não_Encontrado';
                }

                const pdfBytes = await createSinglePagePDF(originalArrayBuffer, i);

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
                    hasErrors = true; // Registra um erro na página
                }

            } catch (pageError) {
                console.error(`Erro ao processar a página ${i}:`, pageError);
                linksDiv.innerHTML += `<p style="color: red;">Erro ao processar a página ${i}. Veja o console.</p>`;
                hasErrors = true; // Registra um erro na página
            }
        }

        if (hasErrors) {
            alert('Um ou mais erros ocorreram durante o processamento. Verifique o console para obter mais detalhes.');
        }

    } catch (error) {
        console.error('Erro ao processar o PDF:', error);
        alert('Erro ao processar o PDF. Verifique o console para obter mais detalhes.');
    }
}

async function createSinglePagePDF(originalArrayBuffer, pageNumber) {
    try {
        // Crie uma cópia do ArrayBuffer dentro da função
        const arrayBufferCopy = originalArrayBuffer.slice(0);
        const uint8Array = new Uint8Array(arrayBufferCopy);

        const pdfDoc = await PDFDocument.load(uint8Array);

        const newPdf = await PDFDocument.create();

        const [copiedPage] = await newPdf.copyPages(pdfDoc, [pageNumber - 1]);

        newPdf.addPage(copiedPage[0]);

        const pdfBytes = await newPdf.save();
        return pdfBytes;
    } catch (error) {
        console.error("Erro ao criar PDF de página única:", error);
        return null;
    }
}
// Função auxiliar para ler o arquivo como ArrayBuffer usando FileReader e Promise
function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = function(event) {
            resolve(event.target.result);
        };

        reader.onerror = function(error) {
            console.error("Erro ao ler o arquivo:", error);
            reject(error);
        };

        reader.readAsArrayBuffer(file);
    });
}

// A função extractPrestadorName agora recebe o array de items
function extractPrestadorName(items) {
    for (let i = 0; i < items.length; i++) {
        const item = items[i].str;
        const regex = /Prestador\sde\sserviço:\s*([A-Za-zÀ-ÿ\s]+)/i;
        const match = item.match(regex);

        if (match && match[1]) {
            return match[1].trim();
        }
    }

    console.warn("Nome do prestador não encontrado na página.");
    return 'Nome_Não_Encontrado';
}

window.splitPDF = splitPDF;