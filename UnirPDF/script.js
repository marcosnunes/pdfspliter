/* Funções para controlar o Menu Lateral (Sidenav) */
function openNav() {
    document.getElementById("mySidenav").style.width = "250px";
}

function closeNav() {
    document.getElementById("mySidenav").style.width = "0";
}

// Função para carregar scripts dinamicamente
function loadScript(url, callback, id = null) {
    // Verifica se o script já existe pelo ID (se fornecido)
    if (id && document.getElementById(id)) {
        console.log(`Script "${id}" já carregado.`);
        if (callback) callback(); // Executa o callback se já carregado
        return;
    }

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = url;

    if (id) {
        script.id = id; // Define o ID para evitar duplicações
    }

    script.onload = () => {
        console.log(`Script carregado: ${url}`);
        if (callback) callback(); // Executa o callback após o carregamento
    };

    script.onerror = () => {
        console.error(`Erro ao carregar o script: ${url}`);
        alert(`Erro ao carregar a biblioteca: ${url}. Verifique a URL e tente novamente.`);
    };

    document.head.appendChild(script);
}

// Define a URL do PDFLib
const pdfLibUrl = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";

// Carrega o PDFLib dinamicamente e inicia o código principal
loadScript(pdfLibUrl, () => {
    console.log("PDFLib carregado dinamicamente.");

    // Código principal AQUI, fora do DOMContentLoaded
    const fileInput = document.getElementById('pdfUpload');
    const mergePdfButton = document.getElementById('mergePdf');
    const logMessages = document.getElementById('log-messages');
    const pdfDownloadContainer = document.getElementById('pdf-download-container'); // Container para o link
    const fileSelectedName = document.getElementById('file-selected-name'); // Span para o nome dos arquivos

    function displayLogMessage(message) {
        logMessages.textContent = message;
        console.log(message);
    }

    // Evento ao selecionar arquivos PDF
    fileInput.addEventListener('change', function () {
        const files = fileInput.files;
        displayLogMessage(`Arquivos selecionados: ${files.length}`);

        // Atualiza o nome dos arquivos selecionados
        if (files.length > 0) {
            fileSelectedName.textContent = `Arquivo(s) selecionado(s): ${files.length}`;
            logMessages.textContent = 'Pronto para processar. Clique em Unir PDFs.';  // Altera a mensagem de log
        } else {
            fileSelectedName.textContent = 'Nenhum arquivo selecionado';
            logMessages.textContent = 'Pronto para processar. Selecione arquivos PDF.'; // Restaura a mensagem inicial
        }
    });

    // Estilo do botão (garantido que seja aplicado)
    mergePdfButton.classList.add('button1');

    mergePdfButton.addEventListener('click', async function () {
        const files = fileInput.files;

        if (!files || files.length === 0) {
            alert('Por favor, selecione pelo menos um arquivo PDF.');
            return;
        }

        displayLogMessage('Iniciando união dos PDFs...');

        try {
            const mergedPdf = await PDFLib.PDFDocument.create();

            for (const file of files) {
                displayLogMessage(`Processando arquivo: ${file.name}`);
                try {
                    const pdfBytes = await file.arrayBuffer();
                    const pdfDoc = await PDFLib.PDFDocument.load(pdfBytes, { ignoreEncryption: true });
                    const copiedPages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());
                    copiedPages.forEach((page) => mergedPdf.addPage(page));
                    displayLogMessage(`Arquivo ${file.name} incorporado com sucesso.`);
                } catch (error) {
                    console.error(`Erro ao processar arquivo ${file.name}:`, error);
                    displayLogMessage(`Erro ao processar arquivo ${file.name}. Verifique o arquivo.`);
                }
            }

            displayLogMessage('PDFs unidos. Criando link para download...');

            try {
                const pdfBytes = await mergedPdf.save();
                const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
                const pdfUrl = URL.createObjectURL(pdfBlob);

                // Cria dinamicamente o link de download
                let downloadLink = document.createElement('a');
                downloadLink.href = pdfUrl;
                downloadLink.download = 'PDF Unificado.pdf';
                downloadLink.textContent = 'Baixar PDF Unificado'; // Texto do link
                downloadLink.classList.add('custom-download-link'); // Adiciona a classe para estilo

                // Limpa o conteúdo anterior e adiciona o link ao container de download
                pdfDownloadContainer.innerHTML = '';
                pdfDownloadContainer.appendChild(downloadLink);

                // Adiciona o foco para a área do link de download
                downloadLink.scrollIntoView({ behavior: 'smooth', block: 'start' });
                displayLogMessage('Pronto! Clique no link para baixar o PDF unificado.');

            } catch (saveError) {
                console.error('Erro ao salvar o PDF unificado:', saveError);
                displayLogMessage('Erro ao salvar o PDF unificado.');
            }

        } catch (error) {
            console.error('Erro ao unir PDFs:', error);
            displayLogMessage(`Erro ao unir PDFs: ${error.message || 'Erro desconhecido'}`);
            alert('Ocorreu um erro ao unir os PDFs. Veja o console para mais detalhes.');
        }
    });

}, 'pdf-lib-script'); // Adiciona um ID para evitar carregamento duplicado