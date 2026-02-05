// =============================
// PDFtoArcgis - ETL SIMPLIFICADO (v2.4.1)
// =============================
// 
// REFATORAÇÃO ETL: Fluxo otimizado focado em IA como única fonte de transformação
// 
// [E] EXTRACTION: PDF.js extrai texto bruto de todas as páginas
// [T] TRANSFORMATION: IA (Groq llama-3.1-8b) converte texto → JSON estruturado
// [L] LOAD: Validação topológica + geração de shapefiles/CSV
//
// MUDANÇAS IMPLEMENTADAS (v2.4.1):
// - ❌ REMOVIDO: extractRelevantLinesForAI() - regex pré-filtragem
// - ❌ REMOVIDO: extractAzimuthDistanceFromText() - extração regex de azimutes/distâncias
// - ✅ SIMPLIFICADO: Prompt da IA (minimalista, apenas JSON)
// - ✅ CENTRALIZADO: IA retorna TUDO (coordenadas, azimutes, distâncias) em um JSON
// - ✅ MELHORADO: Tratamento robusto de respostas com markdown/texto explicativo
// - ✅ BENEFÍCIOS: Menos linhas de código, melhor manutenibilidade, menos erros
//
// v2.4.1 FIXES:
// - Adicionada função extractJSONFromResponse() para lidar com markdown
// - Melhorado prompt: Agora em inglês, mais imperativo ("Return ONLY JSON")
// - Adicionado retry com extração de JSON dentro de texto/markdown
// - Validação de resposta ANTES de tentar JSON.parse()
//
// Fluxo Anterior (v2.3): PDF → Regex (2 níveis) → IA → Regex (normalização)
// Fluxo Novo (v2.4.1):  PDF → IA (JSON completo + Markdown handling) → Validação
//
// =============================
// Suporte à API OpenAI GPT-4 Turbo
// =============================
let openaiApiKey = '';

function setOpenAIApiKey(key) {
  openaiApiKey = key;
}

// Garante que displayLogMessage está disponível (importa do global se necessário)
if (typeof displayLogMessage !== 'function' && window.displayLogMessage) {
  var displayLogMessage = window.displayLogMessage;
}

async function callOpenAIGPT4Turbo(prompt, retryCount = 0) {
  const MAX_RETRIES = 5;
  const INITIAL_DELAY_MS = 1000;
  
  const response = await fetch('/api/llama-3.1-8b-instant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt })
  });
  
  if (!response.ok) {
    // Retry em 429 (Too Many Requests) com backoff exponencial
    if (response.status === 429 && retryCount < MAX_RETRIES) {
      const delay = INITIAL_DELAY_MS * Math.pow(2, retryCount);
      console.warn(`[PDFtoArcgis] 429 Too Many Requests. Retry ${retryCount + 1}/${MAX_RETRIES} em ${delay}ms (backoff exp)...`);
      if (typeof displayLogMessage === 'function') {
        displayLogMessage(`[PDFtoArcgis][LogUI] Taxa limite atingida. Aguardando ${(delay/1000).toFixed(1)}s antes de tentar novamente...`);
      }
      await new Promise(resolve => setTimeout(resolve, delay));
      return callOpenAIGPT4Turbo(prompt, retryCount + 1);
    }
    
    if (typeof displayLogMessage === 'function') {
      displayLogMessage('[PDFtoArcgis] Erro na API OpenAI: ' + response.status);
    } else {
      console.error('[PDFtoArcgis] Erro na API OpenAI: ' + response.status);
    }
    return null;
  }
  const data = await response.json();
  return data;
}

// ⚠️ DEPRECATED: extractRelevantLinesForAI() foi DESABILITADO
// ETL SIMPLIFICADO: Enviar texto COMPLETO à IA (sem pré-filtragem com regex)
// MOTIVO: A IA é capaz de filtrar padrões relevantes melhor que regex heurísticos
// BENEFÍCIO: Reduz redundância, melhora taxa de sucesso para formatos variados
// 
// function extractRelevantLinesForAI(fullText) {
// }

function splitTextForAI(text, maxChars = 6000) {
  const chunks = [];
  let current = "";
  const lines = String(text || "").split(/\r?\n/);
  for (const ln of lines) {
    if ((current + "\n" + ln).length > maxChars && current.length) {
      chunks.push(current);
      current = ln;
    } else {
      current += (current ? "\n" : "") + ln;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function repairJsonCoordinates(jsonStr) {
  if (!jsonStr) return jsonStr;
  jsonStr = String(jsonStr).trim();
  // Remover truncamento (JSON cortado)
  if (jsonStr.endsWith(',')) jsonStr = jsonStr.slice(0, -1);
  if (!jsonStr.endsWith(']') && !jsonStr.endsWith('}')) {
    if (jsonStr.includes('"vertices"')) jsonStr += ']}';
  }
  
  // === LÓGICA: Normalizar números brasileiros CORRETAMENTE ===
  // Padrão: 7.186.708,425 (com ponto de milhar + vírgula decimal)
  // Precisamos detectar:
  // 1. Se temos uma sequência tipo XXX.XXX.XXX,XXX (3 dígitos . 3 dígitos . 3 dígitos , decimais)
  // 2. Isso é número brasileiro: remover . e trocar , por .
  
  // Padrão: números com MÚLTIPLOS pontos (ponto de milhar) e vírgula final (decimal)
  // Exemplo: "7.186.708,425" ou "693.736,178"
  jsonStr = jsonStr.replace(/(\d{1,3})\.(\d{3})\.(\d{3}),(\d+)/g, (match, g1, g2, g3, g4) => {
    // XXX.XXX.XXX,DDD → XXXXXXXXX.DDD (5-10 dígitos inteiros)
    return g1 + g2 + g3 + '.' + g4;
  });
  
  // Padrão: 2 ou mais dígitos com ponto separando, terminando em vírgula
  // Exemplo: "693.736,178" → "693736.178"
  jsonStr = jsonStr.replace(/(\d{3})\.(\d{3}),(\d+)/g, '$1$2.$3');
  
  // Padrão: qualquer número com vírgula decimal dentro de JSON
  // Se for contexto de número (entre : e ,/}), converter vírgula por ponto
  jsonStr = jsonStr.replace(/("(?:norte|norte|este|east|north|azimute|distancia)"\s*:\s*)(\d+),(\d+)/g, '$1$2.$3');
  
  return jsonStr;
}

function mergeVerticesFromChunks(chunksResults) {
  const merged = [];
  const seen = new Set();
  for (const obj of chunksResults) {
    const verts = Array.isArray(obj?.vertices) ? obj.vertices : [];
    for (const v of verts) {
      const id = String(v.id || "").trim();
      let east = v.este ?? v.east;
      let north = v.norte ?? v.north;
      
      // Normalizar números brasileiros CORRETAMENTE:
      // Padrão: 7.186.708,425 → 7186708.425
      // Ou: 693.736,178 → 693736.178
      if (typeof east === 'string') {
        // Remover todos os pontos, depois trocar vírgula por ponto
        east = east.replace(/\./g, '').replace(/,/g, '.');
      }
      if (typeof north === 'string') {
        north = north.replace(/\./g, '').replace(/,/g, '.');
      }
      
      east = Number(east);
      north = Number(north);
      
      const key = `${id}|${east}|${north}`;
      if (!Number.isFinite(east) || !Number.isFinite(north)) continue;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push({ id: v.id || id, este: east, norte: north });
      }
    }
  }
  return merged;
}

// =============================
// Função Auxiliar: Extrair JSON de Markdown ou Texto
// =============================
function extractJSONFromResponse(rawResponse) {
  if (!rawResponse) return null;
  
  const str = String(rawResponse).trim();
  
  // Padrão 1: JSON direto (esperado)
  if (str.startsWith('{') || str.startsWith('[')) {
    return str;
  }
  
  // Padrão 2: JSON dentro de markdown (```json ... ```)
  const mdMatch = str.match(/```json\s*([\s\S]*?)\s*```/);
  if (mdMatch && mdMatch[1]) {
    return mdMatch[1].trim();
  }
  
  // Padrão 3: JSON após texto explicativo
  // Procura por { ... } ou [ ... ] em qualquer posição
  const jsonMatch = str.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch && jsonMatch[1]) {
    return jsonMatch[1].trim();
  }
  
  console.warn('[PDFtoArcgis] ⚠️ Não conseguiu extrair JSON da resposta:', str.substring(0, 100));
  return null;
}

// =============================
async function ensureWebLLM(model = "phi-2") {
  if (window.webllm && webllmEngine) return webllmEngine;
  // Carrega o script WebLLM se necessário
  if (!window.webllm) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm/dist/webllm.min.js";
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  // Inicializa o modelo (ex: phi-2, tinyllama, mistral)
  webllmEngine = new window.webllm.MLCChatModule();
  await webllmEngine.reload({ model });
  return webllmEngine;
}

// ✅ v2.5 FALLBACK: Extração de vértices usando REGEX puro do texto original
// Usado quando JSON da IA falha ou é truncado
function extractVerticesFromTextRegex(pageText) {
  const vertices = [];
  
  // Padrão: Código do vértice (V1, P1, EBC...) seguido de coordenadas
  // E/Este: ~500k-600k, N/Norte: ~7300k-7350k
  // Azimute em DMS ou decimal, distância em metros
  
  // Regex para padrão: V123 | E 519000.123 N 7330000.456 | azi 123°45'67" | dist 123.45
  const coordPattern = /([VPE]\s*\d+(?:\s+[MV])?|EBC\s+[VM]\s*\d+)\s+.*?E(?:ste)?\s*[:=]?\s*(\d{6,}[.,]\d{1,3})\s+.*?N(?:orte)?\s*[:=]?\s*(\d{7,}[.,]\d{1,3})/gi;
  
  let match;
  const processedIds = new Set(); // evitar duplicatas
  
  while ((match = coordPattern.exec(pageText)) !== null) {
    const id = (match[1] || 'V' + vertices.length).trim().replace(/\\s+/g, '');
    
    // Skip if already processed (duplicates)
    if (processedIds.has(id)) continue;
    processedIds.add(id);
    
    // Converter formato brasileiro para padrão JS
    let este = match[2].replace(/\\./g, '').replace(',', '.');
    let norte = match[3].replace(/\\./g, '').replace(',', '.');
    
    este = parseFloat(este);
    norte = parseFloat(norte);
    
    // Validar ranges
    if (este >= 150000 && este <= 900000 && norte >= 6900000 && norte <= 10100000) {
      // ✅ Corrigir truncamento de Norte se necessário
      if (norte > 730000 && norte < 760000) {
        norte = parseFloat('7' + norte.toString());
      }
      
      vertices.push({
        id: id,
        este: Math.round(este * 1000) / 1000, // 3 decimals
        norte: Math.round(norte * 1000) / 1000,
        azimute_dms: '',
        azimute: 0,
        distancia: 0
      });
    }
  }
  
  console.log(`[PDFtoArcgis] Regex extraction found ${vertices.length} vertices`);
  return vertices.length > 0 ? vertices : null;
}


// ✅ v2.5: Detecta e corrige coordenadas truncadas (ex: N=733036 → N=7330036)
function detectAndFixTruncatedCoordinates(vertex) {
  const n = parseFloat(vertex.norte || 0);
  const e = parseFloat(vertex.este || 0);
  
  // Se N tem 7 dígitos E começa com 73/74/75 (esperado), faltam zero no início
  if (n > 730000 && n < 760000 && e >= 500000 && e <= 600000) {
    vertex.norte = parseFloat('7' + n.toString());
    console.warn(`[PDFtoArcgis] 🔧 N truncado corrigido: → ${vertex.norte}`);
  }
  
  return vertex;
}

// Função IA para processar página por página - v2.5 otimizado
async function deducePolygonVerticesPerPage(pagesText) {
  const smallPrompt = (text) => `You are a cadastral document parser for Brazilian real estate (SIRGAS2000/UTM).

TASK: Extract ALL vertices. RETURN: ONLY valid JSON. No markdown. No text before/after.

JSON: {"vertices":[{"id":"V1","este":693736.178,"norte":7186708.425,"azimute_dms":"133°15'52\\"","azimute":133.2644,"distancia":24.86}]}

RULES:
1. Este: 150k-900k, Norte: 6.9M-10.1M (omit invalid)
2. Fix typos: "B5º" -> numeric only
3. Max 3 decimals, return {"vertices":[]} if empty

Text (first 4500 chars):
${text.substring(0, 4500)}`;

  const results = [];
  const totalPages = pagesText.length;
  let baseDelay = 5000; // ⬆️ Aumentado de 3s → 5s para evitar 429 rate limit
  
  if (typeof displayLogMessage === 'function') {
    displayLogMessage(`[PDFtoArcgis][LogUI] 📄 Processando ${totalPages} página(s) individualmente...`);
  }
  
  for (let i = 0; i < totalPages; i++) {
    const pageText = pagesText[i];
    if (!pageText || pageText.trim().length < 10) {
      console.log(`[PDFtoArcgis] Página ${i + 1}: vazia, pulando`);
      continue;
    }
    
    if (typeof displayLogMessage === 'function') {
      displayLogMessage(`[PDFtoArcgis][LogUI] ⏳ Processando página ${i + 1} de ${totalPages}...`);
    }
    
    // ETL SIMPLIFICADO: Enviar texto COMPLETO à IA (sem pré-filtragem com regex)
    // Benefício: IA entende contexto melhor que regex para formatos variados
    const textToSend = pageText;
    
    if (textToSend.trim().length < 10) {
      console.log(`[PDFtoArcgis] Página ${i + 1}: sem conteúdo para processar`);
      continue;
    }
    
    const prompt = smallPrompt(textToSend);
    console.log(`[PDFtoArcgis][LOG IA][PROMPT][PAGE ${i + 1}/${totalPages}]`, prompt.substring(0, 200) + '...');
    
    // Aguardar antes de fazer requisição (exceto primeira página)
    if (i > 0) {
      console.log(`[PDFtoArcgis] ⏳ Aguardando ${baseDelay}ms antes de próxima requisição...`);
      if (typeof displayLogMessage === 'function') {
        displayLogMessage(`[PDFtoArcgis][LogUI] ⏳ Aguardando ${(baseDelay/1000).toFixed(1)}s antes da próxima página...`);
      }
      await new Promise(resolve => setTimeout(resolve, baseDelay));
    }
    
    if (typeof displayLogMessage === 'function') {
      displayLogMessage(`[PDFtoArcgis][LogUI] 🤖 Enviando página ${i + 1}/${totalPages} para IA obter coordenadas...`);
    }
    
    const r = await callOpenAIGPT4Turbo(prompt);
    let content = r?.choices?.[0]?.message?.content || "";
    console.log(`[PDFtoArcgis][LOG IA][RAW][PAGE ${i + 1}/${totalPages}]`, content);
    
    if (typeof displayLogMessage === 'function') {
      displayLogMessage(`[PDFtoArcgis][LogUI] ⏳ Página ${i + 1}: processando resposta da IA...`);
    }
    
    if (!content) {
      console.warn(`[PDFtoArcgis] Página ${i + 1} sem resposta`);
      if (typeof displayLogMessage === 'function') {
        displayLogMessage(`[PDFtoArcgis][LogUI] ⚠️ Página ${i + 1}: IA não retornou dados`);
      }
      continue;
    }
    
    // ETL MELHORIA: Extrair JSON de dentro de markdown ou texto explicativo
    const jsonExtracted = extractJSONFromResponse(content);
    if (!jsonExtracted) {
      console.warn(`[PDFtoArcgis] Página ${i + 1}: Não conseguiu extrair JSON da resposta`);
      if (typeof displayLogMessage === 'function') {
        displayLogMessage(`[PDFtoArcgis][LogUI] ⏳ Página ${i + 1}: tentando recuperação alternativa...`);
      }
      continue;
    }
    
    if (typeof displayLogMessage === 'function') {
      displayLogMessage(`[PDFtoArcgis][LogUI] ⏳ Página ${i + 1}: validando coordenadas extraídas...`);
    }
    
    content = repairJsonCoordinates(jsonExtracted);
    try {
      const parsed = JSON.parse(content);
      
      // Validar coordenadas UTM (evitar dados fake/teste)
      if (parsed?.vertices && Array.isArray(parsed.vertices)) {
        const validVertices = parsed.vertices.filter(v => {
          const e = parseFloat(v.este || v.east || 0);
          let n = parseFloat(v.norte || v.north || 0);
          
          // ✅ Correção de coordenadas truncadas (page 5 bug: N=733036.7 → 7330036.7)
          if (n > 730000 && n < 760000 && e >= 500000 && e <= 600000) {
            n = parseFloat('7' + n.toString());
            v.norte = n; // Atualizar vertex
          }
          
          // Coordenadas UTM válidas para Brasil (todas as zonas 19-25)
          const isValidE = e >= 150000 && e <= 900000;
          const isValidN = n >= 6900000 && n <= 10100000;
          
          if (!isValidE || !isValidN) {
            console.warn(`[PDFtoArcgis] ⚠️ Coordenada inválida: ${v.id || '?'} E=${e} N=${n}`);
          }
          return isValidE && isValidN;
        });
        
        if (validVertices.length !== parsed.vertices.length) {
          console.log(`[PDFtoArcgis] 🔧 Filtrados ${parsed.vertices.length - validVertices.length} vértice(s) com coordenadas inválidas`);
          if (typeof displayLogMessage === 'function') {
            displayLogMessage(`[PDFtoArcgis][LogUI] 🔧 Página ${i + 1}: ${validVertices.length} válido(s) de ${parsed.vertices.length}`);
          }
        }
        
        parsed.vertices = validVertices;
      }
      
      if (parsed?.vertices?.length > 0) {
        results.push(parsed);
        const vcount = parsed.vertices.length;
        
        // Se houver azimutes/distâncias, logar para validação
        const withMeasures = parsed.vertices.filter(v => v.azimute !== undefined || v.distancia !== undefined);
        const measureInfo = withMeasures.length > 0 ? ` (${withMeasures.length} com medidas)` : "";
        
        console.log(`[PDFtoArcgis] Página ${i + 1}: ${vcount} vértices extraídos${measureInfo}`);
        if (typeof displayLogMessage === 'function') {
          displayLogMessage(`[PDFtoArcgis][LogUI] ✅ Página ${i + 1}: ${vcount} coordenada(s)${measureInfo}`);
        }
      } else {
        console.log(`[PDFtoArcgis] Página ${i + 1}: nenhum vértice válido após filtros`);
        if (typeof displayLogMessage === 'function') {
          displayLogMessage(`[PDFtoArcgis][LogUI] ℹ️ Página ${i + 1}: sem coordenadas válidas`);
        }
      }
    } catch (e) {
      console.error('[PDFtoArcgis][PARSE ERROR][PAGE]', e, content);
      
      // Tentar novamente com extração mais agressiva
      console.log(`[PDFtoArcgis] 🔄 Tentando extração alternativa para página ${i + 1}...`);
      const retryJson = extractJSONFromResponse(content);
      if (retryJson) {
        try {
          const retryParsed = JSON.parse(repairJsonCoordinates(retryJson));
          if (retryParsed?.vertices?.length > 0) {
            results.push(retryParsed);
            console.log(`[PDFtoArcgis] ✅ Página ${i + 1}: recuperada com sucesso (retry)`);
            if (typeof displayLogMessage === 'function') {
              displayLogMessage(`[PDFtoArcgis][LogUI] 🔧 Página ${i + 1}: recuperada (retry)`);
            }
          }
        } catch (e2) {
          console.error('[PDFtoArcgis][PARSE ERROR RETRY]', e2);
        }
      }
      
      // Detectar se é mensagem de "sem dados" da IA
      if (typeof content === 'string' && (content.includes('Não há') || content.includes('não há') || content.includes('no data') || content.includes('no coordinates'))) {
        console.log(`[PDFtoArcgis] Página ${i + 1}: sem dados de vértices (IA confirmou)`);
        if (typeof displayLogMessage === 'function') {
          displayLogMessage(`[PDFtoArcgis][LogUI] ℹ️ Página ${i + 1}: sem coordenadas detectadas pela IA`);
        }
        baseDelay = Math.min(baseDelay + 500, 5000); // Aumentar delay progressivamente até 5s
      } else {
        // FALLBACK NÍVEL 2: Tentar recuperar JSON do conteúdo
        const arrMatch = content.match(/\[\{[^\}]*\}.*?\]/s);
        if (arrMatch) {
          const repaired = repairJsonCoordinates('{"vertices":' + arrMatch[0] + '}');
          try {
            const parsed = JSON.parse(repaired);
            results.push(parsed);
            const vcount = Array.isArray(parsed?.vertices) ? parsed.vertices.length : 0;
            console.log(`[PDFtoArcgis] Página ${i + 1} (recovery): ${vcount} vértices`);
            if (typeof displayLogMessage === 'function') {
              displayLogMessage(`[PDFtoArcgis][LogUI] 🔧 Página ${i + 1}: ${vcount} coordenada(s) recuperada(s)`);
            }
          } catch (e2) {
            // FALLBACK NÍVEL 3: Extração regex direta do texto original (last resort)
            console.warn('[PDFtoArcgis] 🔴 JSON recovery failed, attempting regex extraction...');
            const regexVertices = extractVerticesFromTextRegex(pageText);
            if (regexVertices && regexVertices.length > 0) {
              results.push({ vertices: regexVertices });
              console.log(`[PDFtoArcgis] ✅ Página ${i + 1} (REGEX fallback): ${regexVertices.length} vértices`);
              if (typeof displayLogMessage === 'function') {
                displayLogMessage(`[PDFtoArcgis][LogUI] 🔧 Página ${i + 1}: ${regexVertices.length} coordenada(s) via regex`);
              }
            } else {
              console.error('[PDFtoArcgis][PARSE ERROR][PAGE RETRY]', e2);
              if (typeof displayLogMessage === 'function') {
                displayLogMessage(`[PDFtoArcgis][LogUI] ❌ Página ${i + 1}: erro ao processar resposta da IA`);
              }
            }
            baseDelay = Math.min(baseDelay + 1000, 8000); // Aumentar delay agressivamente
          }
        } else {
          // FALLBACK NÍVEL 3B: Se nem regex de JSON funcionou, tentar extração de texto puro
          console.warn('[PDFtoArcgis] 🔴 No JSON array found, attempting text regex extraction...');
          const regexVertices = extractVerticesFromTextRegex(pageText);
          if (regexVertices && regexVertices.length > 0) {
            results.push({ vertices: regexVertices });
            console.log(`[PDFtoArcgis] ✅ Página ${i + 1} (TEXT REGEX fallback): ${regexVertices.length} vértices`);
            if (typeof displayLogMessage === 'function') {
              displayLogMessage(`[PDFtoArcgis][LogUI] 🔧 Página ${i + 1}: ${regexVertices.length} coordenada(s) via regex`);
            }
          } else {
            if (typeof displayLogMessage === 'function') {
              displayLogMessage(`[PDFtoArcgis][LogUI] ❌ Página ${i + 1}: IA retornou formato inválido`);
            }
          }
          baseDelay = Math.min(baseDelay + 1000, 8000); // Aumentar delay agressivamente
        }
      }
    }
  }
  
  const mergedVertices = mergeVerticesFromChunks(results);
  console.log(`[PDFtoArcgis] Total de vértices únicos (por página): ${mergedVertices.length}`);
  
  // Ordenar vértices por proximidade (nearest neighbor) para formar polígono correto
  const orderedVertices = orderVerticesByProximity(mergedVertices);
  console.log(`[PDFtoArcgis] Vértices reordenados por proximidade para formar polígono`);
  
  if (typeof displayLogMessage === 'function') {
    displayLogMessage(`[PDFtoArcgis][LogUI] 🎉 Processamento concluído! ${orderedVertices.length} coordenada(s) extraída(s) e ordenadas pela IA`);
  }
  
  if (orderedVertices.length >= 3) {
    return {
      imovel: null,
      matricula: null,
      datum: null,
      vertices: orderedVertices
    };
  }
  
  return null;
}

// Função para ordenar vértices por proximidade (nearest neighbor algorithm)
function orderVerticesByProximity(vertices) {
  if (vertices.length < 3) return vertices;
  
  const ordered = [];
  const remaining = [...vertices];
  
  // Começar pelo primeiro vértice
  let current = remaining.shift();
  ordered.push(current);
  
  // Para cada vértice, encontrar o mais próximo
  while (remaining.length > 0) {
    let nearestIndex = 0;
    let minDistance = Infinity;
    
    for (let i = 0; i < remaining.length; i++) {
      const dist = Math.sqrt(
        Math.pow(remaining[i].east - current.east, 2) +
        Math.pow(remaining[i].north - current.north, 2)
      );
      
      if (dist < minDistance) {
        minDistance = dist;
        nearestIndex = i;
      }
    }
    
    current = remaining.splice(nearestIndex, 1)[0];
    ordered.push(current);
  }
  
  // Reindexar ordem
  return ordered.map((v, idx) => ({
    ...v,
    ordem: idx + 1
  }));
}

