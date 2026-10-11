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

// URL da biblioteca PDF.js (CDN)
const pdfjsLibUrl = "/vendor/pdfjs/3.11.174/pdf.min.js";

// Carrega PDF.js e inicializa lógica principal
loadScript(pdfjsLibUrl, () => {
    console.log("PDF.js carregado dinamicamente.");

    // Define worker do PDF.js
    pdfjsLib.GlobalWorkerOptions.workerSrc = `/vendor/pdfjs/3.11.174/pdf.worker.min.js`;

    const fileInput = document.getElementById('pdfUpload');
    const convertPdfButton = document.getElementById('convertPdf');
    const logMessages = document.getElementById('log-messages');
    const thumbnailsContainer = document.getElementById('thumbnails-container');
    const jpgDownloadContainer = document.getElementById('jpg-download-container');
    const fileSelectedName = document.getElementById('file-selected-name');

    // Log de status para UI e console
    function displayLogMessage(message) {
        logMessages.textContent = message;
        console.log(message);
    }

    // Limpa áreas de visualização/download
    function clearPreviousResults() {
        thumbnailsContainer.innerHTML = '';
        jpgDownloadContainer.innerHTML = '';
    }

    // Seleção de arquivo PDF
    fileInput.addEventListener('change', function () {
        clearPreviousResults();
        const file = fileInput.files[0];
        if (file) {
            fileSelectedName.textContent = `Arquivo selecionado: ${file.name}`;
            logMessages.textContent = 'Pronto para converter. Clique no botão "Converter para JPG".';
        } else {
            fileSelectedName.textContent = 'Nenhum arquivo selecionado';
            logMessages.textContent = 'Pronto para processar. Selecione um arquivo PDF.';
        }
    });

    // Conversão PDF → JPG
    convertPdfButton.addEventListener('click', async function () {
        const file = fileInput.files[0];

        if (!file || file.type !== 'application/pdf') {
            notifyUser('Selecione um arquivo PDF para continuar.', 'warning');
            return;
        }

        clearPreviousResults();
        displayLogMessage('Iniciando a conversão do PDF...');
        convertPdfButton.disabled = true;

        try {
            const reader = new FileReader();
            reader.onload = async function (event) {
                const pdfData = new Uint8Array(event.target.result);
                const pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;

                displayLogMessage(`PDF carregado. Número de páginas: ${pdfDoc.numPages}`);

                for (let i = 1; i <= pdfDoc.numPages; i++) {
                    displayLogMessage(`Convertendo página ${i} de ${pdfDoc.numPages}...`);

                    const page = await pdfDoc.getPage(i);
                    const scale = 4; // Escala para qualidade
                    const viewport = page.getViewport({ scale });

                    // Canvas para renderizar página
                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;

                    // Renderiza página no canvas
                    const renderContext = {
                        canvasContext: context,
                        viewport: viewport
                    };
                    await page.render(renderContext).promise;

                    // Canvas → JPG
                    const jpgUrl = canvas.toDataURL('image/jpeg', 1.0); // 1.0 é a qualidade máxima

                    // Miniatura JPG
                    const img = document.createElement('img');
                    img.src = jpgUrl;
                    thumbnailsContainer.appendChild(img);

                    // Link de download JPG
                    const downloadLink = document.createElement('a');
                    downloadLink.href = jpgUrl;
                    downloadLink.download = `pagina_${i}.jpg`;
                    downloadLink.textContent = `Baixar Página ${i} (JPG)`;
                    downloadLink.classList.add('custom-download-link');

                    const downloadCard = document.createElement('div');
                    downloadCard.classList.add('custom-download-card');
                    downloadCard.appendChild(downloadLink);
                    jpgDownloadContainer.appendChild(downloadCard);
                }

                notifyUser('Processamento concluído. Arquivos prontos para download.', 'success');
                jpgDownloadContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });

            };

            reader.onerror = function (error) {
                console.error('Erro ao ler o arquivo PDF:', error);
                notifyUser('Não foi possível ler o arquivo PDF selecionado.', 'error');
            };

            reader.readAsArrayBuffer(file);

        } catch (error) {
            console.error('Erro ao converter PDF para JPG:', error);
            notifyUser(`Não foi possível concluir a conversão do PDF: ${error.message || 'erro desconhecido'}`, 'error');
        } finally {
            convertPdfButton.disabled = false;
        }
    });

}, 'pdfjs-lib-script');