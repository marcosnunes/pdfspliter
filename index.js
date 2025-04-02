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

        // Crie uma cópia do ArrayBuffer
        const arrayBufferCopy = originalArrayBuffer.slice(0);

        console.log("Tamanho da cópia do ArrayBuffer:", arrayBufferCopy.byteLength);

        // Chame createSinglePagePDF com a cópia do ArrayBuffer
        const pdfBytes = await createSinglePagePDF(arrayBufferCopy, 1); // Página 1 para teste

        if (pdfBytes) {
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = "pagina_teste.pdf";
            link.innerText = "Download Página de Teste";
            linksDiv.appendChild(link);
            linksDiv.appendChild(document.createElement('br'));
        } else {
            console.error("Falha ao criar o PDF da página.");
            alert("Falha ao criar o PDF da página.");
        }

    } catch (error) {
        console.error("Erro ao executar splitPDF:", error);
        alert("Ocorreu um erro ao processar o PDF. Verifique o console.");
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