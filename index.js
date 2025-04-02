async function createSinglePagePDF(pdfDocProxy, pageNumber) {
  try {
      const newPdf = await PDFDocument.create();

      if (!newPdf) {
          console.warn('Falha ao criar um novo documento PDF.');
          return null;
      }

      // Obter os bytes da página do PDF original
      const page = await pdfDocProxy.getPage(pageNumber);
      const originalPageBytes = await pdfDocProxy.getData();
      const originalPdf = await PDFDocument.load(originalPageBytes);

      const [copiedPage] = await newPdf.copyPages(originalPdf, [pageNumber - 1]);


      if (!copiedPage) {
          console.warn(`Não foi possível copiar a página ${pageNumber}.`);
          return null;
      }

      newPdf.addPage(copiedPage);

      const pdfBytes = await newPdf.save();
      return pdfBytes;
  } catch (error) {
      console.error("Erro ao criar PDF de página única:", error);
      return null;
  }
}