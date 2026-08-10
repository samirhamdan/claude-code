#!/bin/bash

# Script de validação de fontes de dados
# Executar na VPS antes de ativar o workflow

set -e

echo "=== TESTE DE FONTES ==="
echo

# 1. AwesomeAPI
echo "1️⃣  AwesomeAPI (Cotações)"
echo "URL: https://api.awesomeapi.com.br/last/USD-BRL,BTC-BRL,ETH-BRL"
RESP=$(curl -s "https://api.awesomeapi.com.br/last/USD-BRL,BTC-BRL,ETH-BRL" | head -c 300)
echo "✓ Response (primeiros 300 chars):"
echo "$RESP"
echo -e "\n"

# 2. Yahoo Finance
echo "2️⃣  Yahoo Finance (Ibovespa via BOVA11)"
echo "URL: https://query1.finance.yahoo.com/v10/finance/quoteSummary/BOVA11.SA?modules=price"
RESP=$(curl -s "https://query1.finance.yahoo.com/v10/finance/quoteSummary/BOVA11.SA?modules=price" | head -c 400)
echo "✓ Response (primeiros 400 chars):"
echo "$RESP"
echo -e "\n"

# 3. brapi.dev — CRÍTICO: validar que retorna blue chips
echo "3️⃣  brapi.dev (Ações top 50 por volume)"
echo "URL: https://brapi.dev/api/quote/list?sortBy=volume&sortOrder=desc&limit=50&type=stock"
echo "⚠️  IMPORTANTE: Validar que retorna PETR4, VALE3, ITUB4, BBDC4, etc. nos primeiros 10"
echo
RESP=$(curl -s "https://brapi.dev/api/quote/list?sortBy=volume&sortOrder=desc&limit=50&type=stock")
echo "$RESP" | jq '.stocks[0:10] | map({stock, regularMarketPrice, regularMarketChangePercent, volume})' 2>/dev/null || echo "$RESP" | head -c 300
echo -e "\n"

# 4. GNews (requer apikey — pular se não tiver)
echo "4️⃣  GNews (Notícias)"
echo "URL: https://gnews.io/api/search?q=bolsa&lang=pt&max=5&apikey=<YOUR_KEY>"
if [ -z "$GNEWS_API_KEY" ]; then
    echo "⚠️  GNEWS_API_KEY não definida. Pule este teste."
    echo "   Obtenha uma chave em: https://gnews.io"
else
    RESP=$(curl -s "https://gnews.io/api/search?q=bolsa+mercado&lang=pt&max=5&apikey=$GNEWS_API_KEY")
    echo "$RESP" | jq '.articles[0:3] | map({title, description})' 2>/dev/null || echo "$RESP" | head -c 300
fi
echo -e "\n"

echo "=== RESUMO ==="
echo "✅ Se todos os endpoints acima retornaram dados sem erro:"
echo "   1. Confirme que brapi retorna blue chips (PETR4, VALE3, ITUB4, etc.)"
echo "   2. Obtenha GNEWS_API_KEY em https://gnews.io"
echo "   3. Importe o workflow em n8n"
echo "   4. Configure credenciais"
echo "   5. Ative cron para amanhã 07:00"
