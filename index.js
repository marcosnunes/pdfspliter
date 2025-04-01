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

        if (!pdfDoc || typeof pdfDoc.numPages !== 'number') {
          console.error('Falha ao carregar o documento PDF.');
          linksDiv.innerHTML = '<p style="color: red;">Falha ao carregar o documento PDF.</p>';
          return;
        }

        console.log('PDF carregado com sucesso:', pdfDoc);
        linksDiv.innerHTML = '';

        let hasErrors = false; // Variável para rastrear erros gerais

        for (let i = 1; i <= pdfDoc.numPages; i++) {
          try {
            const page = await pdfDoc.getPage(i);

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

            let nomePrestador = extractPrestadorName(pageContent.items.map(s => s.str).join(' '));
            console.log(`Nome do prestador extraído da página ${i}:`, nomePrestador);

            if (!nomePrestador) {
              nomePrestador = 'Nome_Não_Encontrado';
            }

            // Cria um novo PDF contendo apenas a página atual
            const pdfBytes = await createSinglePagePDF(pdfDoc, i);

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
async function createSinglePagePDF(pdfDoc, pageNumber) {
  try {
    const newPdf = await PDFDocument.create();

    if (!newPdf) {
      console.warn('Falha ao criar um novo documento PDF.');
      return null;
    }

    const [copiedPages] = await newPdf.copyPages(pdfDoc, [pageNumber - 1]);

    if (!copiedPages || copiedPages.length === 0) {
      console.warn(`Não foi possível copiar a página ${pageNumber}.`);
      return null;
    }

    newPdf.addPage(copiedPages);

    const pdfBytes = await newPdf.save();
    return pdfBytes;
  } catch (error) {
    console.error("Erro ao criar PDF de página única:", error);
    return null;
  }
}

function extractPrestadorName(text) {
  const nomeMatch = text.match(/(Prestador|Nome)\s+de\s+serviço:?\s*([A-Za-zÀ-ÿ\s]+)/i);

  if (nomeMatch && nomeMatch[2]) {
    return nomeMatch[2].trim();
  } else {
    console.warn("Nome do prestador não encontrado na página. Usando 'Nome_Não_Encontrado'. Texto da página:", text);
    return 'Nome_Não_Encontrado';
  }
}

window.splitPDF = splitPDF;