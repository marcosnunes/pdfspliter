import * as pdfjsLib from 'pdfjs-dist';

async function splitPDF() {
    const pdfUpload = document.getElementById('pdfUpload');
    const linksDiv = document.getElementById('links');
    const file = pdfUpload.files[0];

    if (!file) {
        alert('Por favor, selecione um arquivo PDF.');
        return;
    }

    const fileReader = new FileReader();

    fileReader.onload = async function() {
        const typedArray = new Uint8Array(this.result);

        try {
            // Define o caminho para o worker do PDF.js (necessário)
            pdfjsLib.GlobalWorkerOptions.workerSrc =
              'node_modules/pdfjs-dist/build/pdf.worker.js';

            const pdf = await pdfjsLib.getDocument(typedArray).promise;
            linksDiv.innerHTML = '';

            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const pageContent = await page.getTextContent();
                const textContent = pageContent.items.map(s => s.str).join(' ');

                // Extrai o nome do prestador
                const nomePrestador = extractPrestadorName(textContent);

                // Cria o link para download
                const link = document.createElement('a');
                link.href = URL.createObjectURL(new Blob([typedArray.subarray(0, typedArray.length)], { type: 'application/pdf' }));
                link.download = `${nomePrestador}.pdf`;
                link.innerText = `Download Página ${i} (${nomePrestador}.pdf)`;
                linksDiv.appendChild(link);
                linksDiv.appendChild(document.createElement('br'));
            }
        } catch (error) {
            console.error('Erro ao processar o PDF:', error);
            alert('Erro ao processar o PDF. Verifique o console para mais detalhes.');
        }
    };

    fileReader.readAsArrayBuffer(file);
}

function extractPrestadorName(text) {
    // Lógica para extrair o nome do prestador

    let nomeMatch = text.match(/Prestador:\s*([A-Za-z\s]+)/i);
    let nome = nomeMatch ? nomeMatch[1].trim() : null;

    if (!nome) {
        nomeMatch = text.match(/Nome:\s*([A-Za-z\s]+)/i);
        nome = nomeMatch ? nomeMatch[1].trim() : null;
    }

    return nome || 'Nome_Não_Encontrado';
}

// Adicione esta linha para garantir que a função seja chamada no contexto correto
window.splitPDF = splitPDF;