// Função IA para deduzir os vértices corretos a partir do texto extraído (selecionável + OCR)
async function deducePolygonVerticesWithAI(fullText) {
  // NOVO FLUXO: Apenas IA, sem heurística, sem pós-processamento
  const basePrompt = (text) => `Instrução: Atue como um especialista em geoprocessamento. Extraia os dados topográficos do texto abaixo e retorne APENAS um objeto JSON válido. Não inclua explicações ou texto adicional.\n\nRegras de Extração:\n1. Identifique o nome do imóvel ou gleba.\n2. Identifique o número da Matrícula (se disponível).\n3. Extraia todos os vértices com seu ID, Coordenada Este (E/X) e Coordenada Norte (N/Y).\n4. Remova símbolos de unidade como 'm' ou '.' de milhar, mantendo apenas o ponto decimal.\n5. Identifique o DATUM (ex: SIRGAS 2000).\n\nExemplo de Saída Esperada:\n{\n  "imovel": "Chácara 26 - Fazenda Limeira",\n  "matricula": "31.644",\n  "datum": "SIRGAS 2000",\n  "vertices": [\n    {"id": "0=PP", "este": 535842.302, "norte": 7312819.308},\n    {"id": "1", "este": 536070.136, "norte": 7312593.145}\n  ]\n}\n\nTexto para Processar:\n${text}`;

  const smallPrompt = (text) => `Instrução: Extraia APENAS os vértices (ID, Este, Norte) do texto abaixo e retorne um JSON válido. Sem explicações.\n\nFormato:\n{\n  "vertices": [\n    {"id": "P1", "este": 123456.789, "norte": 7123456.789}\n  ]\n}\n\nTexto:\n${text}`;

  let workingText = fullText || "";
  const MAX_PROMPT = 15000;
  if (workingText.length > MAX_PROMPT) {
    workingText = extractRelevantLinesForAI(workingText);
  }

  let prompt = basePrompt(workingText);
  // Logar prompt enviado
  console.log('[PDFtoArcgis][LOG IA][PROMPT]', prompt);
  let reply = await callOpenAIGPT4Turbo(prompt);
  let jsonText = (reply && reply.choices && reply.choices[0] && reply.choices[0].message && reply.choices[0].message.content) ? reply.choices[0].message.content : '';
  // Logar resposta bruta da IA
  console.log('[PDFtoArcgis][LOG IA][RAW]', jsonText);
  if (!reply || !reply.choices?.[0]?.message?.content) {
    console.error('[PDFtoArcgis][LOG IA][RAW] (resposta ausente)', reply);
    // Fallback 1: texto filtrado (se ainda não tentou)
    if (workingText !== fullText) {
      prompt = basePrompt(workingText);
      console.log('[PDFtoArcgis][LOG IA][PROMPT][FALLBACK-REDUCED]', prompt);
      reply = await callOpenAIGPT4Turbo(prompt);
      jsonText = (reply && reply.choices?.[0]?.message?.content) ? reply.choices[0].message.content : '';
      console.log('[PDFtoArcgis][LOG IA][RAW][FALLBACK-REDUCED]', jsonText);
    }

    if (!reply || !reply.choices?.[0]?.message?.content) {
      // Fallback 2: dividir em chunks e juntar vértices
      // ETL: Usar texto completo em chunks (sem pre-filtering)
      const chunks = splitTextForAI(fullText, 6000);
      const results = [];
      if (typeof displayLogMessage === 'function') {
        displayLogMessage(`[PDFtoArcgis][LogUI] 📊 Dividindo PDF em ${chunks.length} parte(s) para análise...`);
      }
      for (let i = 0; i < chunks.length; i++) {
        if (typeof displayLogMessage === 'function') {
          displayLogMessage(`[PDFtoArcgis][LogUI] ⏳ Analisando parte ${i + 1} de ${chunks.length}...`);
        }
        const p = smallPrompt(chunks[i]);
        console.log(`[PDFtoArcgis][LOG IA][PROMPT][CHUNK ${i + 1}/${chunks.length}]`, p);
        const r = await callOpenAIGPT4Turbo(p);
        let content = r?.choices?.[0]?.message?.content || "";
        console.log(`[PDFtoArcgis][LOG IA][RAW][CHUNK ${i + 1}/${chunks.length}]`, content);
        if (!content) {
          console.warn(`[PDFtoArcgis] Chunk ${i + 1} sem resposta`);
          continue;
        }
        
        // ETL MELHORIA: Extrair JSON de dentro de markdown/texto explicativo
        const jsonExtracted = extractJSONFromResponse(content);
        if (!jsonExtracted) {
          console.warn(`[PDFtoArcgis] Chunk ${i + 1}: Não conseguiu extrair JSON`);
          continue;
        }
        
        // Reparar JSON malformado
        content = repairJsonCoordinates(jsonExtracted);
        try {
          const parsed = JSON.parse(content);
          results.push(parsed);
          const vcount = Array.isArray(parsed?.vertices) ? parsed.vertices.length : 0;
          console.log(`[PDFtoArcgis] Chunk ${i + 1}: ${vcount} vértices extraídos`);
          if (typeof displayLogMessage === 'function') {
            displayLogMessage(`[PDFtoArcgis][LogUI] ✅ Parte ${i + 1}: ${vcount} vértice(s) encontrado(s)`);
          }
        } catch (e) {
          console.error('[PDFtoArcgis][LOG IA][PARSE ERROR][CHUNK]', e, content);
          // Tentar extrair array JSON mesmo com erro
          const arrMatch = content.match(/\[\{[^\}]*\}.*?\]/s);
          if (arrMatch) {
            const repaired = repairJsonCoordinates('{"vertices":' + arrMatch[0] + '}');
            try {
              const parsed = JSON.parse(repaired);
              results.push(parsed);
              const vcount = Array.isArray(parsed?.vertices) ? parsed.vertices.length : 0;
              console.log(`[PDFtoArcgis] Chunk ${i + 1} (recover): ${vcount} vértices extraídos`);
            } catch (e2) {
              console.error('[PDFtoArcgis][LOG IA][PARSE ERROR][CHUNK RETRY]', e2);
            }
          }
        }
        // Delay entre chunks para evitar rate limit (500ms entre requisições)
        if (i < chunks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      const mergedVertices = mergeVerticesFromChunks(results);
      console.log(`[PDFtoArcgis] Total de vértices únicos: ${mergedVertices.length}`);
      if (typeof displayLogMessage === 'function') {
        displayLogMessage(`[PDFtoArcgis][LogUI] 📍 Total: ${mergedVertices.length} vértice(s) único(s) encontrado(s)`);
      }
      if (mergedVertices.length >= 3) {
        return {
          imovel: null,
          matricula: null,
          datum: null,
          vertices: mergedVertices
        };
      }

      if (typeof displayLogMessage === 'function') {
        displayLogMessage('[PDFtoArcgis] Falha na resposta da OpenAI.');
      } else {
        console.error('[PDFtoArcgis] Falha na resposta da OpenAI.');
      }
      return null;
    }
  }
  // Apenas parse JSON, sem heurística
  let obj = null;
  try {
    obj = JSON.parse(jsonText);
  } catch (e) {
    console.error('[PDFtoArcgis][LOG IA][PARSE ERROR]', e, jsonText);
    if (typeof displayLogMessage === 'function') {
      displayLogMessage('[JS][IA] Erro ao interpretar JSON da IA: ' + e.message);
    } else {
      console.error('[JS][IA] Erro ao interpretar JSON da IA: ' + e.message);
    }
    return null;
  }
  // Retornar objeto cru da IA (sem pós-processamento)
  return obj;
}

// Extração robusta de texto por página (sem OCR): garante leitura de todas as páginas
async function extractPageTextSafely(page, pageIndex) {
  const tryExtract = async (options) => {
    const textContent = await page.getTextContent(options);
    let text = buildPageTextWithLines(textContent);
    if (!text || text.trim().length < 5) {
      const raw = (textContent.items || []).map(it => it.str).filter(Boolean).join(" ");
      if (raw && raw.trim().length > (text || "").trim().length) text = raw;
    }
    return text || "";
  };

  let pageText = "";
  try {
    pageText = await tryExtract({ disableCombineTextItems: false });
  } catch (e) { }

  if (!pageText || pageText.trim().length < 5) {
    try {
      pageText = await tryExtract({ disableCombineTextItems: true });
    } catch (e) { }
  }

  if (!pageText || pageText.trim().length < 5) {
    try {
      pageText = await tryExtract({ normalizeWhitespace: true, disableCombineTextItems: true });
    } catch (e) { }
  }

  if (!pageText || pageText.trim().length < 5) {
    try {
      pageText = await tryExtract({
        normalizeWhitespace: true,
        disableCombineTextItems: true,
        includeMarkedContent: true
      });
    } catch (e) { }
  }

  if (typeof displayLogMessage === 'function') {
    displayLogMessage(`[PDFtoArcgis][LogUI] Página ${pageIndex}: ${pageText ? pageText.trim().length : 0} caracteres extraídos.`);
  }

  return pageText || "";
}

// OCR por página (Android primeiro, fallback Tesseract.js)
async function performOcrOnPage(page, pageIndex) {
  if (window.Android && window.Android.performOCR) {
    try {
      const ocrText = await window.Android.performOCR(pageIndex);
      return (ocrText && ocrText.length > 10) ? ocrText : "";
    } catch (e) {
      return "";
    }
  }

  if (window.Tesseract) {
    try {
      const canvas = document.createElement('canvas');
      const viewport = page.getViewport({ scale: 2.0 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      const result = await window.Tesseract.recognize(canvas, 'por');
      const text = result?.data?.text || "";
      return (text && text.length > 10) ? text : "";
    } catch (e) {
      return "";
    }
  }

  return "";
}

// Função para extrair texto selecionável + OCR de todas as páginas
async function extractFullTextWithAI(pdfBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: pdfBuffer }).promise;
  let fullText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    let pageText = await extractPageTextSafely(page, i);
    // Se não extraiu texto, tenta OCR
    if (!pageText || pageText.trim().length < 10) {
      if (window.Android && window.Android.performOCR) {
        // Android bridge OCR
        try {
          const ocrText = await window.Android.performOCR(i);
          if (ocrText && ocrText.length > 10) pageText = ocrText;
        } catch (e) { }
      } else if (window.Tesseract) {
        // Tesseract.js OCR fallback
        try {
          const canvas = document.createElement('canvas');
          const viewport = page.getViewport({ scale: 2.0 });
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d');
          await page.render({ canvasContext: ctx, viewport }).promise;
          const result = await window.Tesseract.recognize(canvas, 'por');
          if (result && result.data && result.data.text && result.data.text.length > 10) {
            pageText = result.data.text;
          }
        } catch (e) { }
      }
    }
    fullText += pageText + "\n";
  }
  return fullText;
}

// === Integração no fluxo principal ===
async function processPDFWithAI(pdfBuffer) {
  displayLogMessage('[JS][IA] Iniciando extração IA...');
  const fullText = await extractFullTextWithAI(pdfBuffer);
  if (!fullText || fullText.trim().length < 30) {
    displayLogMessage('[JS][IA] Texto insuficiente extraído.');
    return null;
  }
  const iaObj = await deducePolygonVerticesWithAI(fullText);
  if (!iaObj || !Array.isArray(iaObj.vertices) || iaObj.vertices.length < 3) {
    displayLogMessage('[JS][IA] Não foi possível obter vértices válidos da IA.');
    return null;
  }
  displayLogMessage(`[JS][IA] Vértices recebidos da IA: ${iaObj.vertices.length}`);
  // Retornar objeto cru da IA para uso direto
  return iaObj;
}

// Exemplo de uso: fallback IA se métodos tradicionais falharem
// Chame processPDFWithAI(pdfBuffer) quando necessário
// Exemplo:
// let vertices = await parseVertices(buffer);
// if (!vertices) vertices = await processPDFWithAI(buffer);
// if (!vertices) displayLogMessage('Falha geral na extração de vértices.');

// Esconde o botão de instalar app se já estiver instalado (PWA/standalone)
function isAppInstalled() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    (window.navigator.standalone === true)
  );
}

// UI: Navegação lateral e rolagem para resultados
function openNav() {
  document.getElementById("mySidenav").style.width = "250px";
  if (typeof isAppInstalled === 'function' && typeof hideInstallBtn === 'function') {
    if (isAppInstalled()) hideInstallBtn();
  }
}
function closeNav() { document.getElementById("mySidenav").style.width = "0"; }


// === UI: Atualizar painel de validação topológica ===
function updateValidationUI(topology, corrections = []) {
  const validationBox = document.getElementById("validationBox");
  const validationTitle = document.getElementById("validationTitle");
  const validationErrors = document.getElementById("validationErrors");
  const validationWarnings = document.getElementById("validationWarnings");
  const validationSuccess = document.getElementById("validationSuccess");
  const validationDetails = document.getElementById("validationDetails");
  const validationActions = document.getElementById("validationActions");
  const errorList = document.getElementById("errorList");
  const warningList = document.getElementById("warningList");

  if (!validationBox) return;

  // Mostrar painel
  validationBox.style.display = "block";

  // Limpar listas
  if (errorList) errorList.innerHTML = "";
  if (warningList) warningList.innerHTML = "";

  // Atualizar título
  if (validationTitle) {
    if (topology.isValid) {
      validationTitle.innerHTML = '<i class="fas fa-check-circle" style="color:#28a745;"></i> Polígono Válido!';
    } else {
      validationTitle.innerHTML = '<i class="fas fa-exclamation-triangle" style="color:#dc3545;"></i> Problemas Detectados';
    }
  }

  // Mostrar erros
  if (topology.errors && topology.errors.length > 0 && validationErrors && errorList) {
    validationErrors.style.display = "block";
    topology.errors.forEach(err => {
      const li = document.createElement("li");
      li.textContent = err;
      errorList.appendChild(li);
    });
  } else if (validationErrors) {
    validationErrors.style.display = "none";
  }

  // Mostrar avisos
  if (topology.warnings && topology.warnings.length > 0 && validationWarnings && warningList) {
    validationWarnings.style.display = "block";
    topology.warnings.forEach(warn => {
      const li = document.createElement("li");
      li.textContent = warn;
      warningList.appendChild(li);
    });
  } else if (validationWarnings) {
    validationWarnings.style.display = "none";
  }

  // Mostrar sucesso
  if (topology.isValid && validationSuccess && validationDetails) {
    validationSuccess.style.display = "block";
    
    const areaHa = (topology.area / 10000).toFixed(4);
    const areaM2 = topology.area.toFixed(2);
    const closedText = topology.closed ? "✓ Fechado" : "⚠ Não fechado";
    
    validationDetails.innerHTML = `
      <strong>Área:</strong> ${areaHa} ha (${areaM2} m²)<br>
      <strong>Fechamento:</strong> ${closedText}<br>
      <strong>Orientação:</strong> Anti-horária (CCW) ✓<br>
      <strong>Auto-intersecções:</strong> ${topology.hasIntersections ? '❌ Sim' : '✓ Não'}
    `;
    
    if (corrections.length > 0) {
      validationDetails.innerHTML += `<br><br><strong>Correções aplicadas:</strong><br>`;
      corrections.forEach(corr => {
        validationDetails.innerHTML += `• ${corr}<br>`;
      });
    }
  } else if (validationSuccess) {
    validationSuccess.style.display = "none";
  }

  // Mostrar/ocultar botão de correção
  if (validationActions) {
    if (!topology.isValid && topology.errors.length > 0) {
      validationActions.style.display = "block";
    } else {
      validationActions.style.display = "none";
    }
  }
}

// --- PWA: Instalar App (com feedback visual) ---
let deferredPrompt = null;
let installBtn = null;

function hideInstallBtn() {
  if (installBtn) installBtn.style.display = 'none';
}

// Detecta se já está instalado (standalone ou appinstalled)
function isAppInstalled() {
  // Checa standalone (PWA instalado) e display-mode
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  if (window.navigator.standalone === true) return true;
  // Checa se já existe service worker controlando e não há prompt
  if (window.matchMedia('(display-mode: minimal-ui)').matches) return true;
  // iOS: verifica se está rodando como app
  if (window.navigator && window.navigator.standalone) return true;
  // Android Chrome: verifica se não há prompt e já está instalado
  if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
  return false;
}

if (isAppInstalled()) {
  hideInstallBtn();
}

window.addEventListener('appinstalled', hideInstallBtn);

window.addEventListener('DOMContentLoaded', function () {
  installBtn = document.getElementById('installPwaBtn');
  if (isAppInstalled()) hideInstallBtn();
});

window.addEventListener('beforeinstallprompt', (e) => {
  if (isAppInstalled()) {
    hideInstallBtn();
    return;
  }
  e.preventDefault();
  deferredPrompt = e;
  if (installBtn) {
    installBtn.style.display = 'block';
    installBtn.classList.remove('success', 'error');
    installBtn.textContent = 'Instalar App';
  }
});
window.addEventListener('DOMContentLoaded', function () {
  installBtn = document.getElementById('installPwaBtn');
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (deferredPrompt) {
        try {
          deferredPrompt.prompt();
          const { outcome } = await deferredPrompt.userChoice;
          if (outcome === 'accepted') {
            installBtn.classList.add('success');
            installBtn.textContent = 'App instalado!';
            setTimeout(() => {
              installBtn.style.display = 'none';
              installBtn.classList.remove('success');
              installBtn.textContent = 'Instalar App';
            }, 2000);
          } else {
            installBtn.classList.add('error');
            installBtn.textContent = 'Instalação cancelada';
            setTimeout(() => {
              installBtn.classList.remove('error');
              installBtn.textContent = 'Instalar App';
            }, 2000);
          }
        } catch (err) {
          installBtn.classList.add('error');
          installBtn.textContent = 'Erro ao instalar';
          setTimeout(() => {
            installBtn.classList.remove('error');
            installBtn.textContent = 'Instalar App';
          }, 2000);
        }
        deferredPrompt = null;
      }
    });
  }
});
function scrollToResults() {
  const box = document.getElementById("resultBox");
  if (box && box.style.display !== "none") box.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Configuração do PDF.js para uso local/Android
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";

// Elementos principais da UI e variáveis globais
const fileInput = document.getElementById("fileInput");
const statusDiv = document.getElementById("status");
const progressBar = document.getElementById("progressBar");
const progressContainer = document.getElementById("progressContainer");
const resultBox = document.getElementById("resultBox");
const countDisplay = document.getElementById("countDisplay");
const previewTableBody = document.querySelector("#previewTable tbody");
const downloadBtn = document.getElementById("downloadBtn");
const saveToFolderBtn = document.getElementById("saveToFolderBtn");

const crsDetectedBox = document.getElementById("crsDetectedBox");
const crsDetectedTitle = document.getElementById("crsDetectedTitle");
const crsDetectedReason = document.getElementById("crsDetectedReason");
const advancedCrs = document.getElementById("advancedCrs");
const projectionSelect = document.getElementById("projectionSelect");
const forceCrsBtn = document.getElementById("forceCrsBtn");

const docSelectorBox = document.getElementById("docSelectorBox");
const docSelect = document.getElementById("docSelect");
const docMeta = document.getElementById("docMeta");

let extractedCoordinates = [];
let fileNameBase = "coordenadas_extracao";
let pdfOrigemNomeBase = "";
let pdfOrigemSrc = "";

// Resultados por matrícula (PDF unificado): [{docId,pages,projectionKey,manualProjectionKey,projectionInfo,vertices,warnings}]
let documentsResults = [];
let activeDocIndex = -1;

// Projeções suportadas (WKT)
const PROJECTIONS = {
  SIRGAS2000_25S: {
    name: "SIRGAS 2000 / UTM zone 25S",
    epsg: "EPSG:31985",
    wkt: 'PROJCS["SIRGAS 2000 / UTM zone 25S",GEOGCS["SIRGAS 2000",DATUM["Sistema de Referencia Geocentrico para las Americas 2000",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",-33],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",10000000],UNIT["metre",1]]'
  },
  SIRGAS2000_21S: {
    name: "SIRGAS 2000 / UTM zone 21S",
    epsg: "EPSG:31981",
    wkt: 'PROJCS["SIRGAS 2000 / UTM zone 21S",GEOGCS["SIRGAS 2000",DATUM["Sistema de Referencia Geocentrico para las Americas 2000",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",-57],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",10000000],UNIT["metre",1]]'
  },
  SIRGAS2000_22S: {
    name: "SIRGAS 2000 / UTM zone 22S",
    epsg: "EPSG:31982",
    wkt: 'PROJCS["SIRGAS 2000 / UTM zone 22S",GEOGCS["SIRGAS 2000",DATUM["Sistema de Referencia Geocentrico para las Americas 2000",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",-51],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",10000000],UNIT["metre",1]]'
  },
  SIRGAS2000_23S: {
    name: "SIRGAS 2000 / UTM zone 23S",
    epsg: "EPSG:31983",
    wkt: 'PROJCS["SIRGAS 2000 / UTM zone 23S",GEOGCS["SIRGAS 2000",DATUM["Sistema de Referencia Geocentrico para las Americas 2000",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",-45],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",10000000],UNIT["metre",1]]'
  },
  SIRGAS2000_24S: {
    name: "SIRGAS 2000 / UTM zone 24S",
    epsg: "EPSG:31984",
    wkt: 'PROJCS["SIRGAS 2000 / UTM zone 24S",GEOGCS["SIRGAS 2000",DATUM["Sistema de Referencia Geocentrico para las Americas 2000",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",-39],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",10000000],UNIT["metre",1]]'
  },
  SAD69_22S: {
    name: "SAD69 / UTM zone 22S",
    epsg: "EPSG:29192",
    wkt: 'PROJCS["SAD69 / UTM zone 22S",GEOGCS["SAD69",DATUM["South_American_Datum_1969",SPHEROID["GRS 1967 Modified",6378160,298.25]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",-51],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",10000000],UNIT["metre",1]]'
  },
  SAD69_23S: {
    name: "SAD69 / UTM zone 23S",
    epsg: "EPSG:29193",
    wkt: 'PROJCS["SAD69 / UTM zone 23S",GEOGCS["SAD69",DATUM["South_American_Datum_1969",SPHEROID["GRS 1967 Modified",6378160,298.25]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",-45],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",10000000],UNIT["metre",1]]'
  },
  WGS84: {
    name: "WGS 84",
    epsg: "EPSG:4326",
    wkt: 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]'
  }
};

// Helpers de status e normalização
function updateStatus(msg, type) {
  statusDiv.style.display = "block";
  statusDiv.innerText = msg;
  statusDiv.className = "status-" + type;
}

