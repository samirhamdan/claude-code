# Status: Briefing Matutino

**Data:** 10 de agosto de 2026
**Versão:** 1.0 (prototipo)

---

## ✅ Concluído

- [x] Workflow JSON estruturado (8 nós: cron → 4 APIs → merge → code → evolução)
- [x] Integração AwesomeAPI (USD/BRL, BTC/BRL, ETH/BRL)
- [x] Integração Yahoo Finance (BOVA11 como proxy para Ibovespa)
- [x] Integração brapi.dev (top 50 ações por volume)
- [x] Integração GNews (notícias)
- [x] Code node "Montar Mensagem" com formatação brasileira
- [x] HTTP POST para Evolution API (WhatsApp)
- [x] Cronograma: segunda a sexta, 07:00 America/Campo_Grande
- [x] Documentação completa (SETUP.md, briefing.md, test-apis.sh)

---

## ⏳ Pendente — Validação obrigatória

### 1. Testar brapi `/quote/list` (CRÍTICO)
```bash
curl -s "https://brapi.dev/api/quote/list?sortBy=volume&sortOrder=desc&limit=50&type=stock" | jq '.stocks[0:10]'
```

**Validar:**
- [ ] Endpoint retorna HTTP 200
- [ ] Campo `stocks` contém 50 itens
- [ ] Top 10 incluem blue chips (PETR4, VALE3, ITUB4, BBDC4, WEGE3, JBSS3, etc.)
- [ ] Cada ação tem `regularMarketChangePercent` (não null)
- [ ] Free plan permite sem token

**Decisão:** Se OK → continuar. Se não → usar endpoint `/quote/{ticker}` com lista fixa.

### 2. Obter GNews API key (BLOQUEADOR)
1. Acesse https://gnews.io
2. Sign up → Free plan (5 requisições/minuto, 100/dia)
3. Copie a chave
4. Teste: `curl "https://gnews.io/api/search?q=bolsa&lang=pt&max=5&apikey=YOUR_KEY"`

### 3. Testar ponta a ponta no n8n (VALIDAÇÃO)
1. SSH na VPS: `ssh root@$VPS_IP`
2. Confirmar n8n rodando: `docker compose logs -f n8n | head -20`
3. Acessar https://hub67.duckdns.org → login
4. Importar `workflows/briefing-matutino.json`
5. Testar cada nó HTTP isoladamente
6. Testar workflow completo
7. Validar mensagem entregue no WhatsApp

---

## 📋 Dados de entrada esperados

### AwesomeAPI
```json
{
  "USDBRL": { "bid": "5.15", "ask": "5.16" },
  "BTCBRL": { "bid": "267450", "ask": "267550" },
  "ETHBRL": { "bid": "15230", "ask": "15240" }
}
```

### Yahoo Finance
```json
{
  "quoteSummary": {
    "result": [{
      "price": {
        "regularMarketPrice": 85.32,
        "regularMarketChangePercent": 1.25
      }
    }]
  }
}
```

### brapi.dev
```json
{
  "stocks": [
    {
      "stock": "PETR4",
      "regularMarketPrice": 28.45,
      "regularMarketChangePercent": 2.15,
      "volume": 987654321
    },
    ...
  ]
}
```

### GNews
```json
{
  "articles": [
    {
      "title": "Petrobras fecha em alta...",
      "description": "...",
      "url": "...",
      "publishedAt": "2026-08-10T10:30:00Z"
    },
    ...
  ]
}
```

---

## 🔧 Configuração no n8n

### Credenciais obrigatórias

**GNews API Key:**
- Nó: "Noticias"
- Header: `apikey: {{GNEWS_API_KEY}}`
- Ou cadastrar em Credentials → HTTP → `gnews-api`

**Evolution API Key:**
- Nó: "Enviar para WhatsApp"
- Header: `apikey: {{EVOLUTION_API_KEY}}`
- Valor: já em `.env` como `EVOLUTION_API_KEY`

---

## 🎯 Próximas etapas

1. **Hoje:**
   - [ ] Executar `scripts/test-apis.sh` na VPS
   - [ ] Validar brapi (se OK, proceder; se não, ajustar)
   - [ ] Obter GNews API key

2. **Amanhã:**
   - [ ] SSH → importar workflow
   - [ ] Testar cada nó
   - [ ] Ativar cron para 07:00
   - [ ] Monitorar primeira execução

3. **Dia seguinte:**
   - [ ] Verificar se mensagem foi entregue
   - [ ] Validar formato e dados
   - [ ] Ajustar parsing se necessário

---

## ⚠️ Riscos e mitigation

| Risco | Impacto | Mitigation |
|---|---|---|
| brapi retorna dados sujos (penny stocks) | Briefing com lixo | Filtrar por volume e verificar tickers conhecidos |
| Yahoo Finance BOVA11 indisponível | Ibovespa em branco | Retry 3x; fallback para valor anterior no Redis |
| GNews fora de quota | Notícias em branco | Graceful degradation; continuar sem news |
| WhatsApp (Evolution) entrega falha | Mensagem não chega | Retry no HTTP node; logs no n8n |

---

## 📞 Contacto para debug

Caso algo falhe:
1. Verificar logs: `docker compose logs -f n8n`
2. Testar API manualmente com curl (scripts/test-apis.sh)
3. Validar cronograma no n8n
4. Confirmar `.env` tem as chaves (GNEWS_API_KEY, EVOLUTION_API_KEY)

---

**Versão anterior:** Não há (v1.0)
**Próxima revisão:** Após validação em produção (24h)
