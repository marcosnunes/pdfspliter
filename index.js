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

    const fileReader = new FileReader();

    fileReader.onload = async function() {
      try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'dist/pdf.worker.js';
        console.log('PDF.js worker source:', pdfjsLib.GlobalWorkerOptions.workerSrc);

        const originalArray = new Uint8Array(this.result);
        const pdfDoc = await pdfjsLib.getDocument(originalArray).promise;
        console.log('PDF carregado com sucesso:', pdfDoc);
        linksDiv.innerHTML = '';

        for (let i = 1; i <= pdfDoc.numPages; i++) {
          try {
            const page = await pdfDoc.getPage(i);
            const pageContent = await page.getTextContent();
            const textContent = pageContent.items.map(s => s.str).join(' ');
            console.log(`Texto da página ${i}:`, textContent);

            let nomePrestador = extractPrestadorName(textContent);
            console.log(`Nome do prestador extraído da página ${i}:`, nomePrestador);

            if (!nomePrestador) {
              nomePrestador = 'Nome_Não_Encontrado'; // Use um valor padrão
            }

            // Cria um novo PDF contendo apenas a página atual
            const pdfBytes = await createSinglePagePDF(pdfDoc, i); // Passando pdfDoc primeiro
            console.log('pdfBytes:', pdfBytes);

            if (pdfBytes) {  // Verifique se pdfBytes não é nulo
              const blob = new Blob([pdfBytes], { type: 'application/pdf' });
              const link = document.createElement('a');
              link.href = URL.createObjectURL(blob);
              link.download = `${nomePrestador}.pdf`;
              link.innerText = `Download Página ${i} (${nomePrestador}.pdf)`;
              linksDiv.appendChild(link);
              linksDiv.appendChild(document.createElement('br'));
            } else {
              linksDiv.innerHTML += `<p style="color: red;">Erro ao criar PDF para a página ${i}.</p>`;
            }

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
async function createSinglePagePDF(pdfDoc, pageNumber) { // pdfDoc primeiro
  try {
    const newPdf = await PDFDocument.create();
    const [copiedPages] = await newPdf.copyPages(pdfDoc, [pageNumber - 1]);

    if (!copiedPages) {
      console.warn(`Não foi possível copiar a página ${pageNumber}.`);
      return null;  // Retorna null se a cópia falhar
    }

    newPdf.addPage(copiedPages);

    const pdfBytes = await newPdf.save();
    return pdfBytes;
  } catch (error) {
    console.error("Erro ao criar PDF de página única:", error);
    return null; // Retorna null em caso de erro
  }
}

function extractPrestadorName(text) {
  let nomeMatch = text.match(/(Prestador|Nome)\s*de\s*serviço:?\s*(.*)/i);
  console.log("nomeMatch:", nomeMatch);

  let nome = nomeMatch ? nomeMatch[2].trim() : null;

  if (!nome) {
    console.warn("Nome do prestador não encontrado na página. Usando 'Nome_Não_Encontrado'. Texto da página:", text);
    return 'Nome_Não_Encontrado';
  }

  return nome;
}

window.splitPDF = splitPDF;