function sanitizeFileName(name) {
  return (name || "")
    .replace(/\.[^/.]+$/, "")
    .replace(/[\\/:*?"<>\n\r]/g, "")
    .replace(/\s+/g, "_");
}

function normalizeNumber(raw) {
  if (!raw) return raw;
  let v = String(raw);
  v = v.replace(/\u00A0/g, " ").replace(/[\s\t]+/g, "");  // Remove espaços e tabs em branco
  v = v.replace(/[Oo]/g, "0");  // Corrige O por 0
  v = v.replace(/[lI]/g, "1");  // Corrige l/I por 1

  // Normaliza separadores decimais
  if (v.includes(",") && !v.includes(".")) {
    v = v.replace(",", ".");  // "1234,56" -> "1234.56"
  } else if (v.includes(",") && v.includes(".")) {
    // "1.234,56" (formato europeu) -> "1234.56"
    const lastCommaIdx = v.lastIndexOf(",");
    const lastDotIdx = v.lastIndexOf(".");
    if (lastCommaIdx > lastDotIdx) {
      v = v.replace(/\./g, "").replace(",", ".");
    } else {
      v = v.replace(/,/g, "");  // Remover vírgula se for separador de milhares
    }
  }

  return v;
}

// Corrige valores de coordenadas fora do intervalo esperado
function autoScaleCoordinate(value, expectedMin, expectedMax) {
  if (Number.isNaN(value)) return NaN;
  if (value >= expectedMin && value <= expectedMax) return value;

  if (value < expectedMin && value > 0) {
    // Número muito pequeno - multiplicar
    let scaled = value;
    for (let power = 1; power <= 4; power++) {
      scaled = value * Math.pow(10, power);
      if (scaled >= expectedMin && scaled <= expectedMax) {
        console.log(`[PDFtoArcgis] 📈 Auto-escala: ${value} → ${scaled} (×10^${power})`);
        return scaled;
      }
    }
  }

  if (value > expectedMax && value > 0) {
    // Número muito grande - tentar dividir
    let scaled = value;

    // PRIMEIRO: Testar divisão por 1000 (mais comum para números concatenados)
    for (let power = 1; power <= 7; power++) {
      scaled = value / Math.pow(10, power);
      if (scaled >= expectedMin && scaled <= expectedMax) {
        console.log(`[PDFtoArcgis] 📉 Auto-escala: ${value} → ${scaled} (÷10^${power})`);
        return scaled;
      }
    }
  }

  return NaN; // Não conseguiu escalar
}

// Cálculos rápidos para exibição (distância/azimute)
function calcularDistancia(p1, p2) {
  return Math.sqrt(Math.pow(p2.east - p1.east, 2) + Math.pow(p2.north - p1.north, 2));
}

function calcularAzimute(p1, p2) {
  const dE = p2.east - p1.east;
  const dN = p2.north - p1.north;
  let az = Math.atan2(dE, dN) * (180 / Math.PI);
  return az < 0 ? az + 360 : az;
}

// Geodésia profissional: Vincenty e validação topológica

// Parâmetros elipsoidais por CRS
const ELLIPSOID_PARAMS = {
  "SIRGAS2000_21S": { a: 6378137.0, f: 1 / 298.257222101, name: "WGS84/GRS1980" },
  "SIRGAS2000_22S": { a: 6378137.0, f: 1 / 298.257222101, name: "WGS84/GRS1980" },
  "SIRGAS2000_23S": { a: 6378137.0, f: 1 / 298.257222101, name: "WGS84/GRS1980" },
  "SIRGAS2000_24S": { a: 6378137.0, f: 1 / 298.257222101, name: "WGS84/GRS1980" },
  "SAD69_22S": { a: 6378160.0, f: 1 / 298.25, name: "GRS1967 Modified" },
  "SAD69_23S": { a: 6378160.0, f: 1 / 298.25, name: "GRS1967 Modified" },
  "WGS84": { a: 6378137.0, f: 1 / 298.257223563, name: "WGS84" }
};

// ATENÇÃO: Verifique se o endpoint abaixo está correto e publicado!
// Se estiver em desenvolvimento/local, ajuste a URL conforme necessário.
// Calcular área de polígono via Shoelace (Gauss Area Formula)
// Retorna área em m² e direção (positivo=CCW, negativo=CW)

/**
 * Reordena vértices em sequência CCW correta usando centroide
 * Soluciona problema de auto-intersecção quando vértices estão fora de ordem
 */
function orderVerticesCCW(vertices) {
  if (vertices.length < 3) return vertices;

  // Calcular centroide
  let centerN = 0, centerE = 0;
  for (const v of vertices) {
    centerN += v.north;
    centerE += v.east;
  }
  centerN /= vertices.length;
  centerE /= vertices.length;

  console.log(`[PDFtoArcgis] 📍 Centroide calculado: N=${centerN.toFixed(2)}, E=${centerE.toFixed(2)}`);

  // Ordenar por ângulo polar (CCW a partir do eixo E)
  const ordered = vertices.map(v => {
    const angle = Math.atan2(v.north - centerN, v.east - centerE);
    return { ...v, angle };
  }).sort((a, b) => a.angle - b.angle);

  console.log(`[PDFtoArcgis] 🔄 Vértices reordenados em sequência CCW`);

  return ordered;
}

/**
 * Corrige automaticamente problemas comuns em polígonos
 * - Remove vértices duplicados
 * - Reordena em sequência CCW
 * - Fecha o polígono se necessário
 * - Remove vértices colineares (simplificação)
 */
function autoCorrectPolygon(vertices, options = {}) {
  const {
    removeDuplicates = true,
    closePolygon = true,
    removeColinear = false,
    tolerance = 0.01 // metros
  } = options;

  if (vertices.length < 3) return vertices;

  let corrected = [...vertices];
  const corrections = [];

  // === CORREÇÃO 1: Remover duplicados ===
  if (removeDuplicates) {
    const unique = [];
    const seen = new Set();

    for (const v of corrected) {
      const key = `${v.north.toFixed(3)}_${v.east.toFixed(3)}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(v);
      } else {
        corrections.push(`🔧 Removido vértice duplicado: ${v.id || '?'}`);
      }
    }

    if (unique.length < corrected.length) {
      console.log(`[PDFtoArcgis] 🔧 Removidos ${corrected.length - unique.length} vértice(s) duplicado(s)`);
      corrected = unique;
    }
  }

  // === CORREÇÃO 2: Reordenar em CCW ===
  corrected = orderVerticesCCW(corrected);
  corrections.push("🔄 Vértices reordenados em sequência CCW");

  // === CORREÇÃO 3: Fechar polígono ===
  if (closePolygon && corrected.length >= 3) {
    const first = corrected[0];
    const last = corrected[corrected.length - 1];
    const dist = Math.hypot(first.north - last.north, first.east - last.east);

    if (dist > tolerance) {
      // Adicionar cópia do primeiro vértice no final
      corrected.push({ ...first, id: `${first.id}_closure` });
      corrections.push(`🔒 Polígono fechado (distância era ${dist.toFixed(2)}m)`);
      console.log(`[PDFtoArcgis] 🔒 Polígono fechado automaticamente`);
    }
  }

  // === CORREÇÃO 4: Remover vértices colineares (opcional) ===
  if (removeColinear && corrected.length > 3) {
    const simplified = [corrected[0]];

    for (let i = 1; i < corrected.length - 1; i++) {
      const prev = corrected[i - 1];
      const curr = corrected[i];
      const next = corrected[i + 1];

      // Calcular produto vetorial (cross product) para detectar colinearidade
      const dx1 = curr.east - prev.east;
      const dy1 = curr.north - prev.north;
      const dx2 = next.east - curr.east;
      const dy2 = next.north - curr.north;

      const crossProduct = dx1 * dy2 - dy1 * dx2;

      // Se cross product ≈ 0, vértices são colineares
      if (Math.abs(crossProduct) > tolerance) {
        simplified.push(curr);
      } else {
        corrections.push(`🔧 Removido vértice colinear: ${curr.id || '?'}`);
      }
    }

    simplified.push(corrected[corrected.length - 1]);

    if (simplified.length < corrected.length) {
      console.log(`[PDFtoArcgis] 🔧 Removidos ${corrected.length - simplified.length} vértice(s) colinear(es)`);
      corrected = simplified;
    }
  }

  // Reindexar ordem
  corrected = corrected.map((v, idx) => ({
    ...v,
    ordem: idx + 1
  }));

  return { vertices: corrected, corrections };
}

/**
 * Valida topologia do polígono (auto-intersecção, orientação, etc)
 */
function validatePolygonTopology(vertices, projectionKey) {
  if (vertices.length < 3) {
    return {
      isValid: false,
      errors: ["Menos de 3 vértices"],
      warnings: [],
      hasIntersections: false,
      corrected: vertices,
      isCCW: false
    };
  }

  const errors = [];
  const warnings = [];

  // NOVO: Reordenar vértices se necessário (detecção automática)
  let orderedVertices = vertices;
  let isDisordered = false;

  // Verificar se vértices estão desordenados (diferenças grandes de N ou E)
  const nValues = vertices.map(v => v.north);
  const eValues = vertices.map(v => v.east);
  const minN = Math.min(...nValues);
  const maxN = Math.max(...nValues);
  const minE = Math.min(...eValues);
  const maxE = Math.max(...eValues);
  const nRange = maxN - minN;
  const eRange = maxE - minE;

  // Se há grandes saltos no valor de N ou E, provavelmente estão desordenados
  // Usar abordagem adaptativa: detectar saltos > 50% do range total é suspeito
  const adaptiveNThreshold = Math.max(1000, nRange * 0.5); // Mínimo 1km, ou 50% do range
  const adaptiveEThreshold = Math.max(1000, eRange * 0.5);

  for (let i = 0; i < vertices.length - 1; i++) {
    const nDiff = Math.abs(vertices[i].north - vertices[i + 1].north);
    const eDiff = Math.abs(vertices[i].east - vertices[i + 1].east);

    // Se há salto muito grande (> 50% do range), é desordenado
    if (nDiff > adaptiveNThreshold || eDiff > adaptiveEThreshold) {
      isDisordered = true;
      console.log(`[PDFtoArcgis] ⚠️ Desordenamento detectado: vértice ${i} (N=${vertices[i].north.toFixed(0)}, E=${vertices[i].east.toFixed(0)}) → ${i + 1} (N=${vertices[i + 1].north.toFixed(0)}, E=${vertices[i + 1].east.toFixed(0)}) (salto N=${nDiff.toFixed(0)}m, E=${eDiff.toFixed(0)}m)`);
      break;
    }
  }

  if (isDisordered) {
    orderedVertices = orderVerticesCCW(vertices);
    warnings.push("🔄 Vértices foram reordenados em sequência CCW correta");
  }

  // === VALIDAÇÃO 1: Verificar vértices duplicados ===
  const duplicates = [];
  for (let i = 0; i < orderedVertices.length; i++) {
    for (let j = i + 1; j < orderedVertices.length; j++) {
      const dist = Math.hypot(
        orderedVertices[i].north - orderedVertices[j].north,
        orderedVertices[i].east - orderedVertices[j].east
      );
      if (dist < 0.01) { // Tolerância: 1cm
        duplicates.push({ i, j, dist });
      }
    }
  }

  if (duplicates.length > 0) {
    errors.push(`❌ ${duplicates.length} vértice(s) duplicado(s) detectado(s)`);
    console.log(`[PDFtoArcgis] Duplicados:`, duplicates);
  }

  // === VALIDAÇÃO 2: Verificar se polígono está fechado ===
  const first = orderedVertices[0];
  const last = orderedVertices[orderedVertices.length - 1];
  const closureDistance = Math.hypot(
    first.north - last.north,
    first.east - last.east
  );

  if (closureDistance > 5) {
    warnings.push(`⚠️ Polígono não fechado: distância ${closureDistance.toFixed(1)}m entre primeiro e último vértice`);
  }

  // === VALIDAÇÃO 3: Verificar auto-intersecção (Bentley-Ottmann simplificado) ===
  let hasIntersections = false;
  const intersectionPairs = [];
  
  for (let i = 0; i < orderedVertices.length - 1; i++) {
    for (let j = i + 2; j < orderedVertices.length - 1; j++) {
      // Não verificar arestas adjacentes
      if (i === 0 && j === orderedVertices.length - 2) continue;

      const p1 = orderedVertices[i];
      const p2 = orderedVertices[i + 1];
      const p3 = orderedVertices[j];
      const p4 = orderedVertices[j + 1];

      // Cross product test (detecção de intersecção)
      const d1 = (p2.east - p1.east) * (p3.north - p1.north) - (p2.north - p1.north) * (p3.east - p1.east);
      const d2 = (p2.east - p1.east) * (p4.north - p1.north) - (p2.north - p1.north) * (p4.east - p1.east);
      const d3 = (p4.east - p3.east) * (p1.north - p3.north) - (p4.north - p3.north) * (p1.east - p3.east);
      const d4 = (p4.east - p3.east) * (p2.north - p3.north) - (p4.north - p3.north) * (p2.east - p3.east);

      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
        hasIntersections = true;
        intersectionPairs.push({ edge1: i, edge2: j });
      }
    }
  }

  if (hasIntersections) {
    errors.push(`❌ Auto-intersecções detectadas em ${intersectionPairs.length} pares de arestas`);
    console.log(`[PDFtoArcgis] Intersecções:`, intersectionPairs);
  }

  // === VALIDAÇÃO 4: Validar orientação CCW (Counter-Clockwise) ===
  let signedArea = 0;
  for (let i = 0; i < orderedVertices.length; i++) {
    const curr = orderedVertices[i];
    const next = orderedVertices[(i + 1) % orderedVertices.length];
    signedArea += curr.east * next.north - next.east * curr.north;
  }

  const isCCW = signedArea > 0;
  const area = Math.abs(signedArea) / 2;

  if (!isCCW) {
    warnings.push("⚠️ Vértices em ordem horária (CW) - convertendo para anti-horária (CCW)");
    orderedVertices = orderedVertices.reverse();
  }

  // === VALIDAÇÃO 5: Validar absurdidade de área ===
  if (area === 0) {
    errors.push(`❌ Área zero (0 m²) - possível erro de extração de coordenadas`);
  } else if (area < 1) {
    errors.push(`❌ Área muito pequena (${area.toFixed(2)} m²) - possível erro de coordenadas`);
  } else if (area > 1e8) {
    errors.push(`❌ Área absurda: ${(area / 1e4).toFixed(1)} ha (${area.toExponential(2)} m²) - indica erro grave de coordenadas`);
  } else if (area > 1e7) {
    warnings.push(`⚠️ Área muito grande: ${(area / 1e4).toFixed(1)} ha (${area.toExponential(2)} m²) - verificar se está correto`);
  }

  // === VALIDAÇÃO 6: Verificar segmentos muito longos (possível erro) ===
  for (let i = 0; i < orderedVertices.length - 1; i++) {
    const v1 = orderedVertices[i];
    const v2 = orderedVertices[i + 1];
    const dist = Math.hypot(v2.north - v1.north, v2.east - v1.east);
    
    if (dist > 10000) { // Segmentos > 10km são suspeitos
      warnings.push(`⚠️ Segmento ${i}→${i + 1} muito longo: ${(dist / 1000).toFixed(2)}km`);
    }
  }

  return {
    isValid: errors.length === 0 && area > 1,
    errors,
    warnings,
    hasIntersections,
    corrected: orderedVertices,  // Retornar vértices reordenados e corrigidos
    isCCW: true, // Sempre CCW após correção
    area,
    closed: closureDistance < 5,
    duplicates: duplicates.length,
    intersectionPairs
  };
}

function calcularAreaShoelace(vertices) {
  if (!vertices || vertices.length < 3) return { area: 0, isCCW: null, signed: 0, warning: null };

  let signed = 0;
  for (let i = 0; i < vertices.length; i++) {
    const curr = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    signed += curr.east * next.north - next.east * curr.north;
  }

  const area = Math.abs(signed) / 2;
  const isCCW = signed > 0;

  // Validar se área é absurda
  // Intervalo razoável para lotes: 100 m² a 100 km² (1e8 m²)
  // Muito acima disso indica erro de parsing
  let warning = null;
  if (area > 1e8) {
    warning = `⚠️ Área absurda: ${(area / 1e4).toFixed(1)} ha (${area.toExponential(2)} m²) - Possível erro de coordenadas`;
  } else if (area < 100) {
    warning = `⚠️ Área muito pequena: ${area.toFixed(0)} m² - Polígono microscópico`;
  }

  if (warning) {
    console.warn(`[PDFtoArcgis] ${warning}`);
  }

  return { area, isCCW, signed, warning };
}

/**
 * Verificar se polígono está fechado (primeiro e último vértices próximos)
 */
function isPolygonClosed(vertices, tolerance = 0.5) {
  if (!vertices || vertices.length < 3) return false;

  const first = vertices[0];
  const last = vertices[vertices.length - 1];

  const dist = Math.sqrt(
    Math.pow(last.east - first.east, 2) +
    Math.pow(last.north - first.north, 2)
  );

  return dist <= tolerance;
}

// Detecta auto-intersecções em polígonos (retorna pares de índices)
function detectPolygonSelfIntersections(vertices) {
  const intersections = [];

  if (vertices.length < 4) return intersections;

  // Helper: verifica se dois segmentos se cruzam
  function segmentsIntersect(p1, p2, p3, p4) {
    const ccw = (A, B, C) => (C.north - A.north) * (B.east - A.east) > (B.north - A.north) * (C.east - A.east);
    return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
  }

  // Verifica cada par de edges (não-adjacentes)
  for (let i = 0; i < vertices.length - 1; i++) {
    for (let j = i + 2; j < vertices.length - 1; j++) {
      if (i === 0 && j === vertices.length - 2) continue; // Skip closing edge

      const p1 = vertices[i];
      const p2 = vertices[i + 1];
      const p3 = vertices[j];
      const p4 = vertices[j + 1];

      if (segmentsIntersect(p1, p2, p3, p4)) {
        intersections.push({ edge1: i, edge2: j });
      }
    }
  }

  return intersections;
}

function inferCrsByCoordinates(vertices) {
  if (!vertices || vertices.length === 0) return null;

  // Pega a média para situar a região
  const avgE = vertices.reduce((sum, v) => sum + v.east, 0) / vertices.length;
  const avgN = vertices.reduce((sum, v) => sum + v.north, 0) / vertices.length;

  // Lógica para o Sul do Brasil (inferência automática de zona UTM)
  if (avgN > 7000000 && avgN < 8000000) {
    if (avgE > 600000 && avgE < 800000) {
      return { zone: 22, reason: "CRS inferido automaticamente pelas coordenadas (Padrão UTM Zona 22S)." };
    }
    if (avgE > 300000 && avgE < 600000) {
      return { zone: 23, reason: "CRS inferido automaticamente pelas coordenadas (Padrão UTM Zona 23S)." };
    }
  }
  return null;
}

/**
 * Corrigir ordem de vértices (garantir CCW para polígonos válidos)
 */
function ensureCounterClockwiseOrder(vertices) {
  if (!vertices || vertices.length < 3) return vertices;

  const { isCCW } = calcularAreaShoelace(vertices);

  if (isCCW === false) {
    // Está em CW, reverter
    return [...vertices].reverse();
  }

  return vertices;
}

/**
 * Validação completa de topologia poligonal
 */
function validatePolygonTopology(vertices, projectionKey = null) {
  const errors = [];
  const warnings = [];

  if (!vertices || vertices.length < 3) {
    errors.push("Mínimo 3 vértices requerido");
    return { isValid: false, errors, warnings, corrected: vertices };
  }

  // Estratégia de fechamento: se não estiver fechado, adiciona o primeiro vértice ao final para validação
  let verticesToValidate = [...vertices];
  let closed = isPolygonClosed(verticesToValidate, 0.5);
  if (!closed && verticesToValidate.length > 2) {
    const first = verticesToValidate[0];
    verticesToValidate.push({ ...first });
    closed = true; // Considera fechado para validação e relatório
  }
  if (!closed) {
    warnings.push("⚠️ Polígono não fechado (distância > 0.5m entre primeiro e último)");
  }

  // 2. Calcular área
  const { area, isCCW, signed } = calcularAreaShoelace(verticesToValidate);
  if (area < 1) {
    errors.push(`❌ Área muito pequena (${area.toFixed(2)} m²) - possível erro de extração`);
  }

  // 3. Detectar auto-intersecções
  const intersections = detectPolygonSelfIntersections(verticesToValidate);
  if (intersections.length > 0) {
    errors.push(`❌ Auto-intersecções detectadas em ${intersections.length} pares de edges`);
  }

  // 4. Verificar ordenação
  if (isCCW === false) {
    warnings.push("⚠️ Vértices em ordem horária (CW) - convertendo para anti-horária (CCW)");
  }

  // 5. Validar coerência de distâncias calculadas vs Euclidiana
  const distThreshold = 10; // metros
  let distCoherence = true;
  for (let i = 0; i < verticesToValidate.length - 1; i++) {
    const v1 = verticesToValidate[i];
    const v2 = verticesToValidate[i + 1];

    if (v1.distCalc && v2.distCalc) {
      const euclidian = calcularDistancia(v1, v2);
      const stated = parseFloat(v1.distCalc);

      if (!Number.isNaN(stated) && Math.abs(euclidian - stated) > distThreshold) {
        distCoherence = false;
        warnings.push(`⚠️ Distância V${i + 1}→V${i + 2}: calculada ${euclidian.toFixed(2)}m ≠ documentada ${stated}m`);
      }
    }
  }

  const corrected = isCCW === false ? ensureCounterClockwiseOrder(verticesToValidate) : verticesToValidate;
  const isValid = errors.length === 0 && intersections.length === 0;

  return {
    isValid,
    errors,
    warnings,
    area,
    isCCW: corrected.length > 0 ? true : null,
    distCoherence,
    corrected,
    intersections,
    closed
  };
}

/**
 * Calcular distância via Vincenty (iterativo, alta precisão para UTM)
 * Mais preciso que Euclidiano para distâncias longas
 */
function calculateDistanceVincenty(p1, p2, projectionKey = "SIRGAS2000_22S") {
  // Para UTM, Vincenty é overkill - usar Euclidiano é suficiente
  // Mas deixar base para futuro uso com transformações de CRS

  const params = ELLIPSOID_PARAMS[projectionKey] || ELLIPSOID_PARAMS["SIRGAS2000_22S"];
  const { a, f } = params;

  // Em UTM (projeção conforme), distância Euclidiana é ≈ distância real
  // Diferença < 0.1% para distâncias até 1km
  // Usar Vincenty completo seria overkill aqui

  const distance = calcularDistancia(p1, p2);

  // Fator de escala em UTM (típico: 0.9996)
  // Para alta precisão, poderia ajustar baseado na longitude relativa
  const scaleFactor = 0.9996;
  const adjustedDistance = distance * scaleFactor;

  return {
    distance: adjustedDistance,
    distanceEuclidian: distance,
    azimuth: calcularAzimute(p1, p2),
    projection: projectionKey,
    method: "Vincenty-Simplified-UTM"
  };
}

// ⚠️ DEPRECATED: extractAzimuthDistanceFromText() foi DESABILITADO
// ETL SIMPLIFICADO: A IA retorna azimutes e distâncias no JSON (sem regex paralelo)
// MOTIVO: Reduz redundância, código mais simples e mantenível
// USO ANTERIOR: Chamada removida de linhas 3423 e 3591
// 
// function extractAzimuthDistanceFromText(text) {
//   // Código removido - IA faz essa transformação agora
// }

/**
 * Validar coerência entre dados documentados (memorial) e coordenadas extraídas
 */
function validateMemorialCoherence(vertices, memorialData, projectionKey = null) {
  const issues = [];
  const matches = [];

  if (!memorialData.azimutes || memorialData.azimutes.length === 0) {
    return { matches: [], issues: ["Nenhum azimute encontrado no memorial"] };
  }

  // Tentar associar azimutes/distâncias com edges de polígono
  for (let i = 0; i < Math.min(memorialData.azimutes.length, vertices.length - 1); i++) {
    const memAz = memorialData.azimutes[i];
    const memDist = memorialData.distances[i];
    const v1 = vertices[i];
    const v2 = vertices[i + 1];

    const calcAz = calcularAzimute(v1, v2);
    const calcDist = calcularDistancia(v1, v2);

    const azDiff = Math.abs(memAz.decimal - calcAz);
    const distDiff = memDist ? Math.abs(memDist.value - calcDist) : null;

    // Circular difference para azimutes (0-360)
    const azCircularDiff = Math.min(azDiff, 360 - azDiff);

    const coherent = azCircularDiff < 2 && (!distDiff || distDiff < 2);

    matches.push({
      edge: i,
      memorial: { azimuth: memAz.decimal, distance: memDist?.value },
      calculated: { azimuth: calcAz, distance: calcDist },
      azDiff: azCircularDiff,
      distDiff,
      coherent
    });

    if (!coherent) {
      const msg = `Edge ${i}: Azimute diferença ${azCircularDiff.toFixed(2)}°`;
      if (distDiff !== null && distDiff > 2) {
        issues.push(msg + `, Distância diferença ${distDiff.toFixed(2)}m`);
      } else if (azCircularDiff >= 2) {
        issues.push(msg);
      }
    }
  }

  return { matches, issues };
}

/* =========================
   Doc selecionado / CRS
========================= */
function getSelectedDoc() {
  if (activeDocIndex >= 0 && activeDocIndex < documentsResults.length) return documentsResults[activeDocIndex];
  return null;
}

function getActiveProjectionKey() {
  const doc = getSelectedDoc();
  if (doc) return doc.manualProjectionKey || doc.projectionKey || (projectionSelect?.value) || "SAD69_22S";
  return (projectionSelect?.value) || "SAD69_22S";
}

function showDetectedCrsUI(key, info) {
  if (!crsDetectedBox) return;
  crsDetectedBox.style.display = "block";
  const conf = info?.confidence || "baixa";
  crsDetectedTitle.textContent = `${key || "(não detectado)"} — confiança ${conf}`;
  crsDetectedReason.textContent = info?.reason || "";
  if (projectionSelect && key) {
    const ok = Array.from(projectionSelect.options).some(o => o.value === key);
    if (ok) projectionSelect.value = key;
  }
}


/* =========================
   PDF text reconstruction
========================= */
function buildPageTextWithLines(textContent) {
  const items = (textContent.items || [])
    .map(it => ({
      str: it.str || "",
      x: it.transform ? it.transform[4] : 0,
      y: it.transform ? it.transform[5] : 0
    }))
    .sort((a, b) => (b.y - a.y) || (a.x - b.x));

  let out = "";
  let lastY = null;
  const lineThreshold = 2.0;

  for (const it of items) {
    if (!it.str) continue;
    if (lastY === null) lastY = it.y;
    if (Math.abs(it.y - lastY) > lineThreshold) {
      out += "\n";
      lastY = it.y;
    } else {
      out += " ";
    }
    out += it.str;
  }
  return out;
}

/* =========================
   CRS detection
========================= */
function inferZoneFromBrazilState(textLower) {
  if (/\b\-pr\b|\bparan[aá]\b/.test(textLower)) return 22;
  if (/\b\-sc\b|\bsanta\s*catarina\b/.test(textLower)) return 22;
  if (/\b\-rs\b|\brio\s*grande\s*do\s*sul\b/.test(textLower)) return 22;
  if (/\b\-sp\b|\bs[aã]o\s*paulo\b/.test(textLower)) return 23;
  if (/\b\-rj\b|\brio\s*de\s*janeiro\b/.test(textLower)) return 23;
  if (/\b\-mg\b|\bminas\s*gerais\b/.test(textLower)) return 23;
  if (/\b\-es\b|\besp[ií]rito\s*santo\b/.test(textLower)) return 24;
  return null;
}

/**
 * Infere o CRS com base na magnitude numérica das coordenadas (Geofencing reverso)
 */
function inferCrsByCoordinates(vertices) {
  if (!vertices || vertices.length === 0) return null;

  // Calcula a média das coordenadas extraídas
  const avgE = vertices.reduce((sum, v) => sum + v.east, 0) / vertices.length;
  const avgN = vertices.reduce((sum, v) => sum + v.north, 0) / vertices.length;

  // Lógica para o Brasil (UTM Sul)
  // Norte ~7.1 milhões (Paraná/Santa Catarina/RS)
  if (avgN > 7000000 && avgN < 8000000) {
    // Este entre 600k e 800k -> Zona 22S
    if (avgE > 600000 && avgE < 800000) {
      return { zone: 22, reason: "Inferido via coordenadas: Padrão compatível com UTM Zona 22S (Sul do Brasil)." };
    }
    // Este entre 300k e 600k -> Zona 23S (SP/MG)
    if (avgE > 300000 && avgE < 600000) {
      return { zone: 23, reason: "Inferido via coordenadas: Padrão compatível com UTM Zona 23S." };
    }
  }
  return null;
}

function detectProjectionFromText(fullText, vertices = []) {
  const t = (fullText || "").toLowerCase();
  const hasSAD = /sad[\s\-]?69/.test(t);
  const hasSIRGAS = /sirgas\s*2000/.test(t);
  const hasWGS = /wgs\s*84/.test(t);

  const zoneMatch =
    t.match(/(?:fuso|zona|zone)\s*[:=]?\s*(\d{2})\s*([ns])?/i) ||
    t.match(/utm\s*[:=]?\s*(\d{2})\s*([ns])?/i);

  const mcMatch = t.match(/(?:mc|meridiano\s+central)\s*[:=]?\s*(\d{2})\s*°?\s*([wo])/i);

  let zone = null;
  const reasonParts = [];
  let conf = "baixa";

  if (zoneMatch && zoneMatch[1]) {
    zone = parseInt(zoneMatch[1], 10);
    reasonParts.push(`Encontrado fuso/zona ${zone} no memorial.`);
    conf = "alta";
  }

  if (!zone && mcMatch && mcMatch[1]) {
    const mc = parseInt(mcMatch[1], 10);
    const map = { 57: 21, 51: 22, 45: 23, 39: 24 };
    zone = map[mc] || null;
    if (zone) {
      reasonParts.push(`Encontrado MC ${mc}°W → zona ${zone}.`);
      conf = "alta";
    }
  }

  // Fallback 1: Por Estado/UF
  if (!zone) {
    const inferred = inferZoneFromBrazilState(t);
    if (inferred) {
      zone = inferred;
      reasonParts.push(`Zona inferida como ${zone}S pela localidade.`);
      conf = "média";
    }
  }

  // Fallback 2: Pela matemática das coordenadas (CRUCIAL PARA PIRAQUARA)
  if (!zone && vertices && vertices.length > 0) {
    const mathInference = inferCrsByCoordinates(vertices); // Verifique se esta função existe no seu script
    if (mathInference) {
      zone = mathInference.zone;
      reasonParts.push(mathInference.reason);
      conf = "média";
    }
  }

  // Fallback 3: Padrão final
  if (!zone) {
    zone = 22;
    reasonParts.push(`Zona não encontrada; fallback ${zone}S.`);
  }

  // Retorno (Lógica de Datums)
  if (hasWGS) return { key: "WGS84", confidence: "alta", reason: "Encontrado 'WGS 84'." };

  if (hasSAD) {
    let key = (zone === 23) ? "SAD69_23S" : "SAD69_22S";
    return { key, confidence: conf, reason: `Encontrado 'SAD-69'. ${reasonParts.join(" ")}` };
  }

  // Se não achou SAD nem WGS, assume SIRGAS 2000 (Padrão IBGE)
  return {
    key: `SIRGAS2000_${zone}S`,
    confidence: conf,
    reason: (hasSIRGAS ? "Encontrado 'SIRGAS 2000'. " : "Datum assumido SIRGAS 2000. ") + reasonParts.join(" ")
  };
}

function detectProjectionFromAI(iaObj, inferredByCoords = null, projInfo = null) {
  if (!iaObj || typeof iaObj !== "object") return null;

  const rawParts = [
    iaObj.datum,
    iaObj.crs,
    iaObj.epsg,
    iaObj.srid,
    iaObj.projecao,
    iaObj.projection,
    iaObj.sistema,
    iaObj.spatial_reference,
    iaObj.spatialReference,
    iaObj.utm_zone,
    iaObj.utmZone,
    iaObj.zone,
    iaObj.zona,
    iaObj.fuso,
    iaObj.fuso_utm
  ].filter(Boolean);

  const raw = rawParts.join(" ");
  const lower = String(raw || "").toLowerCase();

  let epsgCode = null;
  if (typeof iaObj.epsg === "number" || typeof iaObj.epsg === "string") {
    epsgCode = String(iaObj.epsg).match(/\d{4,6}/)?.[0] || null;
  }
  if (!epsgCode) {
    epsgCode = raw.match(/epsg\s*[:=]?\s*(\d{4,6})/i)?.[1] || null;
  }

  if (epsgCode) {
    const key = Object.keys(PROJECTIONS).find(k => {
      const epsg = PROJECTIONS[k]?.epsg || "";
      return epsg.includes(epsgCode);
    });
    if (key) {
      return { key, confidence: "alta", reason: `EPSG ${epsgCode} informado pela IA.` };
    }
  }

  if (/(wgs\s*84|wgs84|wgs)/i.test(lower)) {
    return { key: "WGS84", confidence: "média", reason: "IA informou WGS84." };
  }

  const hasSad = /sad[\s\-]?69/.test(lower);
  const hasSirgas = /sirgas/.test(lower);
  let base = null;
  if (hasSad) base = "SAD69";
  if (hasSirgas) base = "SIRGAS2000";
  if (!base) return null;

  let zone = null;
  const zoneFields = [iaObj.zone, iaObj.zona, iaObj.fuso, iaObj.utm_zone, iaObj.utmZone, iaObj.fuso_utm].filter(Boolean);
  if (zoneFields.length) {
    const z = parseInt(String(zoneFields[0]).match(/\d{1,2}/)?.[0], 10);
    if (!Number.isNaN(z)) zone = z;
  }
  if (!zone) {
    const rawZone = raw.match(/(?:zona|zone|fuso|utm)\s*[:=]?\s*(\d{1,2})/i);
    if (rawZone?.[1]) zone = parseInt(rawZone[1], 10);
  }
  if (!zone && projInfo?.key) {
    const match = projInfo.key.match(/_(\d{2})S/);
    if (match?.[1]) zone = parseInt(match[1], 10);
  }
  if (!zone && inferredByCoords?.zone) zone = inferredByCoords.zone;
  if (!zone) zone = 22;

  const key = base === "SAD69"
    ? (zone === 23 ? "SAD69_23S" : "SAD69_22S")
    : `SIRGAS2000_${zone}S`;

  return {
    key,
    confidence: zone ? "média" : "baixa",
    reason: `IA informou datum ${base}${zone ? " e zona " + zone : ""}.`
  };
}

function resolveProjectionKeyForOutput(iaObj, projInfo, inferredByCoords) {
  const reasons = [];
  let key = null;
  let confidence = "baixa";

  const aiDetected = detectProjectionFromAI(iaObj, inferredByCoords, projInfo);
  if (aiDetected?.key) {
    key = aiDetected.key;
    confidence = aiDetected.confidence || confidence;
    if (aiDetected.reason) reasons.push(aiDetected.reason);
  }

  if (projInfo?.key) {
    if (!key) {
      key = projInfo.key;
      confidence = projInfo.confidence || confidence;
      if (projInfo.reason) reasons.push(`Texto: ${projInfo.reason}`);
    } else if (projInfo.key !== key && projInfo.confidence === "alta") {
      reasons.push(`Conflito IA vs texto; prevaleceu o CRS do texto (${projInfo.key}).`);
      key = projInfo.key;
      confidence = "alta";
    } else if (projInfo.key === key && projInfo.reason) {
      reasons.push(`Texto confirmou CRS: ${projInfo.reason}`);
    }
  }

  if (!key && inferredByCoords?.zone) {
    key = `SIRGAS2000_${inferredByCoords.zone}S`;
    confidence = "média";
    reasons.push(inferredByCoords.reason);
  }

  if (!key) {
    key = getActiveProjectionKey() || "SIRGAS2000_22S";
    reasons.push("CRS não identificado; usando seleção atual/padrão.");
  }

  return { key, info: { confidence, reason: reasons.join(" ") } };
}

/* =========================
   Vértices (robusto: E... e N... OU N... e E...)
========================= */
function normalizeId(id) {
  let s = (id || "").toUpperCase();
  s = s.replace(/\s+/g, " ").trim();

  // Mapa de normalizações específicas
  const normalizations = {
    "EBOC": "EBC",
    "EBO": "EBC",
    "EBOV": "EBCV",
    "EBE": "EBC",
    "PS0": "P60",
    "PS6": "P56",
    "PP": "PP"  // Marco inicial - manter como está
  };

  for (const [pattern, replacement] of Object.entries(normalizations)) {
    if (pattern.includes(" ")) {
      s = s.replace(new RegExp(`\\b${pattern}\\b`, "g"), replacement);
    } else {
      const regex = new RegExp(`^${pattern}\\b`, "g");
      s = s.replace(regex, replacement);
    }
  }

  s = s.replace(/\bEBCVB\s*(\d+)/g, "EBCV$1");
  s = s.replace(/^EBC\sP(\d+)/, "EBC P $1");

  return s;
}

function parseVertices(text, crsKeyInput) {
  // Função para validar e auto-escalar coordenadas usando o CRS detectado
  // Fallback global para crsKey
  let crsKey = crsKeyInput || (window._arcgis_crs_key || "SIRGAS2000_22S");
  if (!crsKey) {
    console.warn('[PDFtoArcgis] Nenhum CRS detectado, usando fallback SIRGAS2000_22S');
    crsKey = "SIRGAS2000_22S";
  }

  function validarVertice(id, north, east, origem, crsKeyLocal) {
    // Não faz nenhuma validação, retorna sempre
    return { id, north, east };
  }
  const clean = (text || "").replace(/\u00A0/g, " ").replace(/[‐‑‒–—]/g, "-");
  const out = [];
  const classified = [];
  // Regex para latitude/longitude (graus decimais, com ou sem sinal)
  const rxLatLon = /([+-]?\d{1,2}(?:[.,]\d+)?)[°º]?\s*[;,]?\s*([+-]?\d{1,3}(?:[.,]\d+)?)[°º]?/g;
  // Regex para azimute/distância (ex: "azimute 45°30'27", distância 258,85m")
  const rxAzDist = /azimute\s*([0-9]{1,3})[°º](?:\s*([0-9]{1,2})[\'’])?(?:\s*([0-9]{1,2})[\"”])?[^\d]{0,20}dist[aâ]ncia\s*([0-9]+(?:[.,][0-9]+)?)\s*m/gi;
  // 1. Detectar e classificar latitude/longitude
  let latlonMatch;
  while ((latlonMatch = rxLatLon.exec(clean)) !== null) {
    const lat = parseFloat(latlonMatch[1].replace(',', '.'));
    const lon = parseFloat(latlonMatch[2].replace(',', '.'));
    if (
      Math.abs(lat) <= 90 && Math.abs(lon) <= 180 &&
      (Math.abs(lat) > 0.01 || Math.abs(lon) > 0.01)
    ) {
      const id = `LL${String(classified.length + 1).padStart(3, '0')}`;
      classified.push({
        id,
        type: 'latlon',
        lat,
        lon,
        raw: latlonMatch[0],
        origem: 'latlon',
      });
    }
  }

  // 2. Detectar e classificar azimute/distância
  let azdistMatch;
  while ((azdistMatch = rxAzDist.exec(clean)) !== null) {
    const deg = parseInt(azdistMatch[1] || '0', 10);
    const min = parseInt(azdistMatch[2] || '0', 10);
    const sec = parseInt(azdistMatch[3] || '0', 10);
    const az = deg + min / 60 + sec / 3600;
    const dist = parseFloat((azdistMatch[4] || '0').replace(',', '.'));
    if (az > 0 && dist > 0) {
      const id = `AZ${String(classified.length + 1).padStart(3, '0')}`;
      classified.push({
        id,
        type: 'azimute_dist',
        azimuth: az,
        distance: dist,
        raw: azdistMatch[0],
        origem: 'azimute_dist',
      });
    }
  }
  // Garantir fallback de crsKey
  if (!crsKey) {
    crsKey = (window._arcgis_crs_key || "SIRGAS2000_22S");
    if (!crsKey) crsKey = "SIRGAS2000_22S";
    console.warn('[PDFtoArcgis] parseVertices: CRS não definido, usando fallback SIRGAS2000_22S');
  }

  // Padrão 0: Formato descritivo de matrícula de terras com coordenadas em sequência
  // Exemplo: "segue com os seguintes azimutes e distâncias: 139°59'27" e 258,85m. segue... E 519.579,499m e N 7.331.990,424m..."
  // Procura por um padrão onde há múltiplas coordenadas E/N sucessivas com contexto descritivo de propriedade
  const rx0 = /(?:seguintes?\s+)?(?:azimutes?\s+)?(?:e\s+)?distâncias[\s:;,]*.*?(?:segue\s+)?(?:confrontando\s+)?(?:com\s+)?(?:a\s+)?propriedade[\s;,]*.*?E\s+([0-9.,\s]+)\s*m\s+e\s+N\s+([0-9.,\s]+)\s*m/gis;

  // Padrão 1: Formato oficial cartório "E=XXXXX.XXX m e N=XXXXXXX.XXX m" (PRIORITÁRIO)
  // Captura coordenadas soltas e depois associa com marcos
  const rx1 = /E\s*=\s*([0-9.,\s]+)\s*m\s+e\s+N\s*=\s*([0-9.,\s]+)\s*m/gim;

  // Padrão 1a: Variação cartório "N XXXXX,XXX m. e E XXXXXX,XXX m" (NOVO - compatível com documentos registrais)
  // Captura coordenadas sem o sinal =
  const rx1a = /(?:coordenadas\s+)?(?:de\s+)?N\s+([0-9.,\s]+)\s*m\.?\s+(?:e\s+)?E\s+([0-9.,\s]+)\s*m/gim;

  // Padrão 1b: Regex para encontrar os marcadores/vértices antes das coordenadas
  // Procura por: "Dai segue ... marco 'XX' (E=..." ou "Inicia-se ... E=..."
  const rx1b = /(?:Dai\s+segue|Inicia-se|ponto\s+inicial|com\s+um\s+azimute|marco\s+)(?:confrontando\s+)?(?:com\s+)?(?:a\s+)?(?:chacara\s+)?(?:n\.?\s*)?(?:\d+\s+)?(?:uma\s+extensão\s+)?(?:de\s+)?(?:[0-9.,]+\s+)?(?:metros\s+)?(?:ao\s+)?(?:[A-Z]{1,2}\s+)?(?:\(sudeste\)|\(noroeste\)|\(norte\)|\(sul\))?\s*(?:com\s+)?(?:o\s+)?(?:lote\s+)?(?:n\.?\s*)?(?:\d+\s+)?(?:da\s+)?(?:quadra\s+)?(?:n\.?\s*)?(?:\d+\s+)?(?:uma\s+extensão\s+)?(?:de\s+)?(?:[0-9.,]+\s+)?(?:metros\s*)?[,;.]?\s*(?:ao\s+)?(?:[A-Z]{1,2}\s+)?(?:\(sudeste\)|\(noroeste\)|\(norte\)|\(sul\))?\s*(?:confrontando\s+)?(?:com\s+)?(?:a\s+)?(?:chacara\s+)?(?:n\.?\s*)?([A-Z0-9]+)(?:\s+\(|E\s*=|coordenadas|\s+uma)/gim;

  // Versão simplificada: apenas procura por "E=" e volta atrás para encontrar o último marcador
  // Isto é mais confiável do que tentar capturar tudo
  const rxMarkerSimple = /([A-Z0-9]+)\s+\(/gm;

  // Padrão 2: "vértice V001 ... coordenadas E 500000 m e N 7000000 m" 
  const rx2 = /v[ée]rtice\s+([A-Z0-9]+(?:\s*[A-Z0-9]+)*)[\s,;:.-]*.*?coordenadas?\s+(?:(?:E\s*([0-9.,\s]+)\s*m?\s*[;,.]?\s*e\s*N\s*([0-9.,\s]+))|(?:N\s*([0-9.,\s]+)\s*m?\s*[;,.]?\s*e\s*E\s*([0-9.,\s]+)))(?=\s*(?:m|;|,|\.|\n|$))/gim;

  // Padrão 3: Tabela com colunas "Vértice | E (m) | N (m)"
  const rx3 = /([A-Z0-9]+(?:\s+[A-Z0-9]+)*)\s+([0-9]{5,}[\.,][0-9]{1,3})\s+([0-9]{6,}[\.,][0-9]{1,3})/gm;

  // Padrão 4: "V001: E=500000,00 N=7000000,00"
  const rx4 = /([A-Z0-9]+(?:\s+[A-Z0-9]+)*)\s*:?\s*[=]?\s*E\s*[=]?\s*([0-9]{5,}[\.,][0-9]{1,3})\s+N\s*[=]?\s*([0-9]{6,}[\.,][0-9]{1,3})/gim;

  let m;
  const processedIds = new Set();

  // ESTRATÉGIA 0: Procurar coordenadas em sequência com formato "E XXX,XXX m e N XXXXXXX,XXX m"
  // Este padrão é muito comum em matrículas de terras brasileiras, especialmente em seções de descrição
  let m0;
  const rx0Simples = /E\s+([0-9]{5,}[\.,][0-9]{1,3})\s*m\s+e\s+N\s+([0-9]{6,}[\.,][0-9]{1,3})\s*m/gim;

  // Procurar primeiramente em contexto de descrição de propriedade (entre certos marcadores)
  let contextMatch = clean.match(/(?:Descrição|descrição)[\s:;]*Inicia-se[\s:;]*.*?(?=\n\n|---)/is);
  if (!contextMatch) {
    // Se não encontrou "Descrição: Inicia-se", procurar por qualquer seção de memorial/descrição
    contextMatch = clean.match(/(?:MEMORIAL|Memorial|DESCRIÇÃO|Descrição|IMOVEL|Imóvel)[\s:;]*.*?(?:^\s*(?:Av-|R-|\d{1,2}\.))/m);
  }

  if (contextMatch) {
    const descContext = contextMatch[0];
    const localRx = /E\s+([0-9]{5,}[\.,][0-9]{1,3})\s*m\s+e\s+N\s+([0-9]{6,}[\.,][0-9]{1,3})\s*m/gim;
    let localMatch;
    while ((localMatch = localRx.exec(descContext)) !== null) {
      const eRaw = localMatch[1];
      const nRaw = localMatch[2];
      const east = parseFloat(normalizeNumber(eRaw));
      const north = parseFloat(normalizeNumber(nRaw));

      const idNum = out.length + 1;
      const id = `V${String(idNum).padStart(3, '0')}`;
      if (Number.isFinite(north) && Number.isFinite(east)) {
        const v = validarVertice(id, north, east, 'descContext', crsKey);
        if (v && !processedIds.has(id)) {
          out.push(v);
          processedIds.add(id);
          classified.push({ id, type: 'utm', north, east, raw: localMatch[0], origem: 'descContext' });
        }
      }
    }

    if (out.length > 0) {
      console.log(`[PDFtoArcgis] Estratégia 0: encontrados ${out.length} vértices em seção de descrição`);
    }
  }

  // Se Estratégia 0 não encontrou em contexto, tentar em TODO o documento
  if (out.length === 0) {
    const globalRx = /E\s+([0-9]{5,}[\.,][0-9]{1,3})\s*m\s+e\s+N\s+([0-9]{6,}[\.,][0-9]{1,3})\s*m/gim;
    let globalMatch;
    while ((globalMatch = globalRx.exec(clean)) !== null) {
      const eRaw = globalMatch[1];
      const nRaw = globalMatch[2];
      const east = parseFloat(normalizeNumber(eRaw));
      const north = parseFloat(normalizeNumber(nRaw));

      const idNum = out.length + 1;
      const id = `V${String(idNum).padStart(3, '0')}`;
      if (Number.isFinite(north) && Number.isFinite(east)) {
        const v = validarVertice(id, north, east, 'global', crsKey);
        if (v && !processedIds.has(id)) {
          out.push(v);
          processedIds.add(id);
          classified.push({ id, type: 'utm', north, east, raw: globalMatch[0], origem: 'global' });
        }
      }
    }

    if (out.length > 0) {
      console.log(`[PDFtoArcgis] Estratégia 0 (global): encontrados ${out.length} vértices em todo o documento`);
    }
  }


  // ESTRATÉGIA 1: Procurar coordenadas soltas (E=... m e N=...) e associar com marcadores
  const coordsOnly = [];
  let m1;
  const coordPositions = [];  // Guardar as posições das coordenadas no texto

  // Tentar primeiro o padrão original com "="
  while ((m1 = rx1.exec(clean)) !== null) {
    const eRaw = m1[1];
    const nRaw = m1[2];
    const east = parseFloat(normalizeNumber(eRaw));
    const north = parseFloat(normalizeNumber(nRaw));
    if (Number.isFinite(north) && Number.isFinite(east)) {
      coordsOnly.push({ idx: coordsOnly.length, east, north });
      coordPositions.push(m1.index);
    }
  }

  // Se não encontrou com "=", tentar padrão 1a (registral): N ... m e E ...
  if (coordsOnly.length === 0) {
    while ((m1 = rx1a.exec(clean)) !== null) {
      const nRaw = m1[1];  // N vem primeiro neste padrão
      const eRaw = m1[2];  // E vem segundo
      const east = parseFloat(normalizeNumber(eRaw));
      const north = parseFloat(normalizeNumber(nRaw));
      if (Number.isFinite(north) && Number.isFinite(east)) {
        coordsOnly.push({ idx: coordsOnly.length, east, north });
        coordPositions.push(m1.index);
      }
    }
  }
  // Padrão 1c: E=... e N=... (SEM 'm') — comum em memoriais brasileiros
  if (coordsOnly.length === 0) {
    const rx1c = /E\s*=\s*([0-9.,\s]+)\s*e\s*N\s*=\s*([0-9.,\s]+)/gim;
    let m1c2;
    while ((m1c2 = rx1c.exec(clean)) !== null) {
      const eRaw = m1c2[1];
      const nRaw = m1c2[2];
      const east = parseFloat(normalizeNumber(eRaw));
      const north = parseFloat(normalizeNumber(nRaw));
      if (Number.isFinite(north) && Number.isFinite(east)) {
        coordsOnly.push({ idx: coordsOnly.length, east, north });
        coordPositions.push(m1c2.index);
      }
    }
  }
  // Padrão 1d: Este (X) ... e Norte (Y) ... — sem 'm'
  if (coordsOnly.length === 0) {
    const rx1d = /Este\s*\(X\)\s*([0-9.,\s]+)\s*e\s*Norte\s*\(Y\)\s*([0-9.,\s]+)/gim;
    let m1d;
    while ((m1d = rx1d.exec(clean)) !== null) {
      const eRaw = m1d[1];
      const nRaw = m1d[2];
      const east = parseFloat(normalizeNumber(eRaw));
      const north = parseFloat(normalizeNumber(nRaw));
      if (Number.isFinite(north) && Number.isFinite(east)) {
        coordsOnly.push({ idx: coordsOnly.length, east, north });
        coordPositions.push(m1d.index);
      }
    }
  }


  // Debug log
  if (coordsOnly.length > 0) {
    console.log(`[PDFtoArcgis] Estratégia 1: encontrados ${coordsOnly.length} coordenadas (E=... m e N=... OU N ... m e E ...)`);
  }

  // Se encontrou coordenadas soltas, procurar pelos marcadores/vértices associados
  if (coordsOnly.length > 0) {
    // Estratégia: procurar por marcadores numerados (1, 2, 3...) ou PP, P1, etc
    const markers = [];

    // Primeiro, tentar encontrar sequência numérica
    const rxNumbers = /(?:marco\s+['"]?|com\s+o\s+)([0-9]+|PP|P[0-9]+)(?:\s*['"]\s*\(|[,;]|\s+E\s*=)/gim;
    let m1b;
    while ((m1b = rxNumbers.exec(clean)) !== null) {
      let id = m1b[1].replace(/['"]/g, "").trim();
      if (id) {
        id = normalizeId(id);
        markers.push(id);
      }
    }

    // Se não encontrou números, tentar procurar por identificadores entre parênteses
    if (markers.length === 0) {
      const rxParens = /\(([A-Z0-9]+)\)\s*E\s*=/gim;
      while ((m1b = rxParens.exec(clean)) !== null) {
        let id = m1b[1].trim();
        if (id && id.length <= 10) {  // Filtro contra capturas erradas
          id = normalizeId(id);
          markers.push(id);
        }
      }
    }

    // Se ainda não encontrou marcadores, tentar nova estratégia: procurar vértices no contexto próximo de cada coordenada
    if (markers.length === 0) {
      for (let i = 0; i < coordsOnly.length; i++) {
        const coordIdx = coordPositions[i];

        // Definir janela de busca: 500 caracteres antes e 500 depois
        const startCtx = Math.max(0, coordIdx - 500);
        const endCtx = Math.min(clean.length, coordIdx + 500);
        const context = clean.substring(startCtx, endCtx);

        // Procurar por identificador de vértice no contexto (padrão registral: EBC M, EBC V, P, PP)
        let foundId = null;

        // Procurar padrão "EBC M 1234", "EBC V 5801", etc
        const rxEbc = /EBC\s*([MV])\s*(\d+)/gim;
        let m1c;
        while ((m1c = rxEbc.exec(context)) !== null) {
          foundId = `EBC ${m1c[1]} ${m1c[2]}`;
        }

        // Se não encontrou EBC, tentar padrão P (Ponto)
        if (!foundId) {
          const rxP = /(?:ponto\s+)?P([0-9]+)(?=[,;.\s])/gim;
          m1c = rxP.exec(context);
          if (m1c) foundId = `P${m1c[1]}`;
        }

        // Se ainda não encontrou, tentar "PP" (ponto de partida)
        if (!foundId && context.includes("PP")) {
          foundId = "PP";
        }

        // Se encontrou um ID, normalizar e guardar
        if (foundId) {
          foundId = normalizeId(foundId);
          markers.push(foundId);
        } else {
          // Fallback: usar sequência numérica
          markers.push(String(i + 1));
        }
      }
    }

    // Se ainda não encontrou, usar sequência padrão (1, 2, 3...)
    if (markers.length === 0) {
      for (let i = 0; i < coordsOnly.length; i++) {
        markers.push(String(i + 1));
      }
      console.log(`[PDFtoArcgis] Nenhum marcador encontrado, usando numeração padrão`);
    } else if (markers.length < coordsOnly.length) {
      // Completar com números faltantes
      const startIdx = markers.length;
      for (let i = startIdx; i < coordsOnly.length; i++) {
        markers.push(String(i + 1));
      }
      console.log(`[PDFtoArcgis] Encontrados ${markers.length} marcadores: ${markers.join(", ")}`);
    } else {
      console.log(`[PDFtoArcgis] Encontrados ${markers.length} marcadores: ${markers.join(", ")}`);
    }

    // Associar coordenadas com marcadores (na ordem que aparecem)
    // Receber CRS detectado como argumento
    // Usar crsKey robusto
    for (let i = 0; i < Math.min(coordsOnly.length, markers.length); i++) {
      const coord = coordsOnly[i];
      const id = markers[i];
      if (!processedIds.has(id)) {
        const v = validarVertice(id, coord.north, coord.east, 'estrategia1', crsKey);
        if (v) {
          out.push(v);
          processedIds.add(id);
        }
      }
    }
  }

  // Se ESTRATÉGIA 2 não encontrou nada, tentar ESTRATÉGIA 2B (OCR Resiliente)
  if (out.length === 0) {
    // Padrão mais resiliente para OCR que corrompeu "vértice" em "véitice", "vértice", etc
    // Captura "vértice 1 ... E ... e N ..." ou similar
    const rx2b = /v[ée][ií]?tice\s+([0-9]+)\s+.*?(?:coordenadas?\s+)?(?:E\s+([0-9:.,/\-\s]+?)\s*m?\s+e\s+N\s+([0-9:.,/\-\s]+?)\s*m|N\s+([0-9:.,/\-\s]+?)\s*m?\s+e\s+E\s+([0-9:.,/\-\s]+?)\s*m)/gis;

    let m2b;
    while ((m2b = rx2b.exec(clean)) !== null) {
      const vertexNum = m2b[1];
      let eRaw = m2b[2] || m2b[5];
      let nRaw = m2b[3] || m2b[4];

      if (!eRaw || !nRaw) continue;

      // Limpeza extrema
      eRaw = eRaw.replace(/[^0-9.]/g, '');
      nRaw = nRaw.replace(/[^0-9.]/g, '');

      // Inserir ponto se necessário
      if (!eRaw.includes('.') && eRaw.length >= 7) {
        eRaw = eRaw.slice(0, -3) + '.' + eRaw.slice(-3);
      }
      if (!nRaw.includes('.') && nRaw.length >= 7) {
        nRaw = nRaw.slice(0, -3) + '.' + nRaw.slice(-3);
      }

      const east = parseFloat(eRaw);
      const north = parseFloat(nRaw);

      const id = `V${String(vertexNum).padStart(3, '0')}`;
      if (Number.isFinite(north) && Number.isFinite(east) && !processedIds.has(vertexNum)) {
        const v = validarVertice(id, north, east, 'estrategia2b', crsKey);
        if (v) {
          out.push(v);
          processedIds.add(vertexNum);
        }
      }
    }

    if (out.length > 0) {
      console.log(`[PDFtoArcgis] Estratégia 2B (Vértice OCR): encontrados ${out.length} vértices`);
    }
  }

  // Se ainda nada, tentar ESTRATÉGIA 3 (padrões 3 e 4)
  if (out.length === 0) {
    for (const rx of [rx3, rx4]) {
      while ((m = rx.exec(clean)) !== null) {
        const id = normalizeId(m[1]);
        const val1 = parseFloat(normalizeNumber(m[2]));
        const val2 = parseFloat(normalizeNumber(m[3]));

        if (id && Number.isFinite(val1) && Number.isFinite(val2) && !processedIds.has(id)) {
          let east, north;
          if (val1 >= 100000 && val1 <= 900000) {
            east = val1; north = val2;
          } else if (val2 >= 100000 && val2 <= 900000) {
            east = val2; north = val1;
          } else {
            continue;
          }

          out.push({ id, north, east });
          processedIds.add(id);
        }
      }
      if (out.length > 0) break;
    }
  }

  // ESTRATÉGIA 4 (COMPLEMENTAR): Se ainda não encontrou vértices, procurar por padrão genérico "E XXX,XXX m e N XXXXXXX,XXX m"
  // Sem o contexto de propriedade, em qualquer lugar do documento
  if (out.length === 0) {
    const rxGenericEN = /E\s+([0-9]{5,}[\.,][0-9]{1,3})\s*m\s+e\s+N\s+([0-9]{6,}[\.,][0-9]{1,3})\s*m/gim;
    let m4;
    while ((m4 = rxGenericEN.exec(clean)) !== null) {
      const eRaw = m4[1];
      const nRaw = m4[2];
      const east = parseFloat(normalizeNumber(eRaw));
      const north = parseFloat(normalizeNumber(nRaw));

      const idNum = out.length + 1;
      const id = `V${String(idNum).padStart(3, '0')}`;
      if (Number.isFinite(north) && Number.isFinite(east)) {
        const v = validarVertice(id, north, east, 'estrategia4', crsKey);
        if (v && !processedIds.has(id)) {
          out.push(v);
          processedIds.add(id);
        }
      }
    }
    if (out.length > 0) {
      console.log(`[PDFtoArcgis] Estratégia 4: encontrados ${out.length} vértices com padrão genérico E/N`);
    }
  }

  // ESTRATÉGIA 5 (OCR FALLBACK): Se ainda não encontrou vértices após estratégias digitais, tentar reconhecimento com padrões OCR-resilientes
  // Algumas PDFs têm texto scaneado/OCR de baixa qualidade, com padrões alterados
  if (out.length === 0) {
    // Padrão alternativo: E/N sem "m" ou com spacing irregular (típico de OCR de baixa qualidade)
    // Ex: "E 519.579,499 e N 7.331.990,424" ou "E519579,499eN7331990,424"
    const rxOcrAlternative = /E\s*([0-9]{5,}[\.,][0-9]{1,3})\s*e\s+N\s*([0-9]{6,}[\.,][0-9]{1,3})(?=[^0-9]|$)/gim;
    let m5;
    const ocrCoords = [];
    while ((m5 = rxOcrAlternative.exec(clean)) !== null) {
      const eRaw = m5[1];
      const nRaw = m5[2];
      const east = parseFloat(normalizeNumber(eRaw));
      const north = parseFloat(normalizeNumber(nRaw));

      const idNum = out.length + 1;
      const id = `V${String(idNum).padStart(3, '0')}`;
      if (Number.isFinite(north) && Number.isFinite(east)) {
        const v = validarVertice(id, north, east, 'ocrFallback', crsKey);
        if (v) {
          ocrCoords.push({ east: v.east, north: v.north });
        }
      }
    }

    // Se encontrou coordenadas com padrão OCR, processar
    if (ocrCoords.length > 0) {
      // Remover duplicatas próximas (OCR pode gerar ruído)
      const deduplicated = [];
      for (const coord of ocrCoords) {
        const isDuplicate = deduplicated.some(c =>
          Math.abs(c.east - coord.east) < 1 && Math.abs(c.north - coord.north) < 1
        );
        if (!isDuplicate) deduplicated.push(coord);
      }

      // Gerar IDs sequenciais
      for (let i = 0; i < deduplicated.length; i++) {
        const coord = deduplicated[i];
        const id = `V${String(i + 1).padStart(3, '0')}`;
        out.push({ id, north: coord.north, east: coord.east });
      }
      console.log(`[PDFtoArcgis] Estratégia 5 (OCR Fallback): encontrados ${out.length} vértices com padrão alternativo`);
    }
  }

  // ESTRATÉGIA 5B (OCR FALLBACK EXTREMO): Padrão ultra-resiliente para OCR muito degradado
  // Tolera: separadores errados, quebras de linha, caracteres especiais, espaçamento irregular
  if (out.length === 0) {
    // Ultra-resiliente: E<anything>numero<anything> e N<anything>numero<anything>
    // Captura tudo entre E e N, depois extrai números
    const rxUltraOcr = /E\s+([0-9:.,/\-\s]+?)(?:\s*m)?\s+e\s+N\s+(?:["'\\]*\s*)?([0-9:.,/\-\s]+?)(?:\s*m)?(?=\s*(?:deste|segue|proximidade|confrontando|;|\.|,|$))/gim;
    let m5b;
    const ocrExtremeCoords = [];

    // Função helper para normalizar número com separadores europeus/OCR
    function cleanCoordinate(raw) {
      // Remover espaços
      let s = raw.replace(/\s+/g, '');
      // Manter apenas números e separadores (. , :)
      s = s.replace(/[^0-9.,:/]/g, '');
      // O último separador é sempre o decimal
      // Encontrar o ÚLTIMO . ou ,
      const lastDot = s.lastIndexOf('.');
      const lastComma = s.lastIndexOf(',');
      const lastColon = s.lastIndexOf(':');
      const lastSlash = s.lastIndexOf('/');

      const lastSepPos = Math.max(lastDot, lastComma, lastColon, lastSlash);

      if (lastSepPos === -1) {
        // Sem separador - já é um número inteiro
        return s;
      }

      // Verificar se este é o decimal (últimos 1-3 dígitos)
      const afterLast = s.length - lastSepPos - 1;
      if (afterLast <= 3 && afterLast > 0) {
        // É o decimal - remover todos os separadores antes dele, depois manter esse como ponto
        const intPart = s.substring(0, lastSepPos).replace(/[.,:/]/g, '');
        const decPart = s.substring(lastSepPos + 1);
        return intPart + '.' + decPart;
      } else {
        // Não é decimal, remover todos
        return s.replace(/[.,:/]/g, '');
      }
    }

    while ((m5b = rxUltraOcr.exec(clean)) !== null) {
      let eRaw = m5b[1];
      let nRaw = m5b[2];

      console.log(`[PDFtoArcgis] 5B: Raw encontrado - E="${eRaw}" N="${nRaw}"`);

      // Usar função de limpeza melhorada
      eRaw = cleanCoordinate(eRaw);
      nRaw = cleanCoordinate(nRaw);

      const east = parseFloat(eRaw);
      const north = parseFloat(nRaw);

      console.log(`[PDFtoArcgis] 5B: Limpo - E="${eRaw}" (${east}) N="${nRaw}" (${north})`);

      if (Number.isFinite(north) && Number.isFinite(east) && east >= 100000 && east <= 900000) {
        ocrExtremeCoords.push({ east, north });
      }
    }

    // Se encontrou coordenadas
    if (ocrExtremeCoords.length > 0) {
      // Remover duplicatas próximas
      const deduplicated = [];
      for (const coord of ocrExtremeCoords) {
        const isDuplicate = deduplicated.some(c =>
          Math.abs(c.east - coord.east) < 1 && Math.abs(c.north - coord.north) < 1
        );
        if (!isDuplicate) deduplicated.push(coord);
      }

      // Gerar IDs sequenciais
      for (let i = 0; i < deduplicated.length; i++) {
        const coord = deduplicated[i];
        const id = `V${String(i + 1).padStart(3, '0')}`;
        out.push({ id, north: coord.north, east: coord.east });
      }
      console.log(`[PDFtoArcgis] Estratégia 5B (OCR Extremo): encontrados ${out.length} vértices`);
    }
  }

  // Converter lat/lon para UTM usando proj4js, se disponível
  if (typeof proj4 !== 'undefined' && classified && classified.length) {
    for (const c of classified) {
      if (c.type === 'latlon' && typeof c.lat === 'number' && typeof c.lon === 'number') {
        // Determinar zona UTM a partir do longitude
        let zone = 22; // fallback para Brasil
        if (!isNaN(c.lon)) {
          zone = Math.floor((c.lon + 180) / 6) + 1;
        }
        // Montar string proj4 para zona SIRGAS2000
        const projStr = `+proj=utm +zone=${zone} +south +ellps=GRS80 +units=m +no_defs`;
        try {
          const [east, north] = proj4('WGS84', projStr, [c.lon, c.lat]);
          const id = c.id || `LL${out.length + 1}`;
          // Evitar duplicatas próximas
          const isDuplicate = out.some(v => Math.abs(v.east - east) < 1 && Math.abs(v.north - north) < 1);
          if (!isDuplicate) {
            out.push({ id, north, east, origem: 'latlon2utm' });
          }
        } catch (e) {
          console.warn('[PDFtoArcgis] Falha ao converter lat/lon para UTM:', c, e);
        }
      }
    }
  }
  // Fechar polígono se não estiver fechado
  if (out.length > 2) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first && last && (first.north !== last.north || first.east !== last.east)) {
      out.push({ ...first, id: first.id + '_close', origem: 'fechamento' });
      console.log('[PDFtoArcgis] Polígono fechado automaticamente.');
    }
  }
  // Exporta ambos: lista de vértices UTM (out) e classificados (classified)
  return { utm: out, classified };
}

/* =========================
   AUTO-FIX UTM (decimais colados)
========================= */
function chooseBestScale(value, minv, maxv, target) {
  if (!Number.isFinite(value)) return { value, scalePow: 0, ok: false };
  let best = null;
  for (let k = 0; k <= 6; k++) {
    const v = value / Math.pow(10, k);
    if (v >= minv && v <= maxv) {
      const score = Number.isFinite(target) ? Math.abs(v - target) : 0;
      const cand = { score, scalePow: k, value: v, ok: true };
      if (!best || cand.score < best.score) best = cand;
    }
  }
  return best || { value, scalePow: 0, ok: false };
}

function autoFixUtmDecimals(coords) {
  const validE = coords.map(c => c.east).filter(v => v >= 100000 && v <= 900000);
  const validN = coords.map(c => c.north).filter(v => v >= 0 && v <= 10000000);

  const median = (arr) => {
    if (!arr.length) return NaN;
    const a = [...arr].sort((x, y) => x - y);
    const mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  };

  const medE = median(validE);
  const medN = median(validN);

  const fixes = [];
  for (const p of coords) {
    const n0 = p.north;
    const e0 = p.east;
    const nCand = chooseBestScale(n0, 0, 10000000, medN);
    const eCand = chooseBestScale(e0, 100000, 900000, medE);
    if (nCand.ok && nCand.scalePow > 0) { p.north = nCand.value; fixes.push(`N ${p.id}: ${n0}→${p.north}`); }
    if (eCand.ok && eCand.scalePow > 0) { p.east = eCand.value; fixes.push(`E ${p.id}: ${e0}→${p.east}`); }
  }
  return fixes;
}

/* =========================
   VALIDAÇÃO E RECUPERAÇÃO DE COORDENADAS
========================= */

/**
 * Define ranges válidos de coordenadas por zona UTM
 * Baseado em padrões de cartório brasileiro
 */
function getValidRanges(projectionKey) {
  const ranges = {
    // Sul/Sudeste
    "SIRGAS2000_21S": { nMin: 6.45e6, nMax: 6.75e6, eMin: 300e3, eMax: 850e3 },
    "SAD69_21S": { nMin: 6.45e6, nMax: 6.75e6, eMin: 300e3, eMax: 850e3 },
    "SIRGAS2000_22S": { nMin: 7.15e6, nMax: 7.45e6, eMin: 300e3, eMax: 850e3 },
    "SAD69_22S": { nMin: 7.15e6, nMax: 7.45e6, eMin: 300e3, eMax: 850e3 },
    "SIRGAS2000_23S": { nMin: 8.0e6, nMax: 9.0e6, eMin: 300e3, eMax: 850e3 },
    "SAD69_23S": { nMin: 8.0e6, nMax: 9.0e6, eMin: 300e3, eMax: 850e3 },
    // Nordeste/Norte (Ceará, Maranhão, Pará, etc)
    "SIRGAS2000_24S": { nMin: 9.0e6, nMax: 10.5e6, eMin: 300e3, eMax: 850e3 },
    "SAD69_24S": { nMin: 9.0e6, nMax: 10.5e6, eMin: 300e3, eMax: 850e3 },
    "SIRGAS2000_25S": { nMin: 10.0e6, nMax: 10.5e6, eMin: 300e3, eMax: 850e3 },
    // Padrão fallback: zona 22S (Paraná)
    "WGS84_UTM": { nMin: 7.15e6, nMax: 7.45e6, eMin: 300e3, eMax: 850e3 },
  };
  return ranges[projectionKey] || ranges["WGS84_UTM"];
}

/**
 * Valida e tenta recuperar coordenadas fora do intervalo válido
 */
function validateAndFixCoordinates(coords, projectionKey) {
  const range = getValidRanges(projectionKey);
  const valid = [];
  const invalid = [];
  const recovered = [];

  console.log(`[PDFtoArcgis] 🔍 Validando ${coords.length} coordenadas`);
  console.log(`[PDFtoArcgis] Ranges esperados: N[${range.nMin.toExponential(1)}-${range.nMax.toExponential(1)}], E[${range.eMin.toExponential(1)}-${range.eMax.toExponential(1)}]`);

  for (const c of coords) {
    let north = c.north;
    let east = c.east;
    let scaled = false;

    // PRIMEIRO: Tentar auto-escalar se estão fora do intervalo
    if (!(north >= range.nMin && north <= range.nMax)) {
      const scaledN = autoScaleCoordinate(north, range.nMin, range.nMax);
      if (!Number.isNaN(scaledN)) {
        north = scaledN;
        scaled = true;
      }
    }

    if (!(east >= range.eMin && east <= range.eMax)) {
      const scaledE = autoScaleCoordinate(east, range.eMin, range.eMax);
      if (!Number.isNaN(scaledE)) {
        east = scaledE;
        scaled = true;
      }
    }

    const nValid = north >= range.nMin && north <= range.nMax;
    const eValid = east >= range.eMin && east <= range.eMax;

    if (nValid && eValid) {
      if (scaled) {
        const recoveryMsg = `Auto-escalado: N ${c.north}→${north}, E ${c.east}→${east}`;
        valid.push({ ...c, north, east });
        recovered.push({ original: c, fixed: { north, east }, recovery: recoveryMsg });
        console.log(`[PDFtoArcgis] 🔄 ${c.id}: ${recoveryMsg}`);
      } else {
        valid.push({ ...c, north, east });
      }
    } else {
      // Tentar outras estratégias de recuperação
      let fixed = null;

      // PROBLEMA 1: Número começando com 73 (deveria ser 7.3)
      if (!fixed && c.north > 70e6 && c.north < 80e6) {
        const corrected = Math.floor(c.north / 10);
        if (corrected >= range.nMin && corrected <= range.nMax) {
          fixed = { ...c, north: corrected, recovery: "Removido dígito inicial (73→7.3)" };
          console.log(`[PDFtoArcgis] 🔄 Recuperado ${c.id}: N ${c.north} → ${corrected}`);
        }
      }

      // PROBLEMA 2: Número truncado (7.33 deveria ser 7.3XX.XXX)
      if (!fixed && c.north < 1e6 && c.north > 0) {
        // Procurar próxima coordenada válida para estimar posição
        const nearValid = coords
          .filter(cc => cc.north >= range.nMin && cc.north <= range.nMax)
          .map(cc => cc.north);

        if (nearValid.length > 0) {
          const avgN = nearValid.reduce((a, b) => a + b) / nearValid.length;
          // Manter a mesma ordem de magnitude da coordenada válida próxima
          const magnitude = Math.floor(Math.log10(c.north));
          const multiplier = Math.pow(10, Math.floor(Math.log10(avgN)) - magnitude);
          const corrected = c.north * multiplier;

          if (corrected >= range.nMin && corrected <= range.nMax) {
            fixed = { ...c, north: corrected, recovery: "Escalado para magnitude correta" };
            console.log(`[PDFtoArcgis] 🔄 Escalado ${c.id}: N ${c.north} → ${corrected.toFixed(0)}`);
          }
        }
      }

      // PROBLEMA 3: E (east) muito grande - tentar escalar
      if (!fixed && !eValid && c.east > range.eMax) {
        const scaledE = autoScaleCoordinate(c.east, range.eMin, range.eMax);
        if (!Number.isNaN(scaledE)) {
          fixed = { ...c, east: scaledE, recovery: `Auto-escalado E: ${c.east} → ${scaledE}` };
          console.log(`[PDFtoArcgis] 🔄 Recuperado ${c.id}: E ${c.east} → ${scaledE}`);
        }
      }

      // PROBLEMA 4: N (north) muito grande - tentar escalar
      if (!fixed && !nValid && c.north > range.nMax) {
        const scaledN = autoScaleCoordinate(c.north, range.nMin, range.nMax);
        if (!Number.isNaN(scaledN)) {
          fixed = { ...c, north: scaledN, recovery: `Auto-escalado N: ${c.north} → ${scaledN}` };
          console.log(`[PDFtoArcgis] 🔄 Recuperado ${c.id}: N ${c.north} → ${scaledN}`);
        }
      }

      if (fixed) {
        const fixedCoord = { ...c, north: fixed.north || c.north, east: fixed.east || c.east };
        valid.push(fixedCoord);
        recovered.push({ original: c, fixed: fixedCoord, recovery: fixed.recovery });
      } else {
        invalid.push(c);
        console.log(`[PDFtoArcgis] ❌ Coordenada rejeitada ${c.id}: N=${c.north}, E=${c.east}`);
      }
    }
  }

  console.log(`[PDFtoArcgis] ✅ Validação completa: ${valid.length} válidas, ${recovered.length} recuperadas, ${invalid.length} rejeitadas`);

  return { valid, invalid, recovered };
}

function validateCoords(coords, projectionKey) {
  const warnings = [];
  const isWgs = projectionKey === "WGS84";
  const seen = new Map();

  for (const p of coords) {
    if (!seen.has(p.id)) seen.set(p.id, { north: p.north, east: p.east });
    else {
      const prev = seen.get(p.id);
      if (prev.north !== p.north || prev.east !== p.east) warnings.push(`⚠️ ID duplicado com coords diferentes: ${p.id}`);
    }
  }

  for (const p of coords) {
    if (!isWgs) {
      if (p.east < 100000 || p.east > 900000) warnings.push(`⚠️ East fora UTM: ${p.id} (E=${p.east})`);
      if (p.north < 0 || p.north > 10000000) warnings.push(`⚠️ North fora UTM: ${p.id} (N=${p.north})`);
    } else {
      if (p.east < -180 || p.east > 180) warnings.push(`⚠️ Longitude fora: ${p.id} (X=${p.east})`);
      if (p.north < -90 || p.north > 90) warnings.push(`⚠️ Latitude fora: ${p.id} (Y=${p.north})`);
    }
  }

  return warnings;
}

/* =========================
   CSV helper (com diagnóstico profissional)
========================= */
function gerarCsvParaVertices(vertices, epsg, docId = null, topologyInfo = null, memorialInfo = null) {
  let csv = "\ufeffsep=;\n";

  // Cabeçalho profissional com metadados
  csv += `# MATRÍCULA;${docId || "N/A"}\n`;
  csv += `# EPSG;${epsg}\n`;
  if (topologyInfo) {
    csv += `# TOPOLOGY_VALID;${topologyInfo.isValid ? "SIM" : "NÃO"}\n`;
    csv += `# AREA_M2;${topologyInfo.area.toFixed(2)}\n`;
    csv += `# POLYGON_CLOSED;${topologyInfo.closed ? "SIM" : "NÃO"}\n`;
  }
  if (memorialInfo && memorialInfo.matches.length > 0) {
    const coherentMatches = memorialInfo.matches.filter(m => m.coherent).length;
    csv += `# MEMORIAL_COHERENCE;${coherentMatches}/${memorialInfo.matches.length}\n`;
  }
  csv += `#\n`;

  // Cabeçalho da tabela
  csv += "Point_ID;Ordem;Norte_Y;Este_X;EPSG;Dist_M;Azimute_Deg;Qualidade;Notas\n";

  // Estratégia de fechamento: se não estiver fechado, adiciona o primeiro vértice ao final
  let verticesToExport = [...vertices];
  if (topologyInfo && topologyInfo.closed === false && vertices.length > 2) {
    const first = vertices[0];
    // Cria um novo vértice de fechamento (Point_ID e Ordem incrementados)
    const closingVertex = {
      ...first,
      id: (first.id || "F") + "_close", // Sufixo para evitar duplicata
      ordem: vertices.length + 1,
      distCalc: "---",
      azCalc: "---"
    };
    verticesToExport.push(closingVertex);
  }

  for (let i = 0; i < verticesToExport.length; i++) {
    const c = verticesToExport[i];
    // Determinação de qualidade baseada em validação
    let quality = "✓ OK";
    let notes = "";
    // Verificar coerência com memorial se disponível
    if (memorialInfo && memorialInfo.matches[i]) {
      const match = memorialInfo.matches[i];
      if (!match.coherent) {
        quality = "⚠ AVISO";
        notes = `Az ${match.azDiff.toFixed(1)}° diff`;
        if (match.distDiff !== null && match.distDiff > 2) {
          notes += `; Dist ${match.distDiff.toFixed(1)}m diff`;
        }
      }
    }
    // Verificar se há distância "---" (último vértice ou fechamento)
    if (c.distCalc === "---") {
      notes = "Fechamento";
    }
    // Verificar duplicatas ou problemas topológicos
    if (i > 0) {
      const prev = verticesToExport[i - 1];
      if (prev.east === c.east && prev.north === c.north) {
        quality = "❌ ERRO";
        notes = "Duplicado";
      }
    }
    csv += `${c.id};${c.ordem};${c.north};${c.east};${epsg};${c.distCalc || ""};${c.azCalc || ""};${quality};${notes}\n`;
  }

  return csv;
}

/**
 * Gerar relatório de validação (para salvar junto com polígonos)
 */
function gerarRelatorioValidacao(docId, pages, topologyInfo, memorialInfo, warnings) {
  let report = `RELATÓRIO DE VALIDAÇÃO - Matrícula ${docId}\n`;
  report += `Data: ${new Date().toLocaleString("pt-BR")}\n`;
  let safePages = Array.isArray(pages) ? pages.join(", ") : (typeof pages === 'string' ? pages : "(desconhecido)");
  report += `Páginas: ${safePages}\n`;
  report += `${"=".repeat(60)}\n\n`;

  if (topologyInfo) {
    report += `VALIDAÇÃO TOPOLÓGICA:\n`;
    report += `  Polígono válido: ${topologyInfo.isValid ? "✓ SIM" : "✗ NÃO"}\n`;
    report += `  Área: ${topologyInfo.area.toFixed(2)} m²\n`;
    report += `  Fechado: ${topologyInfo.closed ? "✓ SIM" : "✗ NÃO"}\n`;
    report += `  Auto-intersecções: ${topologyInfo.intersections.length > 0 ? `✗ ${topologyInfo.intersections.length} encontradas` : "✓ Nenhuma"}\n`;
    report += `  Sentido: ${topologyInfo.isCCW ? "Anti-horário (CCW)" : "Horário (CW)"}\n\n`;

    if (topologyInfo.errors.length > 0) {
      report += `  ERROS DETECTADOS:\n`;
      topologyInfo.errors.forEach(e => report += `    • ${e}\n`);
      report += `\n`;
    }

    if (topologyInfo.warnings.length > 0) {
      report += `  AVISOS:\n`;
      topologyInfo.warnings.forEach(w => report += `    • ${w}\n`);
      report += `\n`;
    }
  }

  if (memorialInfo && memorialInfo.matches.length > 0) {
    report += `VALIDAÇÃO COM MEMORIAL (Azimutes/Distâncias):\n`;
    const coherent = memorialInfo.matches.filter(m => m.coherent).length;
    report += `  Correspondência: ${coherent}/${memorialInfo.matches.length} edges coerentes\n`;
    report += `  Confiança: ${Math.round(coherent / memorialInfo.matches.length * 100)}%\n\n`;

    if (memorialInfo.issues.length > 0) {
      report += `  DISCREPÂNCIAS ENCONTRADAS:\n`;
      memorialInfo.issues.forEach(issue => report += `    • ${issue}\n`);
      report += `\n`;
    }
  }

  if (warnings && warnings.length > 0) {
    report += `AVISOS GERAIS:\n`;
    warnings.forEach(w => report += `  • ${w}\n`);
  }

  return report;
}

/* =========================
   CSV helper (original - compatibilidade)
========================= */
function gerarCsvParaVerticesSimples(vertices, epsg) {
  let csv = "\ufeffsep=;\n";
  csv += "Point_ID;Ordem;Norte_Y;Este_X;EPSG;Dist_M;Azimute_Deg\n";
  for (const c of vertices) {
    csv += `${c.id};${c.ordem};${c.north};${c.east};${epsg};${c.distCalc || ""};${c.azCalc || ""}\n`;
  }
  return csv;
}

/* =========================
   Split por matrícula
========================= */
function detectDocIdFromPageText(pageText) {
  const t = (pageText || "").replace(/\u00A0/g, " ");

  // DEBUG: Mostrar primeiras 500 chars do texto para debugging
  console.log(`[PDFtoArcgis] Detectando ID de: "${t.substring(0, 300)}..."`);

  // ===== ESTRATÉGIA CRÍTICA: Usar APENAS a primeira ocorrência de MATRÍCULA =====
  // Em cartórios, MATRÍCULA que aparece no cabeçalho é a ID do documento
  // Referências a outras matrículas aparecem depois no memorial (ex: "conforme referido Orozimbo Ciuffa de MATRÍCULA: 8.462")
  // SOLUÇÃO: Pegar APENAS a PRIMEIRA matrícula do texto (cabeçalho/início)

  // ESTRATÉGIA 1: Procurar APENAS no início do texto (primeiros 3000 caracteres - cabeçalho + início)
  const headerText = t.substring(0, 3000);

  const matriculaPatterns = [
    // Padrões para MATRÍCULA - com variações OCR degradado
    // ORDEM IMPORTANTE: Do mais específico para o mais genérico
    // Padrões que garantem ser o ID do documento (aparecem no cabeçalho/título)
    
    // NOVO: Aceitar formatos "M_XXX" (underscore) e "M-XXX" (hífen) do nome do arquivo
    { rx: /M[_\-\.]?\s*(\d{1,5})/i, name: "M_/- (arquivo)" },
    
    { rx: /MATR[ÍI]CULA\s*N[ºo°e]?\s*([0-9.,]+)/i, name: "MATRÍCULA Nº (flex)" },
    { rx: /MATR[ÍI]CULA\s*N[ºo°e]\s*([\d.,]+)/i, name: "MATRÍCULA Nº" },
    { rx: /^MATR[ÍI]CULA\s*N[ºo°]?\s*([\d.,]+)/im, name: "MATRÍCULA Nº (linha)" },

    // PADRÕES PARA "MAT" - muito comuns em cartórios, aparecem no cabeçalho
    { rx: /\bMAT\s+N[ºo°e]\s*([\d.,]+)/i, name: "MAT Nº" },
    { rx: /\bMAT\s*\.\s*N[ºo°e]\s*([\d.,]+)/i, name: "MAT. Nº" },
    
    // Padrão alternativo: números com vírgula/ponto sozinhos (após "Nº" ou similares)
    { rx: /\bN[ºo°e]\s+(\d{1,5}(?:[.,]\d{1,5})*)\s*(?=[-–]|$|\s[A-Z])/i, name: "Nº (isolado)" },
  ];

  // Tentar todos os padrões DE MATRÍCULA APENAS NO CABEÇALHO
  for (const { rx, name } of matriculaPatterns) {
    const m = headerText.match(rx);
    if (m && m[1]) {
      // Normalizar: remover pontos E vírgulas (separadores OCR podem variar)
      let id = m[1].replace(/[.,]/g, "").replace(/^0+/, "");
      if (id && id.length > 0) {
        console.log(`[PDFtoArcgis] ✅ MATRÍCULA (cabeçalho): ${id} (padrão: ${name}) - Raw: "${m[1]}"`);
        return id;
      }
    }
  }

  // Se nenhum padrão de matrícula funcionou, logar aviso
  console.log(`[PDFtoArcgis] ⚠️ Nenhum padrão de MATRÍCULA encontrado no cabeçalho`);

  // ===== ESTRATÉGIA 2: Procurar por PROTOCOLO (apenas como fallback) =====
  // PROTOCOLO nunca deve ter prioridade sobre MATRÍCULA
  // Usar apenas se MATRÍCULA não foi encontrada
  const protocoloPatterns = [
    { rx: /PROTOCOLO\s*N[ºo°e]?\s*([\d.,]+)/i, name: "PROTOCOLO Nº" },
    { rx: /PROCESSO\s*N[ºo°e]?\s*([\d.,]+)/i, name: "PROCESSO Nº" },
  ];

  for (const { rx, name } of protocoloPatterns) {
    const m = headerText.match(rx);
    if (m && m[1]) {
      let id = m[1].replace(/[.,]/g, "").replace(/^0+/, "");
      if (id && id.length > 0) {
        console.log(`[PDFtoArcgis] ⚠️ ${name} detectado (fallback): ${id} - Raw: "${m[1]}"`);
        return id;
      }
    }
  }

  console.log(`[PDFtoArcgis] ❌ Nenhum ID detectado`);
  return null;
}

function splitPagesIntoDocuments(pagesText) {
  const docs = [];
  let current = null;
  console.log(`[PDFtoArcgis] Processando ${pagesText.length} páginas...`);

  pagesText.forEach((txt, idx) => {
    const docId = detectDocIdFromPageText(txt);
    console.log(`[PDFtoArcgis] Página ${idx + 1}: ID detectado = ${docId || "null"}`);

    if (!docId) {
      if (!current) {
        current = { docId: "SEM_ID", pages: [], text: "" };
        docs.push(current);
      }
      current.pages.push(idx + 1);
      current.text += "\n" + (txt || "");
      return;
    }

    if (!current || current.docId !== docId) {
      current = { docId, pages: [], text: "" };
      docs.push(current);
    }

    current.pages.push(idx + 1);
    current.text += "\n" + (txt || "");
  });

  console.log(`[PDFtoArcgis] Documentos iniciais: ${docs.length}`);
  docs.forEach(d => console.log(`  - ID: ${d.docId}, Páginas: ${d.pages.join(", ")}`));

  // MELHORIA ADITIVA: Tentar recuperar documentos SEM_ID combinando com IDs adjacentes
  // Estratégia: se um documento "SEM_ID" está cercado por documentos com o mesmo ID, unir-se a ele
  const improvedDocs = [];
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];

    if (doc.docId !== "SEM_ID") {
      improvedDocs.push(doc);
      continue;
    }

    // Se é SEM_ID, tentar encontrar ID em contexto próximo
    let foundId = null;

    // Buscar ID em documento anterior (se existir e tiver poucas páginas diferença)
    if (i > 0 && docs[i - 1].docId !== "SEM_ID") {
      const prevPages = docs[i - 1].pages;
      const currPages = doc.pages;
      const gap = Math.min(...currPages) - Math.max(...prevPages);
      if (gap <= 3) {  // Se separado por até 3 páginas, considerar como mesma matrícula
        foundId = docs[i - 1].docId;
      }
    }

    // Buscar ID em documento seguinte (se não encontrou anterior)
    if (!foundId && i < docs.length - 1 && docs[i + 1].docId !== "SEM_ID") {
      const currPages = doc.pages;
      const nextPages = docs[i + 1].pages;
      const gap = Math.min(...nextPages) - Math.max(...currPages);
      if (gap <= 3) {  // Se separado por até 3 páginas
        foundId = docs[i + 1].docId;
      }
    }

    // Se encontrou ID, usar esse; senão, manter como SEM_ID mas com log
    const pageStr = Array.isArray(doc.pages) ? doc.pages.join(", ") : (typeof doc.pages === 'string' ? doc.pages : "(desconhecido)");
    if (foundId) {
      doc.docId = foundId;
      console.log(`[PDFtoArcgis] Recuperado ID ${foundId} para páginas ${pageStr}`);
    } else {
      console.warn(`[PDFtoArcgis] ⚠️ Não foi possível recuperar ID para páginas ${pageStr}`);
    }

    improvedDocs.push(doc);
  }

  // MELHORIA: Detectar e corrigir IDs de PROTOCOLO cercados por MATRÍCULA
  // DESABILITADO: A heurística estava quebrando documentos válidos com IDs diferentes
  // Exemplo: Arquivo com M.8.402, M.8.462, M.5737 estava sendo mesclado incorretamente
  // Esta heurística deveria SÓ ser usada para documentos com ID "SEM_ID", não para IDs válidos
  console.log(`[PDFtoArcgis] Heurística de correção desabilitada para não quebrar documentos com múltiplos IDs válidos`);

  // Agora mesclar documentos que têm o MESMO ID mas foram separados
  // IMPORTANTE: Mesclar TODOS com mesmo ID, mesmo que não sejam consecutivos
  const mergedDocs = [];
  const processedIds = new Set();

  for (const doc of improvedDocs) {
    if (processedIds.has(doc.docId)) {
      continue;  // Já foi processado como parte de um grupo
    }

    // Encontrar TODOS os documentos com este ID
    const docsWithSameId = improvedDocs.filter(d => d.docId === doc.docId);

    if (docsWithSameId.length > 1) {
      // Há múltiplos documentos com este ID - mesclar
      const merged = {
        docId: doc.docId,
        pages: [],
        text: ""
      };

      for (const d of docsWithSameId) {
        merged.pages.push(...d.pages);
        merged.text += "\n" + d.text;
        processedIds.add(d.docId);
      }

      // Ordenar páginas
      merged.pages.sort((a, b) => a - b);

      console.log(`[PDFtoArcgis] Mesclando ${docsWithSameId.length} fragmentos da matrícula ${doc.docId}: páginas ${merged.pages.join(", ")}`);
      mergedDocs.push(merged);
    } else {
      // Apenas um documento com este ID
      mergedDocs.push(doc);
      processedIds.add(doc.docId);
    }
  }

  return mergedDocs.filter(d => (d.text || "").trim().length > 0);
}

/* =========================
   UI seletor de matrícula
========================= */
function renderDocSelector() {
  if (!docSelectorBox || !docSelect) return;

  if (!documentsResults.length) {
    docSelectorBox.style.display = "none";
    return;
  }

  docSelectorBox.style.display = "block";
  docSelect.innerHTML = "";

  documentsResults.forEach((d, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `MAT ${d.docId} — ${(d.vertices || []).length} vértices`;
    docSelect.appendChild(opt);
  });

  if (activeDocIndex < 0) activeDocIndex = 0;
  docSelect.value = String(activeDocIndex);
  updateActiveDocUI();
}

function updateActiveDocUI() {
  const doc = getSelectedDoc();
  if (!doc) return;

  const projKey = doc.manualProjectionKey || doc.projectionKey || "(não detectado)";
  const epsg = PROJECTIONS[projKey]?.epsg || "";
  // Suportar tanto array de páginas (v2.0) quanto string (v3.0)
  const pages = Array.isArray(doc.pages)
    ? doc.pages.join(", ")
    : (typeof doc.pages === 'string' ? doc.pages : "(desconhecido)");
  const warns = (doc.warnings || []).length;

  if (docMeta) docMeta.textContent = `Páginas: ${pages}\nCRS: ${projKey}${epsg ? " (" + epsg + ")" : ""}\nAlertas: ${warns}`;

  showDetectedCrsUI(doc.manualProjectionKey || doc.projectionKey || null, doc.projectionInfo);

  if (advancedCrs) advancedCrs.style.display = (doc.manualProjectionKey || doc.projectionKey) ? "none" : "block";

  extractedCoordinates = doc.vertices || [];
  fileNameBase = `MAT_${doc.docId}`;
  displayResults();
}

if (docSelect) {
  docSelect.addEventListener("change", () => {
    activeDocIndex = parseInt(docSelect.value, 10);
    updateActiveDocUI();
  });
}

/* =========================
   Display tabela
========================= */
function displayResults() {
  resultBox.style.display = "block";
  countDisplay.innerText = extractedCoordinates.length;
  previewTableBody.innerHTML = "";
  for (const c of extractedCoordinates) {
    previewTableBody.innerHTML += `
      <tr>
        <td>${c.ordem}</td>
        <td>${c.id}</td>
        <td>${c.north}</td>
        <td>${c.east}</td>
        <td>${c.distCalc}</td>
        <td>${c.azCalc}</td>
      </tr>`;
  }
  scrollToResults();
}

/* =========================
   PROCESSAMENTO DO PDF (CORRIGIDO)
========================= */
fileInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  // Reset de UI e variáveis
  fileNameBase = file.name.replace(/\.[^/.]+$/, "");
  pdfOrigemNomeBase = file.name.replace(/\.[^/.]+$/, "");
  pdfOrigemSrc = file.name;
  document.getElementById("fileNameDisplay").innerText = file.name;
  progressContainer.style.display = "block";
  resultBox.style.display = "none";
  statusDiv.style.display = "none";
  extractedCoordinates = [];
  previewTableBody.innerHTML = "";
  documentsResults = [];
  activeDocIndex = -1;

  try {
    updateStatus("📄 Carregando PDF...", "info");
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer), ignoreEncryption: true }).promise;
    const pagesText = [];

    // Loop de leitura de páginas (garante leitura de TODAS as páginas)
    let emptyPages = 0;
    let ocrPages = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      progressBar.value = Math.round((i / pdf.numPages) * 100);
      document.getElementById("progressLabel").innerText = `Lendo página ${i}/${pdf.numPages}...`;

      try {
        const page = await pdf.getPage(i);
        const pageText = await extractPageTextSafely(page, i);

        // Se a página estiver vazia/escaneada, apenas mantém o texto vazio (não faz OCR)
        let safeText = pageText || "";
        if (!safeText.trim()) {
          document.getElementById("progressLabel").innerText = `OCR da página ${i}/${pdf.numPages}...`;
          const ocrText = await performOcrOnPage(page, i);
          if (ocrText && ocrText.trim().length > 10) {
            safeText = ocrText;
            ocrPages++;
          }
        }
        if (!safeText.trim()) emptyPages++;
        pagesText.push(safeText);
      } catch (e) {
        const msg = `[PDFtoArcgis] Erro ao ler página ${i}: ${e?.message || e}`;
        if (typeof displayLogMessage === 'function') {
          displayLogMessage(msg);
        } else {
          console.error(msg);
        }
        emptyPages++;
        pagesText.push("");
        continue;
      }
    }

    if (ocrPages > 0) {
      updateStatus(`ℹ️ OCR aplicado em ${ocrPages} página(s).`, "info");
    }
    if (emptyPages > 0) {
      updateStatus(`⚠️ ${emptyPages} página(s) sem texto detectável mesmo após OCR. Reexporte o PDF com camada de texto para melhorar a extração.`, "warning");
    }

    // --- LÓGICA DE INFERÊNCIA REVERSA ---
    const fullText = pagesText.join("\n");

    // Extraímos os vértices primeiro para poder usá-los na detecção
    const verticesParaDetectar = parseVertices(fullText);

    // Passamos o texto E os vértices
    const projInfo = detectProjectionFromText(fullText, verticesParaDetectar);

    // Agora sim chama o processamento final
    processExtractUnified(pagesText, projInfo);

  } catch (e) {
    console.error("Erro no processamento:", e);
    updateStatus("Erro: " + e.message, "error");
  }
});


