/* Funções para controlar o Menu Lateral (Sidenav) */
function openNav() {
    document.getElementById("mySidenav").style.width = "250px";
}

function closeNav() {
    document.getElementById("mySidenav").style.width = "0";
}


// Função para carregar scripts dinamicamente
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
        alert(`Erro ao carregar a biblioteca: ${url}. Verifique a URL e tente novamente.`);
    };

    document.head.appendChild(script);
}

// URL da biblioteca PDF.js a partir de uma CDN confiável (cdnjs)
const pdfjsLibUrl = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";

// Carrega o PDF.js e inicia o código principal
loadScript(pdfjsLibUrl, () => {
    console.log("PDF.js carregado dinamicamente.");

    // Define o caminho para o "worker" do PDF.js a partir da mesma CDN
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

    const fileInput = document.getElementById('pdfUpload');
    const convertPdfButton = document.getElementById('convertPdf');
    const logMessages = document.getElementById('log-messages');
    const thumbnailsContainer = document.getElementById('thumbnails-container');
    const jpgDownloadContainer = document.getElementById('jpg-download-container');
    const fileSelectedName = document.getElementById('file-selected-name');

    function displayLogMessage(message) {
        logMessages.textContent = message;
        console.log(message);
    }
    
    // Limpa as áreas de visualização e download
    function clearPreviousResults() {
        thumbnailsContainer.innerHTML = '';
        jpgDownloadContainer.innerHTML = '';
    }

    // Evento ao selecionar o arquivo PDF
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

    // Evento ao clicar no botão de conversão
    convertPdfButton.addEventListener('click', async function () {
        const file = fileInput.files[0];

        if (!file || file.type !== 'application/pdf') {
            alert('Por favor, selecione um arquivo PDF.');
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
                    const scale = 1.5; // Escala para melhor qualidade da imagem
                    const viewport = page.getViewport({ scale });

                    // Cria um canvas para renderizar a página
                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;

                    // Renderiza a página no canvas
                    const renderContext = {
                        canvasContext: context,
                        viewport: viewport
                    };
                    await page.render(renderContext).promise;

                    // Converte o canvas para imagem JPG
                    const jpgUrl = canvas.toDataURL('image/jpeg', 0.9); // 0.9 é a qualidade

                    // Cria a miniatura da imagem
                    const img = document.createElement('img');
                    img.src = jpgUrl;
                    thumbnailsContainer.appendChild(img);

                    // Cria o link de download para a imagem JPG
                    const downloadLink = document.createElement('a');
                    downloadLink.href = jpgUrl;
                    downloadLink.download = `pagina_${i}.jpg`;
                    downloadLink.textContent = `Baixar Página ${i} (JPG)`;
                    downloadLink.classList.add('custom-download-link');
                    jpgDownloadContainer.appendChild(downloadLink);
                    
                    // Adiciona uma quebra de linha para melhor organização dos links
                    jpgDownloadContainer.appendChild(document.createElement('br'));
                }
                
                displayLogMessage('Conversão concluída! Baixe suas imagens abaixo.');
                jpgDownloadContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });

            };
            
            reader.onerror = function(error) {
                console.error('Erro ao ler o arquivo PDF:', error);
                displayLogMessage('Erro ao ler o arquivo PDF.');
            };

            reader.readAsArrayBuffer(file);

        } catch (error) {
            console.error('Erro ao converter PDF para JPG:', error);
            displayLogMessage(`Erro ao converter PDF: ${error.message || 'Erro desconhecido'}`);
            alert('Ocorreu um erro ao converter o PDF. Veja o console para mais detalhes.');
        } finally {
            convertPdfButton.disabled = false;
        }
    });

}, 'pdfjs-lib-script');