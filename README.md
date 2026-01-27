# 📄 PDF Spliter

> **Solução profissional multi-ferramenta para processamento de PDFs** - Desktop (Android WebView) + Browser

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Language](https://img.shields.io/badge/language-JavaScript-yellow.svg)](https://developer.mozilla.org/pt-BR/docs/Web/JavaScript)
[![Status](https://img.shields.io/badge/status-Active-green.svg)](#)

## 🎯 Visão Geral

PDF Spliter é um aplicativo multi-ferramenta para processamento avançado de PDFs, desenvolvido com suporte full **i18n** (português-first) e compatível com **Android WebView + Browser Desktop**.

O projeto conta com 6 módulos independentes, cada um otimizado para uma tarefa específica, permitindo máxima eficiência e isolamento de funcionalidades.

## ✨ Funcionalidades Principais

### 📋 **Dividir** - Split Inteligente
- Extração automática de nomes de contribuintes/pagadores
- Identificação de contexto em documentos fiscais brasileiros
- Agrupamento automático por documento identificado
- Fallback para OCR nativo em documentos degradados

### 🔗 **Unir PDF** - Merge Profissional
- Mescla múltiplos PDFs em um único arquivo
- Suporte para PDFs criptografados
- Preservação de metadados
- Interface intuitiva drag-and-drop

### 📄 **Dividir Apenas** - Split Simples
- Divisão página por página
- Rename automático sequencial
- Ideal para batch processing

### 🖼️ **PDF para JPG** - Conversão Rápida
- Renderização de alta qualidade
- Processamento em paralelo
- Preview antes do download

### 🖼️ **JPG para PDF** - Consolidação de Imagens
- Converte múltiplas imagens em PDF único
- Suporte para várias resoluções
- Ajuste de ordem antes de consolidar

### 🗺️ **PDF para ArcGIS** - Extração de Coordenadas
**Versão 2.0** com validação profissional:
- Extração inteligente de coordenadas (UTM/WGS84)
- Suporte a múltiplas projeções (SIRGAS2000, SAD69, WGS84)
- Validação topológica (closure, auto-intersecções, orientação)
- Comparação com memorial documentado (azimutes/distâncias)
- Geração de Shapefile + PRJ + Diagnóstico completo
- Detecção automática de matrícula/ID de documento
- Recovery automático para documentos fragmentados

## 🚀 Começando

### Pré-requisitos
- Navegador moderno (Chrome 90+, Firefox 88+, Safari 14+)
- Para Android: API 19+
- JavaScript habilitado

### Instalação Local

```bash
# Clone o repositório
git clone https://github.com/marcosnunes/pdfspliter.git

# Abra no navegador (não requer build)
# Desktop: Abra index.html no navegador
# Ou use um servidor local:
python -m http.server 8000
# Acesse: http://localhost:8000
```

### Uso Básico

1. **Acesse a aplicação**
   - Desktop: `index.html` em navegador
   - Android: Abra no WebView nativo

2. **Selecione a ferramenta** no menu lateral

3. **Faça upload do PDF** usando o seletor de arquivos

4. **Configure opções** (se necessário)

5. **Processe e baixe** o resultado

## 📁 Estrutura do Projeto

```
pdfspliter/
├── index.html                 # Home page
├── privacy_policy.html        # Política de privacidade
├── script.js                  # Lógica global & navegação
├── style.css                  # Estilos compartilhados
│
├── Dividir/                   # Split inteligente
│   ├── index.html
│   ├── script.js
│   ├── style.css
│   └── google*.html           # Verificação Google
│
├── UnirPDF/                   # Merge de PDFs
│   ├── index.html
│   ├── script.js
│   ├── style.css
│   └── google*.html
│
├── DividirApenas/             # Split simples
│   ├── index.html
│   ├── script.js
│   ├── style.css
│   └── google*.html
│
├── PDFtoJPG/                  # PDF → JPG
│   ├── index.html
│   ├── script.js
│   ├── style.css
│   └── google*.html
│
├── JPGtoPDF/                  # JPG → PDF
│   ├── index.html
│   ├── script.js
│   ├── style.css
│   └── google*.html
│
└── PDFtoArcgis/               # Extração de coordenadas
    ├── index.html
    ├── script.js
    ├── style.css
    └── google*.html
```

## 🔧 Arquitetura

### Design Philosophy
- **Isolamento**: Cada módulo é completamente independente
- **Código duplicado**: Funções utilitárias replicadas em cada ferramenta (sem dependências compartilhadas)
- **Android-first**: Código verifica `window.Android` para integração nativa
- **Compatibilidade**: 100% funcional em browsers e Android WebView

### Bibliotecas Externas (CDN)
- **pdf.js** `2.16.105` - Leitura e renderização de PDFs
- **pdf-lib** `1.17.1` - Manipulação e criação de PDFs
- **jsPDF** `2.5.1` - Geração simples de PDFs
- **Tesseract.js** `4.0.2` - OCR no navegador (PDFtoArcgis)

### Integração Android
```javascript
// OCR nativo
window.Android.performOCR(base64Image, callbackId)

// Download de arquivo
window.Android.downloadPdf(base64Data, fileName)

// Obter traduções
window.Android.getTranslations(lang)

// Sair da app
window.Android.exitApp()
```

## 🌍 Internacionalização (i18n)

Suporta múltiplos idiomas com atributo `data-i18n`:

```html
<h1 data-i18n="titulo.dividir">Dividir PDF</h1>
<button data-i18n="botoes.processar">Processar</button>
```

Carregamento de traduções:
```javascript
window.Android.getTranslations(lang) // Retorna JSON com traduções
```

## 📊 PDFtoArcgis v2.0 - Validação Profissional

### Recursos Avançados

#### Extração de Coordenadas
- **6 Estratégias de Parsing**: Múltiplos formatos de entrada (OCR-tolerante)
- **Múltiplas Projeções**: SAD69, SIRGAS2000, WGS84
- **Detecção Automática de CRS**: Baseada em zona UTM

#### Validação Topológica
- Verificação de fechamento (tolerância: 0.5m)
- Detecção de auto-intersecções
- Validação de orientação (CCW/CW)
- Cálculo de área com Shoelace

#### Comparação com Memorial
- Extração de azimutes documentados
- Extração de distâncias documentadas
- Validação de coerência (tolerâncias: ±2°/±2m)
- Relatório de discrepâncias

#### Saídas Profissionais
- CSV com diagnóstico completo
- Shapefile + PRJ (GIS-ready)
- Relatório em TXT
- JSON para APIs

#### Consolidação Inteligente de IDs
- Mantém múltiplos IDs SEPARADOS (não mesclados)
- Recovery automático de documentos fragmentados
- Suporte a diferentes formatos de matrícula

## 💾 Exportação de Dados

### Dividir
- `grupos_[timestamp].zip` - Arquivos PDF agrupados por contribuinte

### UnirPDF
- `resultado_[timestamp].pdf` - PDF mesclado

### PDFtoJPG
- `imagens_[timestamp].zip` - Imagens JPG

### JPGtoPDF
- `consolidado_[timestamp].pdf` - PDF consolidado

### PDFtoArcgis
- `coordenadas_[timestamp].csv` - Dados estruturados
- `relatorio_[timestamp].txt` - Diagnóstico profissional
- `dados_[timestamp].shp` - Shapefile para GIS
- `dados_[timestamp].prj` - Informação de projeção
- `dados_[timestamp].json` - Estrutura completa

## 🐛 Troubleshooting

### Problema: "PDF não é suportado"
- **Causa**: Arquivo corrompido ou formato inválido
- **Solução**: Valide o PDF em outro leitor; tente reexportar do editor original

### Problema: Texto não extraído
- **Causa**: PDF escaneado/imagem
- **Solução**: 
  - Dividir → usa OCR automático (Android)
  - PDFtoArcgis → tenta Tesseract.js browser + fallback OCR

### Problema: Coordenadas não encontradas
- **Causa**: Formato desconhecido ou OCR degradado
- **Solução**: Verifique console (F12) para mensagens de debug; valide o PDF original

### Problema: Download falha
- **Causa**: Arquivo muito grande ou conexão instável
- **Solução**: Teste com arquivo menor; use navegador moderno (Chrome/Firefox)

## 🔒 Privacidade & Segurança

- **Sem upload de servidor**: Todos os arquivos processados localmente no navegador
- **Sem rastreamento**: Nenhum dado enviado para terceiros
- **Sem cache**: Dados não persistem após fechamento
- [Ver Política de Privacidade](privacy_policy.html)

## 📝 Licença

MIT License - veja [LICENSE](LICENSE) para detalhes

## 🤝 Contribuindo

Contribuições são bem-vindas! Por favor:

1. Faça fork do projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

### Diretrizes
- Mantenha compatibilidade com Android WebView
- Use padrões ES6+
- Teste em múltiplos navegadores
- Documente alterações no código
- Adicione suporte i18n para novas strings

## 📞 Suporte

- **Issues**: [GitHub Issues](https://github.com/marcosnunes/pdfspliter/issues)
- **Email**: Veja informações de contato no perfil

## 🗺️ Roadmap

### Próximas Versões
- [ ] Suporte a OCR offline (WebAssembly)
- [ ] Compressão automática de PDF
- [ ] Assinatura digital de documentos
- [ ] Exportação para múltiplos formatos GIS
- [ ] Dashboard de histórico de processamento
- [ ] API REST para integração

## 📊 Estatísticas do Projeto

- **Módulos**: 6 ferramentas independentes
- **Linguagem**: JavaScript (ES6+)
- **Compatibilidade**: Chrome 90+, Firefox 88+, Safari 14+, Android 19+
- **Tamanho**: ~500KB (incluindo bibliotecas CDN)
- **i18n**: Português + suporte para expansão

## ✅ Changelog

### v2.0 (Atual) - PDFtoArcgis Enhanced
- Validação topológica profissional
- Comparação com memorial documentado
- Consolidação inteligente de múltiplos IDs
- Relatórios de diagnóstico automáticos
- Suporte estendido de projeções geodésicas

### v1.0
- 6 módulos iniciais
- Suporte básico para PDF/JPG
- i18n português
- Integração Android WebView

## 🎯 Caso de Uso Principal

PDF Spliter é especialmente útil para:

✅ **Processamento de Documentos Fiscais Brasileiros**
- Separação automática por contribuinte
- Extração de coordenadas para GIS
- Validação de conformidade

✅ **Automação de Fluxos**
- Divisão em lote
- Consolidação de imagens
- Exportação para sistemas legados

✅ **Análise Geoespacial**
- Extração de coordenadas UTM
- Validação topológica de polígonos
- Geração de Shapefiles para GIS

---

**Desenvolvido com ❤️ em JavaScript**

Último update: Janeiro 2026 | Versão: 2.0
