function openNav() {
    const sidenav = document.getElementById('mySidenav');
    if (sidenav) sidenav.style.width = '250px';
}

function closeNav() {
    const sidenav = document.getElementById('mySidenav');
    if (sidenav) sidenav.style.width = '0';
}

function notifyUser(message, type = 'info') {
    const logMessages = document.getElementById('log-messages');
    const prefix = type === 'error' ? '❌' : (type === 'warning' ? '⚠️' : '✅');
    const text = `${prefix} ${String(message || '').trim()}`;
    if (logMessages) logMessages.textContent = text;
    if (type === 'error') console.error(text);
    else console.log(text);
}

// Carrega scripts dinamicamente (evita duplicidade)
function loadScript(url, callback, id = null) {
    // Evita carregar script duplicado
    if (id && document.getElementById(id)) {
        console.log(`Script "${id}" já carregado.`);
        if (callback) callback();
        return;
    }

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = url;

    if (id) {
        script.id = id;
    }

    script.onload = () => {
        console.log(`Script carregado: ${url}`);
        if (callback) callback();
    };

    script.onerror = () => {
        console.error(`Erro ao carregar o script: ${url}`);
        notifyUser(`Não foi possível carregar a biblioteca (${url}). Verifique a conexão e tente novamente.`, 'error');
    };

    document.head.appendChild(script);
}

// URL do PDFLib (CDN)
const pdfLibUrl = "/vendor/pdf-lib/pdf-lib.min.js";

// Carrega PDFLib e inicializa lógica principal
loadScript(pdfLibUrl, () => {
    console.log("PDFLib carregado dinamicamente.");

    // Lógica principal (fora do DOMContentLoaded)
    const fileInput = document.getElementById('pdfUpload');
    const mergePdfButton = document.getElementById('mergePdf');
    const logMessages = document.getElementById('log-messages');
    const pdfDownloadContainer = document.getElementById('pdf-download-container');
    const fileSelectedName = document.getElementById('file-selected-name');

    // Log de status para UI e console
    function displayLogMessage(message) {
        logMessages.textContent = message;
        console.log(message);
    }

    // Seleção de arquivos PDF
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

    // Estilo do botão
    mergePdfButton.classList.add('button1');

    mergePdfButton.addEventListener('click', async function () {
        const files = fileInput.files;

        if (!files || files.length === 0) {
            notifyUser('Selecione pelo menos um arquivo PDF para continuar.', 'warning');
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

                // Link de download PDF
                let downloadLink = document.createElement('a');
                downloadLink.href = pdfUrl;
                downloadLink.download = 'PDF Unificado.pdf';
                downloadLink.textContent = 'Baixar PDF Unificado';
                downloadLink.classList.add('custom-download-link');

                const downloadCard = document.createElement('div');
                downloadCard.classList.add('custom-download-card');
                downloadCard.appendChild(downloadLink);

                // Limpa container e adiciona link
                pdfDownloadContainer.innerHTML = '';
                pdfDownloadContainer.appendChild(downloadCard);

                // Foco na área do link
                downloadLink.scrollIntoView({ behavior: 'smooth', block: 'start' });
                notifyUser('Processamento concluído. Arquivo pronto para download.', 'success');

            } catch (saveError) {
                console.error('Erro ao salvar o PDF unificado:', saveError);
                notifyUser('Não foi possível salvar o PDF unificado.', 'error');
            }

        } catch (error) {
            notifyUser(`Não foi possível concluir a união dos PDFs: ${error.message || 'erro desconhecido'}`, 'error');
        }
    });

}, 'pdf-lib-script'); // Adiciona um ID para evitar carregamento duplicado