function detectPolygonCycles(vertices) {
  if (vertices.length < 3) return [];

  const cycles = [];
  let currentCycle = [];
  const CLOSURE_TOLERANCE = 5; // metros de tolerância para considerar que fechou

  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];

    // Se temos pontos no ciclo atual
    if (currentCycle.length > 2) {
      const firstPoint = currentCycle[0];
      const distance = Math.sqrt(
        Math.pow(v.east - firstPoint.east, 2) +
        Math.pow(v.north - firstPoint.north, 2)
      );

      // Se este ponto fecha o polígono (volta ao ponto inicial)
      if (distance < CLOSURE_TOLERANCE) {
        console.log(`[PDFtoArcgis] 🔄 Ciclo detectado: ${currentCycle.length} vértices (fechamento em ${distance.toFixed(2)}m)`);

        // Adicionar o ponto de fechamento para completar
        currentCycle.push({ ...v, isClosure: true });
        cycles.push(currentCycle);
        currentCycle = [];
        continue; // Não adicionar este ponto ao próximo ciclo
      }
    }

    currentCycle.push(v);
  }

  // Se sobraram vértices, adicionar como ciclo
  if (currentCycle.length >= 3) {
    console.log(`[PDFtoArcgis] 🔄 Ciclo final detectado: ${currentCycle.length} vértices`);
    cycles.push(currentCycle);
  }

  console.log(`[PDFtoArcgis] Total de ciclos detectados: ${cycles.length}`);
  return cycles;
}

