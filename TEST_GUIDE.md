# 🧪 Guia de Teste - PDFtoArcgis v2.2.2

## Checklist de Testes

### ✅ Teste 1: Carregamento Básico
- [ ] Abra [PDFtoArcgis/index.html](PDFtoArcgis/index.html)
- [ ] Interface carrega sem erros
- [ ] Botão "Selecionar PDF" está funcional

### ✅ Teste 2: Extração com PDF Simples (< 30 vértices)
**Procedimento:**
1. Carregue um PDF com poucos vértices
2. Abra Console (F12) e vá para aba "Console"
3. Clique em "Extrair Vértices"
4. Observe logs:
   ```
   ✅ Deve ver: [PDFtoArcgis][LOG IA][RAW] com JSON
   ✅ Deve ver: Total de vértices extraídos
   ✅ Deve NÃO ver: 413 Content Too Large
   ```

### ✅ Teste 3: Extração com PDF Complexo (70+ vértices)
**Procedimento:**
1. Use o PDF `ME 047 - 8.402` (ou similar)
2. Abra Console (F12)
3. Clique em "Extrair Vértices"
4. **Esperado**:
   ```
   ⏳ Analisando parte 1 de 3...
   ✅ Parte 1: N vértice(s) encontrado(s)
   ⏳ Analisando parte 2 de 3...
   ✅ Parte 2: M vértice(s) encontrado(s)
   ⏳ Analisando parte 3 de 3...
   ✅ Parte 3: K vértice(s) encontrado(s)
   📍 Total: (N+M+K) vértice(s) único(s) encontrado(s)
   ```
5. **Não deve ver**:
   - ❌ "413 Content Too Large"
   - ❌ "429 Too Many Requests" (ou se ver, deve fazer retry automático)

### ✅ Teste 4: Detecção de CRS
**Procedimento:**
1. Após extração bem-sucedida, verifique CRS detectado
2. Para documentos do Paraná, esperado: **SIRGAS2000_22S** ou **SIRGAS2000_23S**
3. Verifique no output JSON:
   ```json
   {
     "vertices": [...],
     "epsg": "EPSG:31982",  // ou similar
     "srid": "SIRGAS2000_22S"
   }
   ```

### ✅ Teste 5: Rate Limiting (429) Recovery
**Procedimento:**
1. Carregue um PDF com 100+ vértices (se disponível)
2. Se receber erro 429 na requisição:
   - Deve ver no console: `429 Too Many Requests. Retry 1/5...`
   - Deve ver no UI: `Taxa limite atingida. Aguardando 1.0s...`
   - **Esperado**: Após 1-2s, retry automático
   - **Esperado**: Chunk é processado com sucesso na tentativa 2+

### ✅ Teste 6: Deduplicação de Vértices
**Procedimento:**
1. Gere um PDF que tenha vértices repetidos ou muito próximos
2. Verifique que vertices final não tem duplicatas
3. Critério: Dois vértices são iguais se `id`, `este` e `norte` são idênticos

### ✅ Teste 7: Performance de Chunks
**Procedimento:**
1. Abra DevTools (F12) → Network → XHR
2. Processe PDF complexo
3. **Esperado**:
   - Múltiplas requisições `/api/llama-3.1-8b-instant`
   - ~500ms entre cada uma (delay intencional)
   - Cada request < 10KB de payload
   - Cada response contém JSON com `vertices` array

### ✅ Teste 8: UI Feedback
**Procedimento:**
1. Processe PDF
2. Verifique barra de UI mostra:
   - ✅ Emojis apropriados (📊, ⏳, ✅, 📍)
   - ✅ Contagem progressiva de partes
   - ✅ Número de vértices por parte
   - ✅ Total final

---

## 🐛 Troubleshooting

### Problema: "413 Content Too Large"
**Solução**: 
- Verificar se `splitTextForAI` está usando 6000 (não 12000)
- Verificar se `extractRelevantLinesForAI` está filtrando agressivamente
- Se persistir, reduzir para 4000 caracteres

### Problema: "429 Too Many Requests" sem retry
**Solução**:
- Verificar se `callOpenAIGPT4Turbo` tem `MAX_RETRIES = 5`
- Verificar se tem exponential backoff com `Math.pow(2, retryCount)`
- Se ainda falhar após 5 retries, é limitação do servidor

### Problema: JSON malformado / Parse error
**Solução**:
- Verificar se `repairJsonCoordinates` está sendo chamado
- Verificar se pontos nos números (separadores) estão sendo removidos
- Se JSON ainda inválido, fallback para extração de array

### Problema: Vértices faltando
**Solução**:
- Verificar console para ver quantos chunks foram processados
- Se faltar um chunk, pode ser rate limit na requísição
- Aumentar delay entre chunks (de 500ms para 1000ms)

---

## 📊 Métricas de Sucesso

| Métrica | Alvo | Status |
|---------|------|--------|
| Taxa de sucesso (PDF < 50 vértices) | 100% | ? |
| Taxa de sucesso (PDF 50-150 vértices) | 95%+ | ? |
| Erros 413 por 100 PDFs | 0 | ? |
| Erros 429 final (após retry) | 0 | ? |
| Tempo médio por vértice | < 1s | ? |

---

## 🎯 Teste Final - Caso de Uso Real

**PDF**: `ME 047 - 8.402` (ou similar)
**Vértices esperados**: ~70+
**Procedimento**:
1. Carregar PDF
2. Executar extração
3. Observar cada chunk ser processado
4. Verificar número total final
5. **Sucesso se**: Número final ≥ 90% do esperado

**Resultado esperado**:
```
📊 Dividindo PDF em 3 parte(s) para análise...
⏳ Analisando parte 1 de 3...
✅ Parte 1: 22 vértice(s) encontrado(s)    ← P1-P10 + extras
⏳ Analisando parte 2 de 3...
✅ Parte 2: 28 vértice(s) encontrado(s)    ← P11-P38
⏳ Analisando parte 3 de 3...
✅ Parte 3: 20 vértice(s) encontrado(s)    ← P39-P58
📍 Total: 70 vértice(s) único(s) encontrado(s) ✨
```

---

**Data de Teste**: __________  
**Testador**: __________  
**Status Geral**: ☐ Passou ☐ Falhou (detalhar abaixo)

**Notas**:
```


```

