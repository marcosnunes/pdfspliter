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
    const fileInput = document.getElementById('imageUpload');
    const generatePdfButton = document.getElementById('generatePdf');
    const logMessages = document.getElementById('log-messages');
    const thumbnailsContainer = document.getElementById('thumbnails-container'); // Container para miniaturas
    const pdfDownloadContainer = document.getElementById('pdf-download-container'); // Container para o link
    const fileSelectedName = document.getElementById('file-selected-name'); // Span para o nome dos arquivos

    function displayLogMessage(message) {
        logMessages.textContent = message;
        console.log(message);
    }

    // Função para exibir miniaturas das imagens
    function displayThumbnails(files) {
        thumbnailsContainer.innerHTML = ''; // Limpa miniaturas existentes
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

    // Evento ao selecionar imagens
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

    // Estilo do botão (garantido que seja aplicado)
    generatePdfButton.classList.add('button1');

    generatePdfButton.addEventListener('click', async function () {
        const files = fileInput.files;

        if (!files || files.length === 0) {
            alert('Por favor, selecione pelo menos uma imagem.');
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
                    displayLogMessage(`Tamanho da imagem ${file.name}: ${imageBytes.byteLength} bytes`); // Adicionado log do tamanho

                    if (file.type === 'image/jpeg' || file.type === 'image/jpg') {
                        image = await pdfDoc.embedJpg(imageBytes);
                    } else if (file.type === 'image/png') {
                        image = await pdfDoc.embedPng(imageBytes);
                    } else {
                        displayLogMessage(`Arquivo ${file.name} ignorado: tipo não suportado.`);
                        continue;
                    }
                    displayLogMessage(`Imagem ${file.name} incorporada com sucesso.`);

                    // Adicionado log do objeto image
                    console.log(`Objeto image para ${file.name}:`, image);

                } catch (imageError) {
                    console.error(`Erro ao processar imagem ${file.name}:`, imageError);
                    displayLogMessage(`Erro ao processar imagem ${file.name}. Verifique o arquivo.`);
                    continue; // Vai para a próxima imagem
                }

                 try {
                    // Verificação importante:
                    if (!image) {
                        console.error(`Imagem ${file.name} não foi incorporada corretamente.`);
                        displayLogMessage(`Erro: Imagem ${file.name} não foi incorporada corretamente.`);
                        continue;
                    }

                     // Garante que o PDF tenha pelo menos uma página antes de tentar desenhar a imagem
                    let page = pdfDoc.addPage();
                    // Acessa width e height diretamente do objeto image
                    const width = image.width;
                    const height = image.height;

                    // Ajusta o tamanho da imagem para caber na página (opcional)
                    const pageWidth = page.getWidth() - 40;  // Margem de 20 em cada lado
                    const pageHeight = page.getHeight() - 40; // Margem de 20 em cada lado

                    const scale = Math.min(pageWidth / width, pageHeight / height);
                    const scaledWidth = width * scale;
                    const scaledHeight = height * scale;


                    page.drawImage(image, {
                        x: (page.getWidth() - scaledWidth) / 2, // Centraliza horizontalmente
                        y: (page.getHeight() - scaledHeight) / 2, // Centraliza verticalmente
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
                alert('Nenhuma página foi adicionada ao PDF. Verifique as imagens.');
                return;
            }

            displayLogMessage('PDF gerado. Criando link para download...');

            try {
                const pdfBytes = await pdfDoc.save();
                const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
                const pdfUrl = URL.createObjectURL(pdfBlob);

                // Cria dinamicamente o link de download
                let downloadLink = document.createElement('a');
                downloadLink.href = pdfUrl;
                downloadLink.download = 'Imagens em PDF.pdf';
                downloadLink.textContent = 'Baixar Imagens em PDF'; // Texto do link
                downloadLink.classList.add('custom-download-link'); // Adiciona a classe para estilo

                // Limpa o conteúdo anterior e adiciona o link ao container de download
                pdfDownloadContainer.innerHTML = '';
                pdfDownloadContainer.appendChild(downloadLink);

                // Adiciona o foco para a área do link de download
                downloadLink.scrollIntoView({ behavior: 'smooth', block: 'start' });
                displayLogMessage('Pronto! Clique no link para baixar o PDF.');

            } catch (saveError) {
                console.error('Erro ao salvar o PDF:', saveError);
                displayLogMessage('Erro ao salvar o PDF.');
            }

        } catch (error) {
            console.error('Erro ao gerar PDF:', error);
            displayLogMessage(`Erro ao gerar PDF: ${error.message || 'Erro desconhecido'}`);
            alert('Ocorreu um erro ao gerar o PDF. Veja o console para mais detalhes.');
        }
    });

}, 'pdf-lib-script'); // Adiciona um ID para evitar carregamento duplicado