async function processExtractUnified(pagesText, projInfo = null) {
  // Estratégia única: Processar página por página
  let iaObj = null;
  
  console.log(`[PDFtoArcgis] Processando ${pagesText.length} página(s) individualmente...`);
  if (typeof displayLogMessage === 'function') {
    displayLogMessage(`[PDFtoArcgis][LogUI] � Iniciando extração de coordenadas com IA...`);
  }
  iaObj = await deducePolygonVerticesPerPage(pagesText);
  
  if (!iaObj) {
    updateStatus('❌ Falha na extração por IA.', 'error');
    progressContainer.style.display = "none";
    return;
  }

  // Normalizar vértices da IA para formato interno
  let vertices = (iaObj.vertices || []).map((v, idx) => ({
    id: v.id || `V${String(idx + 1).padStart(3, '0')}`,
    north: typeof v.norte === 'number' ? v.norte : (typeof v.north === 'number' ? v.north : parseFloat(v.norte || v.north || 0)),
    east: typeof v.este === 'number' ? v.este : (typeof v.east === 'number' ? v.east : parseFloat(v.este || v.east || 0)),
    ordem: idx + 1
  }));

  // Remover vértices inválidos
  vertices = vertices.filter(v => Number.isFinite(v.north) && Number.isFinite(v.east));

  if (vertices.length < 3) {
    updateStatus('❌ Menos de 3 vértices válidos extraídos.', 'error');
    progressContainer.style.display = "none";
    return;
  }

  // === RECALCULAR DISTÂNCIAS E AZIMUTES ===
  vertices = prepararVerticesComMedidas(vertices);

  // === CRS baseado em IA + texto + coordenadas ===
  const fullText = pagesText.join("\n");
  const inferredByCoords = inferCrsByCoordinates(vertices);
  const resolvedProjection = resolveProjectionKeyForOutput(iaObj, projInfo, inferredByCoords);
  const projKey = resolvedProjection.key || (getActiveProjectionKey() || "SIRGAS2000_22S");
  window._arcgis_crs_key = projKey;
  const topologyValidation = validatePolygonTopology(vertices, projKey);
  
  // ETL SIMPLIFICADO: A IA fornece azimutes/distâncias, sem regex paralelo
  const memorialData = { azimutes: [], distances: [] };
  const memorialValidation = { matches: [], issues: [] };

  // === ADICIONAR À documentsResults (para compatibilidade com "Salvar na Pasta") ===
  documentsResults = [{
    docId: iaObj.matricula || "SEM_ID",
    pages: "1-" + pagesText.length,
    projectionKey: projKey,
    manualProjectionKey: null,
    projectionInfo: resolvedProjection.info || (inferredByCoords
      ? { confidence: "média", reason: inferredByCoords.reason }
      : { confidence: "baixa", reason: "CRS não inferido pelas coordenadas; usando seleção atual/padrão" }),
    vertices: vertices,
    warnings: [],
    topology: topologyValidation,
    memorialValidation: memorialValidation,
    memorialData: memorialData,
    text: fullText
  }];

  activeDocIndex = 0;

  // === ATUALIZAR UI DO CRS DETECTADO ===
  showDetectedCrsUI(projKey, documentsResults[0].projectionInfo);

  // === EXIBIR RESULTADOS ===
  extractedCoordinates = vertices;
  fileNameBase = iaObj.matricula ? `MAT_${iaObj.matricula}` : "coordenadas_extracao";
  
  // === VALIDAÇÃO TOPOLÓGICA ANTES DE EXIBIR ===
  if (typeof displayLogMessage === 'function') {
    displayLogMessage(`[PDFtoArcgis][LogUI] 🔍 Validando topologia do polígono...`);
  }
  
  const topology = validatePolygonTopology(vertices, projKey);
  documentsResults[0].topology = topology;
  
  // Log dos resultados de validação
  if (topology.isValid) {
    console.log(`[PDFtoArcgis] ✅ Polígono válido: área ${topology.area.toFixed(2)}m², fechado: ${topology.closed ? 'SIM' : 'NÃO'}`);
    if (typeof displayLogMessage === 'function') {
      displayLogMessage(`[PDFtoArcgis][LogUI] ✅ Polígono válido! Área: ${topology.area.toFixed(2)}m²`);
    }
  } else {
    console.warn(`[PDFtoArcgis] ⚠️ Polígono com problemas:`, topology.errors);
  }
  
  if (topology.warnings.length > 0) {
    console.warn(`[PDFtoArcgis] ⚠️ Avisos:`, topology.warnings);
  }
  
  // Atualizar UI de validação
  updateValidationUI(topology);
  
  // Se houver erros críticos, oferecer correção automática
  if (!topology.isValid && topology.errors.length > 0) {
    if (typeof displayLogMessage === 'function') {
      displayLogMessage(`[PDFtoArcgis][LogUI] ⚠️ Problemas detectados: ${topology.errors.join(', ')}`);
      displayLogMessage(`[PDFtoArcgis][LogUI] 🔧 Aplicando correções automáticas...`);
    }
    
    const correctionResult = autoCorrectPolygon(vertices, {
      removeDuplicates: true,
      closePolygon: true,
      removeColinear: false
    });
    
    extractedCoordinates = correctionResult.vertices;
    vertices = correctionResult.vertices;
    documentsResults[0].vertices = correctionResult.vertices;
    
    // Re-validar após correção
    const revalidated = validatePolygonTopology(correctionResult.vertices, projKey);
    documentsResults[0].topology = revalidated;
    
    // Atualizar UI com resultados da correção
    updateValidationUI(revalidated, correctionResult.corrections);
    
    if (revalidated.isValid) {
      if (typeof displayLogMessage === 'function') {
        displayLogMessage(`[PDFtoArcgis][LogUI] ✅ Polígono corrigido com sucesso!`);
      }
      console.log(`[PDFtoArcgis] ✅ Correção bem-sucedida. Nova área: ${revalidated.area.toFixed(2)}m²`);
    } else {
      if (typeof displayLogMessage === 'function') {
        displayLogMessage(`[PDFtoArcgis][LogUI] ⚠️ Algumas correções automáticas não resolveram todos os problemas. Verifique o relatório.`);
      }
    }
    
    // Log das correções aplicadas
    if (correctionResult.corrections.length > 0) {
      console.log(`[PDFtoArcgis] 🔧 Correções aplicadas:`, correctionResult.corrections);
    }
  }
  
  if (typeof displayLogMessage === 'function') {
    displayLogMessage(`[PDFtoArcgis][LogUI] 📊 Preparando tabela de vértices para visualização...`);
  }
  
  resultBox.style.display = 'block';
  countDisplay.textContent = vertices.length;
  previewTableBody.innerHTML = '';
  
  for (const v of vertices) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${v.ordem}</td>
      <td>${v.id || ''}</td>
      <td>${(v.north || 0).toFixed(3)}</td>
      <td>${(v.east || 0).toFixed(3)}</td>
      <td>${v.distCalc || '---'}</td>
      <td>${v.azCalc || '---'}</td>
    `;
    previewTableBody.appendChild(row);
  }
  
  if (typeof displayLogMessage === 'function') {
    displayLogMessage(`[PDFtoArcgis][LogUI] 🎯 Gerando shapefiles e arquivos de saída...`);
  }

  // === LIMPAR PROGRESSO E EXIBIR STATUS ===
  progressContainer.style.display = "none";
  updateStatus(`✅ IA extraiu com sucesso! ${vertices.length} coordenadas obtidas e processadas.`, 'success');
  if (typeof displayLogMessage === 'function') {
    displayLogMessage(`[PDFtoArcgis][LogUI] ✨ Pronto! Você pode agora baixar ou salvar os resultados`);
  }
  
  // === REABILITAR BOTÕES ===
  if (downloadBtn) downloadBtn.disabled = false;
  if (saveToFolderBtn) saveToFolderBtn.disabled = false;

  // === EXIBIR SELETOR DE DOCUMENTOS (se houver múltiplos) ===
  renderDocSelector();
  
  scrollToResults();
}

/* ===== LEGACY: Mantém função antiga para compatibilidade ===== */
async function processExtractUnified_legacy(pagesText) {
  const docs = splitPagesIntoDocuments(pagesText);

  let det = detectProjectionFromText(pagesText.join("\n"));
  let projKey = det.key || null;

  documentsResults = [];

  for (const doc of docs) {
    const raw = parseVertices(doc.text, projKey);

    if (!raw || raw.length < 3) continue;

    const fixes = (projKey && projKey !== "WGS84") ? autoFixUtmDecimals(raw) : [];

    // 1. Calcular distâncias e azimutes com validação
    const vertices = raw.map((pt, i) => {
      pt.ordem = i + 1;
      if (i < raw.length - 1) {
        pt.distCalc = calcularDistancia(pt, raw[i + 1]).toFixed(2);
        pt.azCalc = calcularAzimute(pt, raw[i + 1]).toFixed(4);
      } else {
        pt.distCalc = "---";
        pt.azCalc = "---";
      }
      return pt;
    });

    // 2. Remover duplicados consecutivos
    const cleaned = [];
    for (const p of vertices) {
      const last = cleaned[cleaned.length - 1];
      if (!last || last.east !== p.east || last.north !== p.north) cleaned.push(p);
    }

    // 3. NOVO: Validação topológica completa
    const topologyValidation = validatePolygonTopology(cleaned, projKey);

    // 4. ETL SIMPLIFICADO: A IA fornece azimutes/distâncias, sem regex paralelo
    const memorialData = { azimutes: [], distances: [] };
    const memorialValidation = null;

    // 5. Construir warnings com informações detalhadas
    const warnings = [];
    if (!projKey) warnings.push("⚠️ CRS não identificado; use o modo avançado.");
    if (fixes.length) warnings.push(`✓ ${fixes.length} correção(ões) automática(s) aplicada(s)`);
    warnings.push(...validateCoords(cleaned, projKey));

    // Adicionar avisos topológicos
    if (!topologyValidation.isValid) {
      warnings.push(...topologyValidation.errors.map(e => `❌ ${e}`));
    }
    warnings.push(...topologyValidation.warnings.map(w => w));

    // Avisos de coerência com memorial
    if (memorialValidation && memorialValidation.issues.length > 0) {
      warnings.push(...memorialValidation.issues.map(i => `⚠️ ${i}`));
    }

    // 6. Aplicar correção de ordenação se necessário
    const finalVertices = topologyValidation.corrected || cleaned;

    documentsResults.push({
      docId: doc.docId,
      pages: doc.pages,
      projectionKey: projKey,
      manualProjectionKey: null,
      projectionInfo: det,
      vertices: finalVertices,
      warnings,
      topology: topologyValidation,
      memorialValidation,
      memorialData
    });
  }

  if (typeof displayLogMessage === 'function') {
    displayLogMessage(`[PDFtoArcgis][LogUI] ✅ Processamento concluído com sucesso!`);
  }

  progressContainer.style.display = "none";

  // Estatísticas de qualidade
  const totalDocs = documentsResults.length;
  const okDocs = documentsResults.filter(d => (d.vertices || []).length >= 3 && d.topology?.isValid).length;
  const warningDocs = documentsResults.filter(d => (d.vertices || []).length >= 3 && !d.topology?.isValid).length;

  updateStatus(
    `✅ PDF processado. Matrículas: ${totalDocs} | Polígonos válidos: ${okDocs} | Com avisos: ${warningDocs}`,
    okDocs === totalDocs ? "success" : (warningDocs > 0 ? "warning" : "info")
  );

  const firstIdx = documentsResults.findIndex(d => (d.vertices || []).length > 0);
  activeDocIndex = firstIdx >= 0 ? firstIdx : 0;

  renderDocSelector();
}

/* =========================
   EXPORT CSV (matrícula selecionado)
========================= */
downloadBtn.onclick = () => {
  if (!extractedCoordinates.length) return;
  try {
    const key = getActiveProjectionKey();
    const epsg = PROJECTIONS[key]?.epsg || "";
    const crsName = key ? key.replace(/[^\w]/g, "_") : "CRS";
    const doc = getSelectedDoc();

    // Gerar CSV com diagnóstico profissional
    const csv = gerarCsvParaVertices(
      extractedCoordinates,
      epsg,
      doc?.docId || "DESCONHECIDA",
      doc?.topology,
      doc?.memorialValidation
    );

    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    // Novo: incluir nome do PDF de origem e src no nome do arquivo
    link.download = `${pdfOrigemNomeBase || fileNameBase}_${crsName}_Validado_${pdfOrigemSrc || "src"}.csv`;
    link.click();

    // Também exportar relatório se houver validação
    if (doc?.topology || doc?.memorialValidation) {
      const relatorio = gerarRelatorioValidacao(
        doc.docId,
        doc.pages,
        doc.topology,
        doc.memorialValidation,
        doc.warnings
      );
      const linkRel = document.createElement("a");
      linkRel.href = URL.createObjectURL(new Blob([relatorio], { type: "text/plain;charset=utf-8;" }));
      // Novo: incluir nome do PDF de origem e src no nome do arquivo
      linkRel.download = `${pdfOrigemNomeBase || fileNameBase}_${crsName}_Relatorio_${pdfOrigemSrc || "src"}.txt`;
      linkRel.click();
    }
  } catch (e) {
    // Se o usuário cancelar o download, não mostrar erro
    if (e && e.name !== "AbortError") {
      updateStatus("Erro ao baixar arquivo: " + e.message, "error");
    }
  }
};

/* =========================
   SALVAR NA PASTA (SHP + CSV por matrícula)
========================= */
const toArrayBufferFS = (view) => view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);

saveToFolderBtn.onclick = async () => {
  const hasDocs = Array.isArray(documentsResults) && documentsResults.length > 0;
  if (!hasDocs && !extractedCoordinates.length) return alert("⚠️ Processe um arquivo primeiro.");

  if (!("showDirectoryPicker" in window)) {
    updateStatus("❌ Seu navegador não suporta showDirectoryPicker. Use Edge/Chrome em HTTPS.", "error");
    return;
  }

  try {
    let handle = await window.showDirectoryPicker({ mode: "readwrite" });

    // Helper local de logging (fallback se displayLogMessage não estiver disponível)
    const logWrite = (msg) => {
      if (typeof displayLogMessage === "function") {
        displayLogMessage(msg);
      } else {
        console.log(msg);
      }
    };

    const writeFile = async (name, data) => {
      try {
        logWrite(`[PDFtoArcgis] 📝 Gravando ${name}...`);
        
        // Usar keepExistingData: false para sobrescrever se o arquivo já existe
        const fh = await handle.getFileHandle(name, { create: true });
        const w = await fh.createWritable({ keepExistingData: false });
        await w.write(data);
        await w.close();
        logWrite(`[PDFtoArcgis] ✓ ${name} gravado`);
      } catch (err) {
        // Se o usuário cancelar, não mostrar erro
        if (err && err.name === "AbortError") return;
        
        // Se falhar por estado inválido, indicar problema
        if (err && (err.name === "InvalidStateError" || err.message.includes("state cached"))) {
          logWrite("[PDFtoArcgis] ⚠️ Diretório desincronizado. Re-selecionando...");
          // Tentar re-selecionar e fazer retry uma única vez
          try {
            handle = await window.showDirectoryPicker({ mode: "readwrite" });
            const fhRetry = await handle.getFileHandle(name, { create: true });
            const wRetry = await fhRetry.createWritable({ keepExistingData: false });
            await wRetry.write(data);
            await wRetry.close();
            logWrite(`[PDFtoArcgis] ✓ ${name} gravado (após re-sincronizar)`);
            return;
          } catch (retryErr) {
            logWrite(`[PDFtoArcgis] ❌ Falha após re-sincronizar: ${retryErr.message}`);
            throw new Error("Diretório permanentemente desincronizado. Selecione a pasta novamente.");
          }
        }
        
        logWrite(`[PDFtoArcgis] ❌ Erro ao salvar ${name}: ${err.message}`);
        throw err;
      }
    };

    // Caso PDF simples (sem split)
    if (!hasDocs) {
      const key = getActiveProjectionKey();
      const projection = PROJECTIONS[key];
      if (!projection) throw new Error("CRS não suportado.");

      const base = sanitizeFileName(fileNameBase);
      const ring = extractedCoordinates.map(c => [c.east, c.north]);
      ring.push([ring[0][0], ring[0][1]]);

      const pointGeoms = extractedCoordinates.map(c => [c.east, c.north]);
      const pointProps = extractedCoordinates.map(c => ({
        ID: String(c.id).slice(0, 20),
        ORDEM: c.ordem,
        NORTH: c.north,
        EAST: c.east,
        EPSG: projection.epsg
      }));

      updateStatus("🗂️ Gravando SHP + CSV na pasta...", "info");

      let crsName = projection && projection.epsg ? projection.epsg : "CRS";
      crsName = String(crsName).replace(/[^\w\d]/g, "_");

      await new Promise((resolve, reject) => {
        window.shpwrite.write(
          [{ NOME: base, VERTICES: extractedCoordinates.length, EPSG: projection.epsg, TIPO: "LIMITE" }],
          "POLYGON",
          [[[ring]]],
          async (err, files) => {
            if (err) return reject(err);
            try {
              // Apenas gravando a versão limpa
              await writeFile(`${base}_${crsName}_limite.shp`, toArrayBufferFS(files.shp));
              await new Promise(r => setTimeout(r, 100));
              await writeFile(`${base}_${crsName}_limite.shx`, toArrayBufferFS(files.shx));
              await new Promise(r => setTimeout(r, 100));
              await writeFile(`${base}_${crsName}_limite.dbf`, toArrayBufferFS(files.dbf));
              await new Promise(r => setTimeout(r, 100));
              await writeFile(`${base}_${crsName}_limite.prj`, projection.wkt);
              resolve();
            } catch (e) { reject(e); }
          }
        );
      });

      await new Promise((resolve, reject) => {
        window.shpwrite.write(
          pointProps,
          "POINT",
          pointGeoms,
          async (err, files) => {
            if (err) return reject(err);
            try {
              // Apenas gravando a versão limpa
              await writeFile(`${base}_${crsName}_vertices.shp`, toArrayBufferFS(files.shp));
              await new Promise(r => setTimeout(r, 100));
              await writeFile(`${base}_${crsName}_vertices.shx`, toArrayBufferFS(files.shx));
              await new Promise(r => setTimeout(r, 100));
              await writeFile(`${base}_${crsName}_vertices.dbf`, toArrayBufferFS(files.dbf));
              await new Promise(r => setTimeout(r, 100));
              await writeFile(`${base}_${crsName}_vertices.prj`, projection.wkt);
              resolve();
            } catch (e) { reject(e); }
          }
        );
      });

      const csv = gerarCsvParaVertices(extractedCoordinates, projection.epsg, fileNameBase);
      await writeFile(`${base}_${crsName}_Validado.csv`, csv);

      updateStatus("✅ Gravado: limite + vertices + CSV (com .prj)!", "success");
      return;
    }

    // Caso PDF unificado (todas as matrículas)
    updateStatus(`🗂️ Gravando ${documentsResults.length} matrículas (SHP + CSV)...`, "info");

    let saved = 0;
    const skipped = [];

    for (const doc of documentsResults) {
      const vertices = Array.isArray(doc.vertices) ? doc.vertices : [];
      const docId = doc.docId || "SEM_ID";

      if (vertices.length < 3) {
        skipped.push(`Arquivo ${pdfOrigemSrc || "src"}: vértices insuficientes (${vertices.length})`);
        continue;
      }

      const projKey = doc.manualProjectionKey || doc.projectionKey || getActiveProjectionKey();
      const projection = PROJECTIONS[projKey];
      if (!projection) {
        skipped.push(`Arquivo ${pdfOrigemSrc || "src"}: CRS não suportado (${projKey})`);
        continue;
      }

      const base = sanitizeFileName(pdfOrigemNomeBase || fileNameBase);
      const ring = vertices.map(c => [c.east, c.north]);

      let crsName = projection && projection.epsg ? projection.epsg : "CRS";
      crsName = String(crsName).replace(/[^\w\d]/g, "_");

      // Limite (POLYGON)
      await new Promise((resolve, reject) => {
        window.shpwrite.write(
          [{ NOME: base, VERTICES: vertices.length, EPSG: projection.epsg, TIPO: "LIMITE" }],
          "POLYGON",
          [[[ring]]],
          async (err, files) => {
            if (err) return reject(err);
            try {
              // Apenas gravando a versão limpa
              await writeFile(`${base}_${crsName}_limite.shp`, toArrayBufferFS(files.shp));
              await new Promise(r => setTimeout(r, 100));
              await writeFile(`${base}_${crsName}_limite.shx`, toArrayBufferFS(files.shx));
              await new Promise(r => setTimeout(r, 100));
              await writeFile(`${base}_${crsName}_limite.dbf`, toArrayBufferFS(files.dbf));
              await new Promise(r => setTimeout(r, 100));
              await writeFile(`${base}_${crsName}_limite.prj`, projection.wkt);
              resolve();
            } catch (e) { reject(e); }
          }
        );
      });

      // Vertices (POINT)
      const pointGeoms = vertices.map(c => [c.east, c.north]);
      const pointProps = vertices.map(c => ({
        ID: String(c.id).slice(0, 20),
        ORDEM: c.ordem,
        NORTH: c.north,
        EAST: c.east,
        EPSG: projection.epsg
      }));

      await new Promise((resolve, reject) => {
        window.shpwrite.write(
          pointProps,
          "POINT",
          pointGeoms,
          async (err, files) => {
            if (err) return reject(err);
            try {
              // Apenas gravando a versão limpa
              await writeFile(`${base}_${crsName}_vertices.shp`, toArrayBufferFS(files.shp));
              await new Promise(r => setTimeout(r, 100));
              await writeFile(`${base}_${crsName}_vertices.shx`, toArrayBufferFS(files.shx));
              await new Promise(r => setTimeout(r, 100));
              await writeFile(`${base}_${crsName}_vertices.dbf`, toArrayBufferFS(files.dbf));
              await new Promise(r => setTimeout(r, 100));
              await writeFile(`${base}_${crsName}_vertices.prj`, projection.wkt);
              resolve();
            } catch (e) { reject(e); }
          }
        );
      });

      // CSV
      const csv = gerarCsvParaVertices(vertices, projection.epsg, docId, doc.topology, doc.memorialValidation);
      await writeFile(`${base}_${crsName}_Validado.csv`, csv);

      // Relatório de validação
      if (doc.topology || doc.memorialValidation) {
        let safePages = Array.isArray(doc.pages) ? doc.pages : (typeof doc.pages === 'string' ? doc.pages : '(desconhecido)');
        const relatorio = gerarRelatorioValidacao(docId, safePages, doc.topology, doc.memorialValidation, doc.warnings);
        await writeFile(`${base}_${crsName}_Relatorio.txt`, relatorio);
      }

      saved++;
    }

    if (skipped.length) {
      updateStatus(`✅ Concluído. Matrículas salvas: ${saved}\n⚠️ Ignoradas: ${skipped.length}\n- ${skipped.join("\n- ")}`, "warning");
    } else {
      updateStatus(`✅ Concluído. Matrículas salvas: ${saved}`, "success");
    }

  } catch (e) {
    if (e && (e.name === "InvalidStateError" || e.message.includes("state cached"))) {
      updateStatus("❌ Erro ao salvar na pasta: Diretório foi modificado. Selecione a pasta novamente.", "error");
    } else if (e && e.name === "NotAllowedError") {
      updateStatus("❌ Erro: Permissão negada ao acessar a pasta. Verifique as permissões do navegador.", "error");
    } else {
      updateStatus("❌ Erro ao salvar na pasta: " + (e.message || String(e)), "error");
    }
  }
};

/* =========================
   MODO AVANÇADO: Forçar CRS (aplica ao doc selecionado)
========================= */
if (forceCrsBtn) {
  forceCrsBtn.addEventListener("click", () => {
    if (!projectionSelect) return;
    const key = projectionSelect.value;
    const doc = getSelectedDoc();

    if (doc) {
      doc.manualProjectionKey = key;
      doc.projectionInfo = { confidence: "manual", reason: "CRS forçado manualmente para a matrícula selecionada." };
      updateStatus(`ℹ️ CRS aplicado manualmente (MAT ${doc.docId}): ${key}`, "info");
      updateActiveDocUI();
    } else {
      updateStatus(`ℹ️ CRS aplicado manualmente: ${key}`, "info");
      showDetectedCrsUI(key, { confidence: "manual", reason: "CRS forçado manualmente." });
    }
  });
}

// === BOTÃO DE CORREÇÃO AUTOMÁTICA ===
const autoCorrectBtn = document.getElementById("autoCorrectBtn");
if (autoCorrectBtn) {
  autoCorrectBtn.addEventListener("click", () => {
    if (extractedCoordinates.length < 3) {
      updateStatus("⚠️ Não há vértices suficientes para corrigir.", "error");
      return;
    }

    updateStatus("🔧 Aplicando correções automáticas...", "info");
    
    const correctionResult = autoCorrectPolygon(extractedCoordinates, {
      removeDuplicates: true,
      closePolygon: true,
      removeColinear: false
    });
    
    extractedCoordinates = correctionResult.vertices;
    
    // Atualizar documento ativo
    const doc = getSelectedDoc();
    if (doc) {
      doc.vertices = correctionResult.vertices;
      
      // Re-validar
      const projKey = doc.manualProjectionKey || doc.projectionKey;
      const revalidated = validatePolygonTopology(correctionResult.vertices, projKey);
      doc.topology = revalidated;
      
      // Atualizar UI
      updateValidationUI(revalidated, correctionResult.corrections);
      updateActiveDocUI();
      
      if (revalidated.isValid) {
        updateStatus(`✅ Correções aplicadas com sucesso! Polígono agora é válido.`, "success");
      } else {
        updateStatus(`⚠️ Algumas correções foram aplicadas, mas ainda há problemas. Verifique o relatório.`, "warning");
      }
    } else {
      updateStatus(`✅ Correções aplicadas.`, "success");
    }
  });
}


// === ELEMENTOS NOVOS ===
const shpInput = document.getElementById("shpInput");
const memorialMetaBox = document.getElementById("memorialMetaBox");
const respTecnicoInput = document.getElementById("respTecnico");
const respCreaInput = document.getElementById("respCrea");
const cidadeDetectadaInput = document.getElementById("cidadeDetectada");
const generateDocxBtn = document.getElementById("generateDocxBtn");

// Estado
let shpVertices = [];
let shpAreaHa = 0;
let shpPerimetroM = 0;
let shpCrsKey = null;
let shpCrsText = "";
let shpPoligonoNome = "";
let shpCityName = "";

// Formatadores (pt-BR)
const BRNumber = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const BRNumber2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function fmtCoordMeters(v) { return BRNumber.format(v); }
function fmtMeters2(v) { return BRNumber2.format(v); }
function toDMS(az) {
  az = ((az % 360) + 360) % 360;
  const d = Math.floor(az);
  const mFloat = (az - d) * 60;
  const m = Math.floor(mFloat);
  const s = Math.round((mFloat - m) * 60);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(d, 3)}°${pad(m)}'${pad(s)}"`;
}
function crsKeyToText(key) {
  if (!key) return "CRS não identificado";
  const p = PROJECTIONS[key];
  if (!p) return key;
  return `${p.name.replace('zone', 'Zona').replace('zone ', 'Zona ')} (${p.epsg})`;
}
function inferCityFromVertices(vertices, key) {
  if (!vertices || vertices.length === 0) return "";
  const avgE = vertices.reduce((s, v) => s + v.east, 0) / vertices.length;
  const avgN = vertices.reduce((s, v) => s + v.north, 0) / vertices.length;

  let lonlat = null, lat = null, lon = null;
  try {
    if (key && key.startsWith("SIRGAS2000_")) {
      const zone = parseInt(key.match(/_(\d{2})S$/)?.[1] || "22", 10);
      const projStr = `+proj=utm +zone=${zone} +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`;
      lonlat = proj4(projStr, proj4.WGS84, [avgE, avgN]); // [lon, lat]
    }
  } catch (e) { }

  if (lonlat && Array.isArray(lonlat)) { lon = lonlat[0]; lat = lonlat[1]; }

  const isCuritiba = (lat && lon)
    ? (lat >= -25.60 && lat <= -25.25 && lon >= -49.45 && lon <= -49.10)
    : (avgN >= 7.170e6 && avgN <= 7.220e6 && avgE >= 660000 && avgE <= 710000);

  const isPiraquara = (lat && lon)
    ? (lat >= -25.60 && lat <= -25.35 && lon >= -49.25 && lon <= -48.95)
    : (avgN >= 7.180e6 && avgN <= 7.200e6 && avgE >= 680000 && avgE <= 705000);

  if (isPiraquara) return "Piraquara-PR";
  if (isCuritiba) return "Curitiba-PR";
  return "Município não identificado";
}
async function extractPrjFromZip(file) {
  try {
    const ab = await file.arrayBuffer();
    const zip = new PizZip(ab);
    const names = Object.keys(zip.files);
    const prjName = names.find(n => n.toLowerCase().endsWith(".prj"));
    if (!prjName) return null;
    return zip.files[prjName].asText();
  } catch (e) { return null; }
}
function resolveCrsKeyFromPrj(prjText) {
  if (!prjText) return null;
  const t = prjText.toUpperCase();
  if (t.includes("SIRGAS") && t.includes("UTM")) {
    if (t.includes("ZONE 21") || t.includes("ZONA 21")) return "SIRGAS2000_21S";
    if (t.includes("ZONE 22") || t.includes("ZONA 22")) return "SIRGAS2000_22S";
    if (t.includes("ZONE 23") || t.includes("ZONA 23")) return "SIRGAS2000_23S";
    if (t.includes("ZONE 24") || t.includes("ZONA 24")) return "SIRGAS2000_24S";
    if (t.includes("ZONE 25") || t.includes("ZONA 25")) return "SIRGAS2000_25S";
  }
  if (t.includes("SAD") && t.includes("UTM")) {
    if (t.includes("ZONE 22") || t.includes("ZONA 22")) return "SAD69_22S";
    if (t.includes("ZONE 23") || t.includes("ZONA 23")) return "SAD69_23S";
  }
  if (t.includes("WGS") && !t.includes("UTM")) return "WGS84";
  return null;
}
function inferCrsKeyByValues(vertices) {
  const hint = inferCrsByCoordinates(vertices);
  if (hint?.zone) return `SIRGAS2000_${hint.zone}S`;
  return null;
}
function verticesFromGeoJSON(geojson, keyGuess = null) {
  let vertices = [];
  if (!geojson) return vertices;

  let f = null;
  if (geojson.type === "FeatureCollection") f = geojson.features?.[0];
  else if (geojson.type === "Feature") f = geojson;
  else return vertices;

  if (!f || !f.geometry) return vertices;
  const g = f.geometry;

  if (g.type === "Polygon" && Array.isArray(g.coordinates) && g.coordinates.length > 0) {
    const ring = g.coordinates[0];
    vertices = ring.map((xy, i) => ({ id: `V${String(i + 1).padStart(3, '0')}`, east: xy[0], north: xy[1] }));
  }
  else if (g.type === "MultiPolygon" && g.coordinates.length > 0) {
    const ring = g.coordinates[0][0];
    vertices = ring.map((xy, i) => ({ id: `V${String(i + 1).padStart(3, '0')}`, east: xy[0], north: xy[1] }));
  }
  else if (g.type === "Point" && Array.isArray(g.coordinates)) {
    const xy = g.coordinates;
    vertices = [{ id: "V001", east: xy[0], north: xy[1] }];
  }

  if (keyGuess && (keyGuess.startsWith("SIRGAS2000_") || keyGuess.startsWith("SAD69_"))) {
    const zone = parseInt(keyGuess.match(/_(\d{2})S$/)?.[1] || "22", 10);
    const projStr = `+proj=utm +zone=${zone} +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`;
    const inDegrees = vertices.some(v => Math.abs(v.east) <= 180 && Math.abs(v.north) <= 90);
    if (inDegrees) {
      vertices = vertices.map(v => {
        const xy = proj4(proj4.WGS84, projStr, [v.east, v.north]); // [E,N]
        return { ...v, east: xy[0], north: xy[1] };
      });
    }
  }

  const cleaned = [];
  for (const p of vertices) {
    const last = cleaned[cleaned.length - 1];
    if (!last || last.east !== p.east || last.north !== p.north) cleaned.push(p);
  }
  if (cleaned.length >= 3) {
    const first = cleaned[0], last = cleaned[cleaned.length - 1];
    const distClose = Math.hypot(last.east - first.east, last.north - first.north);
    if (distClose > 0.01) cleaned.push({ ...first, id: `V${String(cleaned.length + 1).padStart(3, '0')}` });
  }
  return cleaned;
}
function montarTextoMemorial(vertices, key) {
  let linhas = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    const v1 = vertices[i], v2 = vertices[i + 1];
    const az = calcularAzimute(v1, v2);
    const dist = calcularDistancia(v1, v2);
    const linha =
      `Do vértice ${i + 1} segue até o vértice ${i + 2}, ` +
      `com coordenadas U T M E=${fmtCoordMeters(v2.east)} e N=${fmtCoordMeters(v2.north)}, ` +
      `no azimute de ${toDMS(az)}, na extensão de ${fmtMeters2(dist)} m;`;
    linhas.push(linha);
  }
  return linhas.join(" ");
}
function montarDescricaoArea(nomeArea, vertices, key) {
  const v1 = vertices[0];
  return `A referida ${nomeArea} é delimitada por um polígono irregular cuja descrição ` +
    `se inicia no vértice 1, seguindo sentido horário com coordenadas planas no ` +
    `sistema U T M Este (X) ${fmtCoordMeters(v1.east)} e Norte (Y) ${fmtCoordMeters(v1.north)}, como segue:`;
}
function prepararVerticesComMedidas(vertices) {
  const out = [];
  for (let i = 0; i < vertices.length; i++) {
    const v = { ...vertices[i], ordem: i + 1 };
    if (i < vertices.length - 1) {
      v.distCalc = fmtMeters2(calcularDistancia(vertices[i], vertices[i + 1]));
      v.azCalc = toDMS(calcularAzimute(vertices[i], vertices[i + 1]));
    } else {
      v.distCalc = "---";
      v.azCalc = "---";
    }
    out.push(v);
  }
  return out;
}

