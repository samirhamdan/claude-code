# Setup: Briefing Matutino

## Passo a passo para implantar no n8n

### 1. Validar fontes de dados

Teste cada endpoint na VPS antes de importar o workflow:

```bash
# Cotações (AwesomeAPI)
curl -s "https://api.awesomeapi.com.br/last/USD-BRL,BTC-BRL,ETH-BRL" | jq .

# Ibovespa (Yahoo Finance)
curl -s "https://query1.finance.yahoo.com/v10/finance/quoteSummary/BOVA11.SA?modules=price" | jq '.quoteSummary.result[0].price'

# Ações top 50 (brapi — IMPORTANTE: Validar que retorna azuis-chips)
curl -s "https://brapi.dev/api/quote/list?sortBy=volume&sortOrder=desc&limit=50&type=stock" | jq '.stocks[0:10]'

# Notícias (GNews — requer apikey)
curl -s "https://gnews.io/api/search?q=bolsa&lang=pt&max=5&apikey=YOUR_KEY" | jq '.articles[].title'
```

**Status de validação:**
- ✅ AwesomeAPI: OK (testado)
- ✅ Yahoo Finance: OK (BOVA11 estável)
- ⏳ brapi.dev: *PENDENTE* — validar se retorna blue chips nos primeiros 50
- ⏳ GNews: *PENDENTE* — obter apikey

---

### 2. Obter credenciais

#### GNews
1. Acesse https://gnews.io
2. Sign up → Free plan
3. Copie a API Key
4. Export: `export GNEWS_API_KEY="..."`

#### Evolution API (já configurada)
- Endpoint: `https://evo-hub67.duckdns.org`
- Credencial: `$EVOLUTION_API_KEY` (já definida em `.env`)
- Recipient: `5567998283590@s.whatsapp.net` (seu número no formato E.164)

---

### 3. Importar workflow no n8n

**Opção A: Via interface web**
1. Acesse https://hub67.duckdns.org
2. Menu: Workflows → Import → Upload file
3. Selecione `workflows/briefing-matutino.json`
4. Clique em "Import"

**Opção B: Via API REST**
```bash
curl -X POST "https://hub67.duckdns.org/api/v1/workflows" \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  -H "Content-Type: application/json" \
  -d @workflows/briefing-matutino.json
```

---

### 4. Configurar credenciais no n8n

Após importar, edite o workflow e configure:

**Nó "Noticias" (HTTP node):**
- Abra a aba "Headers"
- Substitua `{{GNEWS_API_KEY}}` pela chave real
- **OU** cadastre uma credencial: Settings → Credentials → New → HTTP
- Nome: `gnews-api`
- Key: `apikey`, Value: `sua-chave`
- Reference no node: `{{ $credentials.gnewsApi.apikey }}`

**Nó "Enviar para WhatsApp" (HTTP POST):**
- Headers: `apikey: {{ $credentials.evolutionApi.key }}`
- O n8n guardará criptografado com `N8N_ENCRYPTION_KEY`

---

### 5. Testar manualmente

1. Na interface do workflow, clique em "Test workflow"
2. Selecione um dos nós HTTP e rode isoladamente
3. Valide o output (verifique se campos esperados existem)
4. Rode o workflow completo
5. Verifique se a mensagem foi entregue no WhatsApp

---

### 6. Agendar cron

1. Workflow → Edit
2. Clique no nó "Cron"
3. Expressão já configurada: `0 7 * * 1-6` (07:00, seg-sex)
4. Timezone: America/Campo_Grande (confirmado em settings)
5. Ative o workflow: botão "Active" no topo

---

## Checklist de pré-voo

- [ ] AwesomeAPI retorna cotações corretamente
- [ ] Yahoo Finance retorna BOVA11 com `regularMarketChangePercent`
- [ ] brapi retorna 50 ações com `regularMarketChangePercent` e volumes
- [ ] brapi: top 50 inclui blue chips (PETR4, VALE3, ITUB4, etc.)
- [ ] GNews API key obtida
- [ ] Workflow importado no n8n
- [ ] Credenciais cadastradas no n8n
- [ ] Teste manual: mensagem entregue no WhatsApp
- [ ] Cron ativo e agendado para amanhã 07:00

---

## Troubleshooting

### "INVALID_TOKEN" no brapi
- Causa: token limitado a 1 ticker/requisição no plano free
- **Solução**: usar endpoint `/quote/list` sem token (implementado)

### Ibovespa retorna zero ou null
- Yahoo Finance ocasionalmente falha com BOVA11 fora de horário
- Retry está configurado (3x, 1s entre tentativas)
- Se problema persistir: procurar alternativa de API (IND=F no Yahoo, mas instável)

### Ações retornam ticker inválido em brapi
- brapi free pode ter throttling
- Validar que `limit=50` não perde dados
- Se falhar: reduzir para `limit=20` ou usar endpoint `/quote/{ticker}` para tickers específicos

### Notícias vazias
- GNews free pode ter limite de requisições
- Adicionar delay na cron ou cache no Redis

---

## Próximos passos

1. **Validar brapi** — confirmar que `/quote/list` retorna blue chips
2. **Obter GNews API key** — criar conta gratuita
3. **Testar ponta a ponta** — importar, credenciais, cron ativo
4. **Monitorar 24h** — verificar logs e entrega de mensagens
5. **Fase 2**: adicionar análise (resistência, suporte, notícias por ticker)
