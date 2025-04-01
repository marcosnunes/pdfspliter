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

        const fileReader = new FileReader();

        fileReader.onload = async function() {
            try {
                pdfjsLib.GlobalWorkerOptions.workerSrc = 'dist/pdf.worker.mjs'; // Caminho relativo (verifique se está correto)
                console.log('PDF.js worker source:', pdfjsLib.GlobalWorkerOptions.workerSrc); // Debug

                const originalArray = new Uint8Array(this.result);
                const pdf = await pdfjsLib.getDocument(originalArray).promise;
                console.log('PDF carregado com sucesso:', pdf); // Debug
                linksDiv.innerHTML = '';

                for (let i = 1; i <= pdf.numPages; i++) {
                    try {
                        const page = await pdf.getPage(i);
                        const pageContent = await page.getTextContent();
                        const textContent = pageContent.items.map(s => s.str).join(' ');
                        console.log(`Texto da página ${i}:`, textContent); // Debug

                        const nomePrestador = extractPrestadorName(textContent);
                        console.log(`Nome do prestador extraído da página ${i}:`, nomePrestador); // Debug

                        // Cria um novo PDF contendo apenas a página atual
                        const pdfBytes = await createSinglePagePDF(originalArray, i);
                        console.log('pdfBytes:', pdfBytes); // Verificando o conteúdo de pdfBytes

                        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                        const link = document.createElement('a');
                        link.href = URL.createObjectURL(blob);
                        link.download = `${nomePrestador}.pdf`;
                        link.innerText = `Download Página ${i} (${nomePrestador}.pdf)`;
                        linksDiv.appendChild(link);
                        linksDiv.appendChild(document.createElement('br'));

                    } catch (pageError) {
                        console.error(`Erro ao processar a página ${i}:`, pageError);
                        linksDiv.innerHTML += `<p style="color: red;">Erro ao processar a página ${i}. Veja o console.</p>`;
                    }
                }
            } catch (error) {
                console.error('Erro ao processar o PDF:', error);
                alert('Erro ao processar o PDF. Verifique o console para mais detalhes.');
            }
        };

        fileReader.readAsArrayBuffer(file);
    } catch (error) {
        console.error("Erro ao executar splitPDF:", error);
        alert("Ocorreu um erro ao processar o PDF. Verifique o console.");
    }
}

// Nova função para criar um PDF de uma única página
async function createSinglePagePDF(originalArray, pageNumber) {
    try {
        const pdfDoc = await pdfjsLib.getDocument(originalArray).promise;
        const newDoc = await pdfjsLib.getDocument({url: URL.createObjectURL(new Blob([originalArray], { type: 'application/pdf' }))}).promise;
        const [copiedPage] = await newDoc.copyPages(pdfDoc, [pageNumber - 1]);
        const newPdf = await pdfjsLib.PDFDocument.create();
        newPdf.addPage(copiedPage);
        const pdfBytes = await newPdf.save();
        return pdfBytes;
    } catch (error) {
        console.error("Erro ao criar PDF de página única:", error);
        throw error; // Re-lançar o erro para que ele seja capturado na função splitPDF
    }
}

function extractPrestadorName(text) {
    // Expressão regular mais flexível
    let nomeMatch = text.match(/(Prestador|Nome)\s*de\s*serviço:?\s*(.*)/i);
    console.log("nomeMatch:", nomeMatch); // Debug

    let nome = nomeMatch ? nomeMatch[2].trim() : null;

    if (!nome) {
        console.warn("Nome do prestador não encontrado na página. Usando 'Nome_Não_Encontrado'. Texto da página:", text);
        return 'Nome_Não_Encontrado';
    }

    return nome;
}

window.splitPDF = splitPDF;