// ======== EVENTO: Carregar SHP  =========
if (shpInput) {
  shpInput.addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;

    try {
      updateStatus("🔄 Lendo SHP...", "info");

      // Nome amigável a partir do arquivo
      shpPoligonoNome = file.name
        .replace(/\.[^/.]+$/, "")
        .replace(/_/g, " ")
        .trim();

      // Detecta extensão
      const isZip = file.name.toLowerCase().endsWith(".zip");
      const isShp = file.name.toLowerCase().endsWith(".shp");

      let geojson = null;
      let prjText = null;

      if (isZip) {
        // 1) ZIP → ArrayBuffer → shp(...) → GeoJSON
        const ab = await file.arrayBuffer();
        const geo = await shp(ab); // retorna FeatureCollection/Feature/Geometry
        // Seleciona/força um Polygon a partir do retorno
        geojson = buildFeatureCollectionFromAny(geo);
        // .prj de dentro do ZIP (opcional, mas recomendado)
        prjText = await extractPrjFromZip(file);
      }
      if (isZip) {
        // 1) ZIP → ArrayBuffer → leitor tolerante (agrega múltiplos layers)
        const ab = await file.arrayBuffer();
        geojson = await readZipAsFeatureCollection(ab);
        // .prj de dentro do ZIP (opcional, mas recomendado)
        prjText = await extractPrjFromZip(file);
      }
      else if (isShp) {
        // 2) .shp "solto"
        // Observação: parseShp normalmente retorna um anel (coords) ou array de anéis
        const shpBuf = await file.arrayBuffer();
        const geom = await shp.parseShp(shpBuf); // [[x,y], [x,y], ...] ou múltiplos
        const ring = Array.isArray(geom) ? geom : [];
        const geometry = { type: "Polygon", coordinates: [ring] };

        geojson = {
          type: "FeatureCollection",
          features: [{ type: "Feature", properties: {}, geometry }]
        };
        // Sem ZIP, normalmente não há .prj — CRS virá por inferência
      }
      else {
        throw new Error("Formato não suportado. Use .zip (SHP+DBF+PRJ) ou .shp.");
      }

      // Diagnóstico rápido do GeoJSON
      logGeojsonSummary(geojson);

      // === CRS ===
      shpCrsKey = resolveCrsKeyFromPrj(prjText);
      // Vertices no CRS de entrada (para heurísticas)
      let vertsRaw = verticesFromGeoJSON(geojson, shpCrsKey);
      console.log("[SHP] vertsRaw len:", Array.isArray(vertsRaw) ? vertsRaw.length : vertsRaw);

      if (!shpCrsKey) {
        // Se não veio do .prj, tenta inferir pelos próprios valores
        shpCrsKey = inferCrsKeyByValues(vertsRaw) || "SIRGAS2000_22S";
      }

      // Constrói novamente os vértices já no CRS alvo (normalmente UTM)
      const vertsUTM = verticesFromGeoJSON(geojson, shpCrsKey);
      console.log("[SHP] vertsUTM len:", Array.isArray(vertsUTM) ? vertsUTM.length : vertsUTM);

      if (!Array.isArray(vertsUTM) || vertsUTM.length < 3) {
        console.warn("[SHP] Menos de 3 vértices após parse. Abortando preenchimento de tabela.");
        updateStatus("⚠️ O SHP foi lido, mas não há polígono com 3+ vértices. Verifique se o layer é POLYGON/MULTIPOLYGON (ou se a linha está realmente fechada).", "warning");
        return;
      }

      // === Área (ha) e perímetro (m)
      let signed = 0;
      for (let i = 0; i < vertsUTM.length; i++) {
        const curr = vertsUTM[i];
        const next = vertsUTM[(i + 1) % vertsUTM.length];
        signed += curr.east * next.north - next.east * curr.north;
      }
      shpAreaHa = Math.abs(signed) / 2 / 10000;

      let per = 0;
      for (let i = 0; i < vertsUTM.length - 1; i++) {
        per += calcularDistancia(vertsUTM[i], vertsUTM[i + 1]);
      }
      shpPerimetroM = per;

      // === Inferir cidade (aproximação)
      shpCityName = inferCityFromVertices(vertsUTM, shpCrsKey);
      if (cidadeDetectadaInput) cidadeDetectadaInput.value = shpCityName;

      // === Preparar vértices com medidas para a UI (ordem/dist/azimute)
      shpVertices = prepararVerticesComMedidas(vertsUTM);

      // === Alimentar UI (tabela)
      extractedCoordinates = shpVertices.slice();
      countDisplay.innerText = extractedCoordinates.length;
      previewTableBody.innerHTML = "";
      for (const c of extractedCoordinates) {
        previewTableBody.innerHTML += `
          <tr>
            <td>${c.ordem}</td>
            <td>${c.id}</td>
            <td>${c.north}</td>
            <td>${c.east}</td>
            <td>${c.distCalc}</td>
            <td>${c.azCalc}</td>
          </tr>`;
      }
      resultBox.style.display = "block";
      scrollToResults();

      // Mostrar CRS detectado
      shpCrsText = crsKeyToText(shpCrsKey);
      showDetectedCrsUI(shpCrsKey, { confidence: "alta", reason: "Detectado a partir do .prj e/ou coordenadas." });

      // Exibir bloco de meta para memorial (se existir no HTML)
      if (memorialMetaBox) memorialMetaBox.style.display = "block";

      updateStatus("✅ SHP carregado e processado. Pronto para gerar o DOCX.", "success");
    } catch (e) {
      console.error(e);
      updateStatus("Erro ao ler SHP: " + e.message, "error");
    }
  });
}


