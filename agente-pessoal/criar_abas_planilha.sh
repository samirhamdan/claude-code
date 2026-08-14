#!/bin/bash

# Criar abas na planilha do Samir
# ID: 1n2zYgTP3reMH4XHKMGp9kcjoGrZvvW5b7pvw7MxTQFQ

SPREADSHEET_ID="1n2zYgTP3reMH4XHKMGp9kcjoGrZvvW5b7pvw7MxTQFQ"
ACCESS_TOKEN="$GOOGLE_SHEETS_TOKEN"  # Precisa estar em .env

# Criar aba "Contas"
curl -X POST "https://sheets.googleapis.com/v4/spreadsheets/$SPREADSHEET_ID/batchUpdate" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "requests": [
      {
        "addSheet": {
          "properties": {
            "title": "Contas",
            "index": 1
          }
        }
      }
    ]
  }'

# Criar aba "Orçamento"
curl -X POST "https://sheets.googleapis.com/v4/spreadsheets/$SPREADSHEET_ID/batchUpdate" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "requests": [
      {
        "addSheet": {
          "properties": {
            "title": "Orçamento",
            "index": 2
          }
        }
      }
    ]
  }'

# Adicionar headers na aba "Contas"
curl -X PUT "https://sheets.googleapis.com/v4/spreadsheets/$SPREADSHEET_ID/values/Contas!A1:F1" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "values": [["Descrição", "Valor", "Dia", "Categoria", "Tipo", "Fluxo"]]
  }'

# Adicionar headers na aba "Orçamento"
curl -X PUT "https://sheets.googleapis.com/v4/spreadsheets/$SPREADSHEET_ID/values/Orçamento!A1:B1" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "values": [["Categoria", "Limite"]]
  }'

echo "✅ Abas criadas!"
