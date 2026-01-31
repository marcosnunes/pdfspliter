# PDFSpliter

> Suite modular para processamento avançado de PDFs — Android WebView & Browser

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Language](https://img.shields.io/badge/language-JavaScript-yellow.svg)](https://developer.mozilla.org/pt-BR/docs/Web/JavaScript)
[![Status](https://img.shields.io/badge/status-Active-green.svg)](#)

## Visão Geral

PDFSpliter é uma suíte de ferramentas independentes para manipulação de PDFs, com foco em documentos fiscais brasileiros, integração Android-first e suporte total a i18n (português como idioma principal). Cada ferramenta é isolada em seu próprio diretório, sem compartilhamento de código, garantindo robustez e fácil manutenção.

## Funcionalidades

- **Dividir**: Split inteligente com extração automática de nomes (contexto fiscal), fallback OCR nativo (Android), agrupamento por contribuinte.
- **Unir PDF**: Merge profissional, suporte a PDFs criptografados (`ignoreEncryption: true`), preservação de metadados.
- **Dividir Apenas**: Split simples, renomeação sequencial, ideal para processamento em lote.
- **PDF para JPG**: Conversão rápida, preview, processamento em paralelo.
- **JPG para PDF**: Consolidação de imagens, ajuste de ordem, múltiplas resoluções.
- **PDF para ArcGIS**: Extração de coordenadas 100% via IA local (WebLLM rodando no navegador, via CDN), validação topológica, geração de Shapefile/CSV/PRJ, comparação com memorial, detecção automática de matrícula. Não há mais fallback OCR/Tesseract/Android: toda dedução de vértices é feita exclusivamente pela IA local.

## Arquitetura & Padrões

- **Isolamento total**: Cada ferramenta (Dividir, UnirPDF, etc.) tem seu próprio `index.html`, `script.js`, `style.css` e arquivo de verificação Google. Não há utilitários compartilhados — duplicação é intencional.
- **Additivo, nunca destrutivo**: Não refatore/remova lógica funcional. Novas estratégias devem ser adicionadas como fallback (exceto PDFtoArcgis, que agora depende exclusivamente de IA local WebLLM para dedução de vértices).
- **Android-first**: Sempre verifique `window.Android` antes de usar fallback browser para download e traduções. (PDFtoArcgis não usa mais OCR Android nem fallback OCR.)
- **i18n**: Use `data-i18n` no HTML e `updateUI(translations)` para atualizar textos.
- **Feedback ao usuário**: Use `displayLogMessage()` para logs e progresso, prefixando com `[LogUI]`, `[JS]`, `[PDFtoArcgis]`.

git clone https://github.com/marcosnunes/pdfspliter.git
## Como usar

1. Clone o repositório: `git clone https://github.com/marcosnunes/pdfspliter.git`
2. Abra qualquer `index.html` de uma ferramenta no navegador (não requer build nem servidor).
3. Android: abra no WebView nativo (degrada para browser se `window.Android` ausente).
4. Use o menu lateral para navegar entre ferramentas.
5. Faça upload/processamento e baixe os resultados localmente (nunca há upload para servidor).


## Instalação como App (PWA)

O PDFSpliter pode ser instalado como aplicativo no Android ou iPhone diretamente pelo navegador, sem necessidade de loja de apps:

- Abra o `index.html` principal no navegador do celular (Chrome, Edge, Safari, etc).
- Procure a opção “Adicionar à tela inicial” (geralmente no menu do navegador).
- O app será instalado com ícone, tela cheia e funcionamento offline básico.

**Funcionalidades PWA:**
- Manifesto e ícones para instalação.
- Service Worker para funcionamento offline e cache local.
- Compatível com Android, iOS (Safari), Windows e desktop.
- 100% local, sem upload para servidores.

> Para personalizar o ícone, substitua os arquivos `icon-192.png` e `icon-512.png` na raiz.

pdfspliter/
## Estrutura do Projeto

Cada ferramenta está em seu próprio diretório, ex:

```
pdfspliter/
├── Dividir/         # Split inteligente (nome fiscal)
├── UnirPDF/         # Merge de PDFs (criptografados OK)
├── DividirApenas/   # Split simples
├── PDFtoJPG/        # PDF → JPG
├── JPGtoPDF/        # JPG → PDF
├── PDFtoArcgis/     # Extração de coordenadas GIS
├── index.html       # Home (menu)
├── script.js        # Navegação global
├── style.css        # Estilos globais
└── privacy_policy.html
```

## Integração e Dependências

- **Android bridge**: Use `window.Android.performOCR`, `window.Android.downloadPdf`, `window.Android.getTranslations`, `window.Android.exitApp`.
- **Fallback browser**: Use APIs web se `window.Android` não estiver presente.
- **Bibliotecas externas** (CDN, por ferramenta):
  - `pdf.js` (leitura/renderização)
  - `pdf-lib` (manipulação/criação)
  - `jsPDF` (geração simples)
  - `Tesseract.js` (OCR, PDFtoArcgis)

## Internacionalização (i18n)

- Use `data-i18n` nos elementos HTML.
- Traduções carregadas via `window.Android.getTranslations(lang)` (Android) ou fallback web.
- Atualize UI com `updateUI(translations)`.

## PDFtoArcgis: Estratégias e Validação

- Multi-estratégia de parsing (`parseVertices()`): tolera formatos OCR, tabelas, padrões cartoriais e variações regionais.
- Detecção automática de CRS (zona UTM, SAD69, SIRGAS2000, WGS84).
- Validação topológica: fechamento, auto-intersecção, orientação (CCW), área via Shoelace.
- Comparação com memorial: extração de azimutes/distâncias, validação de coerência (±2°/±2m).
- Saídas: CSV, Shapefile, PRJ, TXT, JSON.

## Exportação de Dados

- **Dividir**: `grupos_[timestamp].zip` (PDFs por contribuinte)
- **UnirPDF**: `resultado_[timestamp].pdf`
- **PDFtoJPG**: `imagens_[timestamp].zip`
- **JPGtoPDF**: `consolidado_[timestamp].pdf`
- **PDFtoArcgis**: `coordenadas_[timestamp].csv`, `relatorio_[timestamp].txt`, `dados_[timestamp].shp`, `dados_[timestamp].prj`, `dados_[timestamp].json`

## Dicas e Solução de Problemas

- **PDF não suportado**: Valide em outro leitor, reexporte se necessário.
- **Texto não extraído**: PDF escaneado — Dividir usa OCR Android. PDFtoArcgis não faz mais OCR: se não houver texto extraível, a IA local tentará deduzir apenas do texto disponível.
- **Coordenadas não encontradas**: Formato desconhecido/OCR ruim — veja console (F12) para debug.
- **Download falha**: Tente arquivos menores, use navegador moderno.

## Privacidade & Segurança

- Nenhum arquivo é enviado para servidores — processamento 100% local.
- Sem rastreamento, sem cache persistente.
- [Política de Privacidade](privacy_policy.html)

## Licença

MIT License — veja [LICENSE](LICENSE)

## Contribuindo

Contribuições são bem-vindas! Siga o fluxo padrão GitHub (fork, branch, PR). Diretrizes:
- Mantenha compatibilidade Android WebView
- Use ES6+ e teste em múltiplos navegadores
- Documente alterações e adicione i18n para novas strings

## Suporte

- [GitHub Issues](https://github.com/marcosnunes/pdfspliter/issues)

## Roadmap

- Suporte a OCR offline (WebAssembly)
- Compressão automática de PDF
- Assinatura digital
- Exportação GIS ampliada
- Dashboard histórico
- API REST futura

## Estatísticas

- 6 ferramentas independentes
- JavaScript (ES6+)
- Compatível: Chrome 90+, Firefox 88+, Safari 14+, Android 19+
- ~500KB (incluindo dependências CDN)
- i18n: Português + expansível

## Changelog

### v2.0 (Atual)
- PDFtoArcgis: validação topológica, memorial, múltiplos IDs, relatórios automáticos, projeções ampliadas
### v1.0
- 6 módulos iniciais, PDF/JPG, i18n, Android WebView

## Novidade: Footer Profissional

- Todas as páginas agora possuem um rodapé fixo, responsivo e integrado ao tema do app.
- Exibe: **Desenvolvido por Marcos Roberto Nunes Lindolpho** e **© 2026**.
- Visual moderno, responsivo e compatível com Android e desktop.

## Casos de Uso

- Processamento de documentos fiscais brasileiros (split por contribuinte, extração GIS)
- Automação de fluxos (divisão em lote, consolidação, exportação)
- Análise geoespacial (UTM, validação topológica, shapefile)

---
Desenvolvido com ❤️ em JavaScript

> Todas as páginas do app exibem no rodapé: **Desenvolvido por Marcos Roberto Nunes Lindolpho © 2026**

Última atualização: Janeiro 2026 | Versão: 2.0
