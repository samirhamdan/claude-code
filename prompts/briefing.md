# Prompt: Briefing Matutino

## Objetivo

Consolidar dados de mercado (cotações, índices, ações, notícias) e enviar
em mensagem WhatsApp estruturada para o gerente.

## Fontes de dados

1. **Cotações**: AwesomeAPI
   - URL: `https://api.awesomeapi.com.br/last/USD-BRL,BTC-BRL,ETH-BRL`
   - Retorna: USDBRL.bid, BTCBRL.bid, ETHBRL.bid

2. **Ibovespa**: Yahoo Finance (BOVA11 como proxy)
   - URL: `https://query1.finance.yahoo.com/v10/finance/quoteSummary/BOVA11.SA?modules=price`
   - Campo: `quoteSummary.result[0].price.regularMarketChangePercent`

3. **Ações (B3)**: brapi.dev
   - URL: `https://brapi.dev/api/quote/list?sortBy=volume&sortOrder=desc&limit=50&type=stock`
   - Retorna top 50 por volume, filtrar para 6 com maior/menor `regularMarketChangePercent`

4. **Notícias**: GNews
   - URL: `https://gnews.io/api/search?q=bolsa+mercado+finanças+brasil&lang=pt&sortby=publishedAt&max=5&apikey={{GNEWS_API_KEY}}`
   - Retorna: `articles[].title`

## Formato da mensagem

```
📊 *BRIEFING MATUTINO* — SEGUNDA, 10 de agosto

💱 *COTAÇÕES*
USD/BRL: 5,15
BTC/BRL: R$ 267.450
ETH/BRL: R$ 15.230

📈 *ÍNDICE*
Ibovespa (BOVA11): +1,25%

🚀 *ALTAS*
PETR4 +2,15% ▲
VALE3 +1,87% ▲
ITUB4 +1,43% ▲

📉 *BAIXAS*
SLCE3 -3,42% ▼
MOVI11 -2,89% ▼
CSMG3 -2,56% ▼

📰 *DESTAQUES*
1. Petrobras sobe após...
2. Vale investe em...
3. Crypto mostra força...
```

## Variáveis de ambiente

- `GNEWS_API_KEY`: Chave da API GNews (criar em https://gnews.io)
- `EVOLUTION_API_KEY`: Chave da Evolution API (n8n guardará criptografada)

## Cronograma

- **Dias**: segunda a sexta
- **Hora**: 07:00 (America/Campo_Grande)
- **Recipient**: 5567998283590 (WhatsApp, formato E.164)

## Observações

- Brapi `limit=50` retorna os 50 mais negociados; código filtra top 3 + bottom 3
- Mini índice (WIN) não tem fonte confiável gratuita; removido
- BOVA11 (ETF do Ibovespa) é proxy imperfeil mas estável
- Debounce e retry já implementados no n8n
