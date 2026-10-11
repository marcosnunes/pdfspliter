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

    // Código principal AQUI, fora do DOMContentLoaded
    const fileInput = document.getElementById('imageUpload');
    const generatePdfButton = document.getElementById('generatePdf');
    const logMessages = document.getElementById('log-messages');
    const thumbnailsContainer = document.getElementById('thumbnails-container');
    const pdfDownloadContainer = document.getElementById('pdf-download-container');
    const fileSelectedName = document.getElementById('file-selected-name');

    // Log de status para UI e console
    function displayLogMessage(message) {
        logMessages.textContent = message;
        console.log(message);
    }

    // Exibe miniaturas das imagens
    function displayThumbnails(files) {
        thumbnailsContainer.innerHTML = '';
        for (const file of files) {
            if (!file.type.startsWith('image/')) {
                console.warn(`Arquivo ${file.name} ignorado: não é uma imagem.`);
                displayLogMessage(`Arquivo ${file.name} ignorado: não é uma imagem.`);
                continue;
            }

            const reader = new FileReader();
            reader.onload = function (e) {
                try {
                    const imageUrl = e.target.result;
                    const img = document.createElement('img');
                    img.src = imageUrl;
                    img.style.maxWidth = '100px';
                    img.style.maxHeight = '100px';
                    img.style.margin = '5px';
                    thumbnailsContainer.appendChild(img);
                } catch (error) {
                    console.error(`Erro ao exibir miniatura para ${file.name}:`, error);
                    displayLogMessage(`Erro ao exibir miniatura para ${file.name}.`);
                }
            }
            reader.onerror = function (error) {
                console.error(`Erro ao ler arquivo ${file.name}:`, error);
                displayLogMessage(`Erro ao ler arquivo ${file.name}.`);
            }
            reader.readAsDataURL(file);
        }
    }

    // Seleção de imagens
    fileInput.addEventListener('change', function () {
        const files = fileInput.files;
        displayLogMessage(`Imagens selecionadas: ${files.length}`);
        const sortedFilesForThumbs = Array.from(files).sort((a, b) => a.name.localeCompare(b.name));
        displayThumbnails(sortedFilesForThumbs);

        // Atualiza o nome dos arquivos selecionados
        if (files.length > 0) {
            fileSelectedName.textContent = `Arquivo(s) selecionado(s): ${files.length}`;
            logMessages.textContent = 'Pronto para processar. Clique em Gerar PDF.';  // Altera a mensagem de log
        } else {
            fileSelectedName.textContent = 'Nenhum arquivo selecionado';
            logMessages.textContent = 'Pronto para processar. Selecione uma imagem.'; // Restaura a mensagem inicial
        }
    });

    // Estilo do botão
    generatePdfButton.classList.add('button1');

    generatePdfButton.addEventListener('click', async function () {
        const files = fileInput.files;

        if (!files || files.length === 0) {
            notifyUser('Selecione pelo menos uma imagem para continuar.', 'warning');
            return;
        }

        displayLogMessage('Iniciando geração do PDF...');

        try {
            const pdfDoc = await PDFLib.PDFDocument.create();
            let pageCount = 0;

            const sortedFiles = Array.from(files).sort((a, b) => a.name.localeCompare(b.name));

            for (const file of files) {
                displayLogMessage(`Processando imagem: ${file.name}`);
                let image;
                try {
                    const imageBytes = await file.arrayBuffer();
                    displayLogMessage(`Tamanho da imagem ${file.name}: ${imageBytes.byteLength} bytes`);

                    if (file.type === 'image/jpeg' || file.type === 'image/jpg') {
                        image = await pdfDoc.embedJpg(imageBytes);
                    } else if (file.type === 'image/png') {
                        image = await pdfDoc.embedPng(imageBytes);
                    } else {
                        displayLogMessage(`Arquivo ${file.name} ignorado: tipo não suportado.`);
                        continue;
                    }
                    displayLogMessage(`Imagem ${file.name} incorporada com sucesso.`);

                    // Log do objeto image (debug)
                    console.log(`Objeto image para ${file.name}:`, image);

                } catch (imageError) {
                    console.error(`Erro ao processar imagem ${file.name}:`, imageError);
                    displayLogMessage(`Erro ao processar imagem ${file.name}. Verifique o arquivo.`);
                    continue;
                }

                try {
                    // Verificação: garante que a imagem foi incorporada
                    if (!image) {
                        console.error(`Imagem ${file.name} não foi incorporada corretamente.`);
                        displayLogMessage(`Erro: Imagem ${file.name} não foi incorporada corretamente.`);
                        continue;
                    }

                    // Garante ao menos uma página
                    let page = pdfDoc.addPage();
                    // Usa width/height do objeto image
                    const width = image.width;
                    const height = image.height;

                    // Ajusta tamanho da imagem para caber
                    const pageWidth = page.getWidth() - 40;
                    const pageHeight = page.getHeight() - 40;

                    const scale = Math.min(pageWidth / width, pageHeight / height);
                    const scaledWidth = width * scale;
                    const scaledHeight = height * scale;


                    page.drawImage(image, {
                        x: (page.getWidth() - scaledWidth) / 2,
                        y: (page.getHeight() - scaledHeight) / 2,
                        width: scaledWidth,
                        height: scaledHeight,
                    });
                    pageCount++;
                } catch (drawError) {
                    console.error(`Erro ao adicionar imagem à página ${file.name}:`, drawError);
                    displayLogMessage(`Erro ao adicionar imagem à página ${file.name}.`);
                }
            }

            if (pageCount === 0) {
                displayLogMessage('Nenhuma página foi adicionada ao PDF. Verifique as imagens.');
                notifyUser('Não foi possível gerar páginas no PDF. Verifique as imagens selecionadas.', 'warning');
                return;
            }

            displayLogMessage('PDF gerado. Criando link para download...');

            try {
                const pdfBytes = await pdfDoc.save();
                const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
                const pdfUrl = URL.createObjectURL(pdfBlob);

                // Link de download PDF
                let downloadLink = document.createElement('a');
                downloadLink.href = pdfUrl;
                downloadLink.download = 'Imagens em PDF.pdf';
                downloadLink.textContent = 'Baixar Imagens em PDF';
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
                console.error('Erro ao salvar o PDF:', saveError);
                notifyUser('Não foi possível salvar o PDF gerado.', 'error');
            }

        } catch (error) {
            console.error('Erro ao gerar PDF:', error);
            displayLogMessage(`Erro ao gerar PDF: ${error.message || 'Erro desconhecido'}`);
            notifyUser('Não foi possível concluir a geração do PDF.', 'error');
        }
    });

}, 'pdf-lib-script'); // Adiciona um ID para evitar carregamento duplicado