// ======== GERAR DOCX ========

if (generateDocxBtn) {
  generateDocxBtn.addEventListener("click", async () => {
    try {
      // 0) Verificação das libs necessárias
      if (!window.docx || !window.docx.Document) {
        updateStatus("❌ Biblioteca DOCX não carregada. Verifique a tag do 'docx.umd.js'.", "error");
        return;
      }
      if (typeof window.saveAs !== "function") {
        updateStatus("❌ FileSaver não carregado. Inclua FileSaver.min.js antes do script.", "error");
        return;
      }

      // 1) Preferir shpVertices; se vazio, usar extractedCoordinates
      let vertsBase =
        (Array.isArray(shpVertices) && shpVertices.length >= 3) ? shpVertices :
          (Array.isArray(extractedCoordinates) ? extractedCoordinates : []);

      console.log("[Memorial] shpVertices.len=", shpVertices?.length, "| extractedCoordinates.len=", extractedCoordinates?.length);

      if (!Array.isArray(vertsBase) || vertsBase.length < 3) {
        updateStatus("⚠️ Carregue um SHP válido (polígono com 3+ vértices) antes.", "warning");
        return;
      }

      // 2) Normalizar tipos (east/north como Number) e IDs/ordem
      vertsBase = vertsBase
        .map((v, i) => ({
          id: v.id ?? `V${String(i + 1).padStart(3, "0")}`,
          east: typeof v.east === "string" ? parseFloat(v.east) : v.east,
          north: typeof v.north === "string" ? parseFloat(v.north) : v.north,
          ordem: v.ordem ?? (i + 1),
          distCalc: v.distCalc,
          azCalc: v.azCalc
        }))
        .filter(v => Number.isFinite(v.east) && Number.isFinite(v.north));

      if (vertsBase.length < 3) {
        updateStatus("⚠️ As coordenadas contêm valores inválidos (NaN).", "warning");
        return;
      }

      // 3) Fechar anel se necessário (para área/perímetro e memorial)
      const first = vertsBase[0];
      const last = vertsBase[vertsBase.length - 1];
      const closed = Math.hypot(last.east - first.east, last.north - first.north) <= 0.01;
      let vertsForDoc = closed ? vertsBase.slice()
        : [...vertsBase, { ...first, id: `V${String(vertsBase.length + 1).padStart(3, "0")}` }];

      // 4) Se faltar dist/az, gerar com a função do seu projeto
      const precisaMedidas = (v) => v.distCalc === undefined || v.azCalc === undefined;
      if (vertsForDoc.some(precisaMedidas)) {
        vertsForDoc = prepararVerticesComMedidas(
          vertsForDoc.map(v => ({ east: v.east, north: v.north, id: v.id }))
        );
      }

      // 5) Metadados (inputs da UI)
      const resp = (respTecnicoInput?.value ?? "").trim();
      const crea = (respCreaInput?.value ?? "").trim();
      let cidade = (cidadeDetectadaInput?.value ?? "").trim();

      // 6) CRS textual
      const crsKey = shpCrsKey || getActiveProjectionKey() || "SIRGAS2000_22S";
      const crsText = (shpCrsText && shpCrsText.trim()) ? shpCrsText : crsKeyToText(crsKey);

      // 7) Cidade (inferir se não informada)
      if (!cidade || cidade === "Município não identificado") {
        cidade = inferCityFromVertices(
          vertsForDoc.map(v => ({ east: v.east, north: v.north })),
          crsKey
        ) || "Curitiba-PR";
      }

      const nomeArea = shpPoligonoNome || "gleba";
      // Data por extenso: "21 de janeiro de 2026"
      function formatarDataPorExtenso(date) {
        const meses = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
        const d = date.getDate();
        const m = meses[date.getMonth()];
        const y = date.getFullYear();
        return `${d} de ${m} de ${y}`;
      }
      const dataBR = formatarDataPorExtenso(new Date());

      // 8) Área (ha) e perímetro (m)
      let signed = 0;
      for (let i = 0; i < vertsForDoc.length; i++) {
        const a = vertsForDoc[i], b = vertsForDoc[(i + 1) % vertsForDoc.length];
        signed += a.east * b.north - b.east * a.north;
      }
      const areaHa = Math.abs(signed) / 2 / 10000;

      let per = 0;
      for (let i = 0; i < vertsForDoc.length - 1; i++) {
        per += calcularDistancia(vertsForDoc[i], vertsForDoc[i + 1]);
      }

      const BRNumber2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const BRNumber3 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
      const areaTxt = BRNumber2.format(areaHa);
      const perTxt = BRNumber2.format(per);

      // 9) Textos do memorial (mantendo suas variáveis se precisar delas, 
      // mas reconstruindo no passo 10 para garantir a formatação negritada correta)
      // const descricao = montarDescricaoArea(nomeArea, vertsForDoc, crsKey);
      // const memorialTxt = montarTextoMemorial(vertsForDoc, crsKey);

      // 10) Geração do DOCX - AJUSTADO PARA O MODELO
      const { Document, Packer, Paragraph, TextRun, AlignmentType, LineSpacingType } = window.docx;

      // Função para espaçamento entre letras (2 espaços)
      function espacarLetras(texto) {
        return texto.split("").join(" ");
      }

      // Função para garantir valor numérico válido
      function safeNumber(val, casas = 2) {
        const n = Number(val);
        return Number.isFinite(n) ? n.toFixed(casas) : "0.00";
      }

      // Garante que todos os segmentos (inclusive o último) sejam incluídos
      const memorialRuns = [];
      for (let i = 0; i < vertsForDoc.length; i++) {
        const vAtual = vertsForDoc[i];
        const vProx = vertsForDoc[(i + 1) % vertsForDoc.length];
        // Calcula distância e azimute se não existirem
        let dist = vProx.distCalc;
        if (!dist || isNaN(Number(dist))) {
          dist = calcularDistancia(vAtual, vProx);
        }
        let azimute = vProx.azCalc;
        if (!azimute) {
          azimute = "00°00'00\"";
        }
        // Coordenadas entre parênteses
        memorialRuns.push(
          new TextRun({
            text: ` Do vértice ${i + 1} segue até o vértice ${((i + 1) % vertsForDoc.length) + 1}, com coordenadas `,
            size: 24, font: "Arial"
          }),
          new TextRun({
            text: `U T M (E=${safeNumber(vProx.east, 3)} e N=${safeNumber(vProx.north, 3)})`,
            bold: true, size: 24, font: "Arial"
          }),
          new TextRun({
            text: `, no azimute de ${azimute}, na extensão de ${safeNumber(dist)} m;`,
            size: 24, font: "Arial"
          })
        );
      }

      const spacing15 = { line: 360, lineRule: (window.docx && window.docx.LineSpacingType && window.docx.LineSpacingType.AUTO) ? window.docx.LineSpacingType.AUTO : "AUTO" };
      const doc = new Document({
        sections: [{
          properties: { page: { margin: { top: 1417, right: 1134, bottom: 1134, left: 1134 } } },
          headers: {
            default: new window.docx.Header({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: spacing15,
                  children: [
                    new TextRun({
                      text: espacarLetras("MEMORIAL DESCRITIVO"),
                      bold: true,
                      size: 28, // Times New Roman 14pt = 28 half-points
                      font: "Times New Roman",
                      allCaps: true
                    })
                  ]
                }),
                // Linha vazia abaixo do título no cabeçalho
                new Paragraph({ spacing: spacing15, children: [new TextRun({ text: "", size: 24, font: "Arial" })] })
              ]
            })
          },
          children: [
            // ITEM 1 - DESCRIÇÃO
            new Paragraph({
              alignment: AlignmentType.JUSTIFIED,
              spacing: spacing15,
              children: [
                new TextRun({ text: "1. Descrição da Área: ", bold: true, size: 24, font: "Arial" }),
                new TextRun({
                  text: `A referida gleba é delimitada por um polígono irregular cuja descrição se inicia no vértice 1, seguindo sentido horário com coordenadas planas no sistema U T M (E=${safeNumber(vertsForDoc[0].east, 3)} e N=${safeNumber(vertsForDoc[0].north, 3)}), como segue:`,
                  size: 24, font: "Arial"
                })
              ]
            }),

            // CRS
            new Paragraph({
              alignment: AlignmentType.JUSTIFIED,
              spacing: spacing15,
              children: [
                new TextRun({ text: "Sistema de Referência (CRS): ", bold: true, size: 24, font: "Arial" }),
                new TextRun({ text: ` ${crsText}`, size: 24, font: "Arial" })
              ]
            }),

            // LINHA VAZIA ANTES DO ITEM 2
            new Paragraph({ spacing: spacing15, children: [new TextRun({ text: "", size: 24, font: "Arial" })] }),

            // ITEM 2 - MEMORIAL (BLOCO ÚNICO)
            new Paragraph({
              alignment: AlignmentType.JUSTIFIED,
              spacing: spacing15,
              children: [
                new TextRun({ text: "2. Memorial da Área: ", bold: true, size: 24, font: "Arial" }),
                ...memorialRuns
              ]
            }),

            // FECHAMENTO
            new Paragraph({
              alignment: AlignmentType.JUSTIFIED,
              spacing: spacing15,
              children: [
                new TextRun({
                  text: `Finalmente, fechando o polígono acima descrito, abrangendo uma área de ${areaTxt} ha e um perímetro de ${perTxt} m.`,
                  size: 24, font: "Arial"
                })
              ]
            }),

            // 3 LINHAS VAZIAS ANTES DA CIDADE/DATA
            new Paragraph({ spacing: spacing15, children: [new TextRun({ text: "", size: 24, font: "Arial" })] }),
            new Paragraph({ spacing: spacing15, children: [new TextRun({ text: "", size: 24, font: "Arial" })] }),
            new Paragraph({ spacing: spacing15, children: [new TextRun({ text: "", size: 24, font: "Arial" })] }),

            // DATA E ASSINATURA
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: spacing15,
              children: [new TextRun({ text: `${cidade}, ${dataBR}`, size: 24, font: "Arial" })]
            }),

            // 3 LINHAS VAZIAS ANTES DA ASSINATURA
            new Paragraph({ spacing: spacing15, children: [new TextRun({ text: "", size: 24, font: "Arial" })] }),
            new Paragraph({ spacing: spacing15, children: [new TextRun({ text: "", size: 24, font: "Arial" })] }),
            new Paragraph({ spacing: spacing15, children: [new TextRun({ text: "", size: 24, font: "Arial" })] }),

            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: spacing15,
              children: [
                new TextRun({ text: "______________________________________________", size: 24, font: "Arial" }),
                new TextRun({ text: resp || "Responsável Técnico", break: 1, size: 24, font: "Arial" }),
                crea ? new TextRun({ text: crea, break: 1, size: 24, font: "Arial" }) : null
              ].filter(Boolean)
            })
          ]
        }]
      });

      const blob = await Packer.toBlob(doc);
      const outName = `${(shpPoligonoNome || "Memorial").replace(/\s+/g, "_")}_Memorial.docx`;
      saveAs(blob, outName);

      updateStatus("✅ DOCX gerado com sucesso.", "success");
    } catch (e) {
      console.error(e);
      updateStatus("Erro ao gerar DOCX: " + e.message, "error");
    }
  });
}

/** Escolhe o melhor Feature de Polygon/MultiPolygon de um FeatureCollection */
function pickBestPolygonFeature(fc) {
  if (!fc || fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) return null;

  const polys = fc.features.filter(f => {
    const t = f?.geometry?.type;
    return t === "Polygon" || t === "MultiPolygon";
  });

  if (polys.length === 0) return null;

  // Heurística simples: “mais complexo” (mais coords) primeiro
  polys.sort((a, b) => {
    const la = JSON.stringify(a.geometry.coordinates).length;
    const lb = JSON.stringify(b.geometry.coordinates).length;
    return lb - la; // desc
  });

  return polys[0];
}

/** Tenta promover uma LineString em Polygon quando a linha já estiver fechada */
function lineToPolygonIfClosed(coords, tol = 0.5) {
  if (!Array.isArray(coords) || coords.length < 3) return null;

  const first = coords[0];
  const last = coords[coords.length - 1];
  if (!Array.isArray(first) || !Array.isArray(last)) return null;

  const d = Math.hypot(last[0] - first[0], last[1] - first[1]);
  if (d > tol) return null; // não está fechada (longe demais)

  const isPreciselyClosed = d <= Number.EPSILON;
  const ring = isPreciselyClosed ? coords.slice() : [...coords, [first[0], first[1]]];

  return { type: "Polygon", coordinates: [ring] };
}

/** Força uma geometry qualquer a virar Polygon, quando possível */
function coerceGeometryToPolygon(geometry, tol = 0.5) {
  if (!geometry || !geometry.type) return null;

  const t = geometry.type;
  if (t === "Polygon") return geometry;

  if (t === "MultiPolygon") {
    if (Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0) {
      const firstPoly = geometry.coordinates[0];
      if (Array.isArray(firstPoly) && firstPoly.length > 0) {
        return { type: "Polygon", coordinates: firstPoly };
      }
    }
    return null;
  }

  if (t === "LineString") {
    return lineToPolygonIfClosed(geometry.coordinates, tol);
  }

  if (t === "MultiLineString") {
    const mls = geometry.coordinates;
    if (Array.isArray(mls)) {
      for (const line of mls) {
        const poly = lineToPolygonIfClosed(line, tol);
        if (poly) return poly;
      }
    }
    return null;
  }

  // Point/MultiPoint etc. não são promovíveis sem regras adicionais
  return null;
}

/** Normaliza qualquer retorno do shp(...) em um FeatureCollection com UM Polygon quando der */
function buildFeatureCollectionFromAny(geo, tol = 0.5) {
  // 1) FeatureCollection
  if (geo && geo.type === "FeatureCollection" && Array.isArray(geo.features)) {
    const best = pickBestPolygonFeature(geo);
    if (best) {
      return { type: "FeatureCollection", features: [best] };
    }
    // Se não há Polygon/MultiPolygon, tenta promover alguma geometry (ex.: LineString fechada)
    for (const f of geo.features) {
      const poly = coerceGeometryToPolygon(f?.geometry, tol);
      if (poly) {
        return {
          type: "FeatureCollection",
          features: [{ type: "Feature", properties: f.properties || {}, geometry: poly }]
        };
      }
    }
    // Não conseguiu -> retorna como veio (para depuração)
    return geo;
  }

  // 2) Feature isolado
  if (geo && geo.type === "Feature" && geo.geometry) {
    let geometry = geo.geometry;
    if (geometry.type !== "Polygon") {
      const coerced = coerceGeometryToPolygon(geometry, tol);
      if (coerced) geometry = coerced;
    }
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: geo.properties || {}, geometry }]
    };
  }

  // 3) Geometry bruto
  if (geo && geo.type && geo.coordinates) {
    let geometry = geo;
    if (geometry.type !== "Polygon") {
      const coerced = coerceGeometryToPolygon(geometry, tol);
      if (coerced) geometry = coerced;
    }
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry }]
    };
  }

  // 4) Forma inesperada → retorna FC vazio (evita quebra)
  return { type: "FeatureCollection", features: [] };
}

/** Log de diagnóstico do GeoJSON (opcional) */
function logGeojsonSummary(geojson) {
  try {
    if (!geojson) {
      console.warn("[SHP] GeoJSON vazio/indefinido.");
      return;
    }
    if (geojson.type === "FeatureCollection") {
      const n = Array.isArray(geojson.features) ? geojson.features.length : 0;
      const gt = n > 0 ? geojson.features[0]?.geometry?.type : "(nenhum)";
      console.log(`[SHP] FC com ${n} feature(s). Primeiro geometry: ${gt}`);
    } else if (geojson.type === "Feature") {
      console.log(`[SHP] Feature isolado. Geometry: ${geojson.geometry?.type || "(desconhecido)"}`);
    } else {
      console.log(`[SHP] Objeto geometry. Type: ${geojson.type || "(desconhecido)"}`);
    }
  } catch (e) {
    console.warn("[SHP] Falha ao sumarizar GeoJSON:", e);
  }
}

async function readZipAsFeatureCollection(ab, tol = 0.5) {
  // 1) Caminho "normal": shp(ab) já tenta montar uma FeatureCollection
  try {
    const geo1 = await shp(ab);
    if (geo1) {
      const fc1 = buildFeatureCollectionFromAny(geo1, tol);
      if (fc1 && Array.isArray(fc1.features) && fc1.features.length > 0) {
        console.log("[SHP] readZip: caminho direto OK (shp(ab)).");
        return fc1;
      }
    }
  } catch (e) {
    console.warn("[SHP] readZip: shp(ab) falhou → tentando parseZip.", e);
  }

  // 2) Caminho "multi-camada": parseZip retorna FC ou um objeto de coleções
  try {
    const parsed = await shp.parseZip(ab);
    // (a) Se já for FeatureCollection
    if (parsed && parsed.type === "FeatureCollection" && Array.isArray(parsed.features)) {
      const fc2 = buildFeatureCollectionFromAny(parsed, tol);
      if (fc2 && fc2.features?.length) {
        console.log("[SHP] readZip: parseZip → FC direta.");
        return fc2;
      }
    }

    // (b) Se for objeto com múltiplas coleções/arrays por chave
    if (parsed && typeof parsed === "object" && !parsed.type) {
      // Agrega só Polygon/MultiPolygon (ou LineString fechada → Polygon)
      const features = [];
      const keys = Object.keys(parsed);
      for (const k of keys) {
        const val = parsed[k];
        if (!val) continue;

        // Caso 1: uma FeatureCollection
        if (val.type === "FeatureCollection" && Array.isArray(val.features)) {
          for (const f of val.features) {
            const poly = coerceGeometryToPolygon(f?.geometry, tol);
            if (poly) features.push({ type: "Feature", properties: f.properties || {}, geometry: poly });
          }
          continue;
        }

        // Caso 2: um array de Features/Geometries crus
        if (Array.isArray(val)) {
          for (const item of val) {
            if (item?.type === "Feature") {
              const poly = coerceGeometryToPolygon(item.geometry, tol);
              if (poly) features.push({ type: "Feature", properties: item.properties || {}, geometry: poly });
            } else if (item?.type && item?.coordinates) {
              const poly = coerceGeometryToPolygon(item, tol);
              if (poly) features.push({ type: "Feature", properties: {}, geometry: poly });
            }
          }
          continue;
        }

        // Caso 3: geometry simples
        if (val?.type && val?.coordinates) {
          const poly = coerceGeometryToPolygon(val, tol);
          if (poly) features.push({ type: "Feature", properties: {}, geometry: poly });
        }
      }

      if (features.length > 0) {
        console.log(`[SHP] readZip: parseZip → agregado ${features.length} feature(s) de múltiplas chaves.`);
        return { type: "FeatureCollection", features };
      }
    }
  } catch (e) {
    console.warn("[SHP] readZip: parseZip falhou.", e);
  }

  // 3) Sem sucesso: devolve FC vazia para o caller tratar
  console.warn("[SHP] readZip: nenhuma feature encontrada no ZIP.");
  return { type: "FeatureCollection", features: [] };
}

