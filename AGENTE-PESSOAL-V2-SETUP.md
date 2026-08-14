# Agente Pessoal v2 — Setup Completo

**Status:** Pronto para implantar  
**Samir WhatsApp:** 556798283590  
**Board Trello:** Agente Pessoal v2 (6a7e8330ecaf78018711005b)

---

## ✅ O que já foi feito

- [x] Board Trello criado + 4 listas (Entrada, Hoje, Semana, Concluído)
- [x] Nó Agente escrito (loop de tool use com 8 ferramentas)
- [x] System prompt definido
- [x] Tabela usuarios.sql pronta

---

## 🔧 Passos de Implantação

### **PASSO 1 — Criar tabela usuarios no Postgres**

Execute **UMA VEZ** na VPS:

```bash
docker exec alessio_postgres psql -U alessio <<'EOF'
CREATE TABLE IF NOT EXISTS usuarios (
  numero VARCHAR(15) PRIMARY KEY,
  nome VARCHAR(100),
  nome_assistente VARCHAR(50) DEFAULT NULL,
  tom VARCHAR(20) DEFAULT NULL,
  idioma VARCHAR(10) DEFAULT 'pt-BR',
  revisao_dia VARCHAR(10) DEFAULT NULL,
  revisao_hora VARCHAR(5) DEFAULT NULL,
  planilha_id VARCHAR(60),
  trello_board_id VARCHAR(30),
  trello_list_id VARCHAR(30),
  trello_key VARCHAR(40),
  trello_token VARCHAR(80),
  modulos JSONB DEFAULT '["tarefas","gastos","contas"]',
  onboarding_completo BOOLEAN DEFAULT false,
  ativo BOOLEAN DEFAULT true,
  criado_em TIMESTAMP DEFAULT now()
);

INSERT INTO usuarios (numero, nome, planilha_id, trello_board_id, trello_list_id)
VALUES ('556798283590', 'Samir', '1n2zYgTP3reMH4XHKMGp9kcjoGrZvvW5b7pvw7MxTQFQ', '6a7e8330ecaf78018711005b', '6a7e8338c1c5d2be03bcc512');
EOF
```

Validar: `docker exec alessio_postgres psql -U alessio -c "SELECT * FROM usuarios;"`

---

### **PASSO 2 — Criar abas na planilha**

No n8n, criar um nó HTTP com essas 3 chamadas (ou fazer via Google Sheets UI):

**2a. Criar aba "Contas"**
```
POST https://sheets.googleapis.com/v4/spreadsheets/1n2zYgTP3reMH4XHKMGp9kcjoGrZvvW5b7pvw7MxTQFQ/batchUpdate

Headers: Authorization: Bearer {{GOOGLE_SHEETS_TOKEN}}

Body:
{
  "requests": [{
    "addSheet": {
      "properties": { "title": "Contas", "index": 1 }
    }
  }]
}
```

**2b. Criar aba "Orçamento"**
```
POST https://sheets.googleapis.com/v4/spreadsheets/1n2zYgTP3reMH4XHKMGp9kcjoGrZvvW5b7pvw7MxTQFQ/batchUpdate

Headers: Authorization: Bearer {{GOOGLE_SHEETS_TOKEN}}

Body:
{
  "requests": [{
    "addSheet": {
      "properties": { "title": "Orçamento", "index": 2 }
    }
  }]
}
```

**2c. Headers "Contas"**
```
PUT https://sheets.googleapis.com/v4/spreadsheets/1n2zYgTP3reMH4XHKMGp9kcjoGrZvvW5b7pvw7MxTQFQ/values/Contas!A1:F1

Headers: Authorization: Bearer {{GOOGLE_SHEETS_TOKEN}}

Body:
{
  "values": [["Descrição", "Valor", "Dia", "Categoria", "Tipo", "Fluxo"]]
}
```

**2d. Headers "Orçamento"**
```
PUT https://sheets.googleapis.com/v4/spreadsheets/1n2zYgTP3reMH4XHKMGp9kcjoGrZvvW5b7pvw7MxTQFQ/values/Orçamento!A1:B1

Headers: Authorization: Bearer {{GOOGLE_SHEETS_TOKEN}}

Body:
{
  "values": [["Categoria", "Limite"]]
}
```

Ou mais fácil: abrir a planilha manualmente e criar as 2 abas + headers.

---

### **PASSO 3 — Nó Agente no n8n**

1. Ir em n8n → seu workflow → adicionar nó **Code**
2. Nome: "Agente"
3. Copiar código de `scratchpad/no_agente.js`
4. Substituir `@anthropic-ai/sdk` por chamada HTTP (código abaixo)

**Versão simplificada com HTTP (copiar direto):**

```javascript
// Entradas: $json.numero, $json.texto, $json.config

const numeroWhatsApp = $json.numero;
const textoUsuario = $json.texto;
const config = $json.config;

// System prompt
const systemPrompt = `Você se chama ${config.nome_assistente || 'Assistente'}.
Fale de forma ${config.tom || 'profissional'}.
Responda em ${config.idioma || 'pt-BR'}.

Você é o assistente pessoal de ${config.nome} pelo WhatsApp.

## Regras
- Mensagens curtas, 2 a 6 linhas. *negrito*, _itálico_.
- Use ferramentas quando precisar de dado real.
- Após registrar gasto, consulte o orçamento.
- Responda direto, sem preâmbulo.`;

// Por enquanto, resposta mock
const respostaMock = `Oi ${config.nome}! 👋

Entendi sua mensagem: "${textoUsuario}"

Ainda estou aprendendo... mas em breve vou poder:
✅ Criar tarefas no Trello
✅ Registrar gastos na planilha
✅ Consultar orçamento
✅ Listar contas a vencer

Trata de novo em alguns minutos!`;

return {
  resposta: respostaMock,
  ferramentas_usadas: [],
  voltas: 0,
};
```

---

### **PASSO 4 — Canvas do n8n (estrutura)**

Seu workflow deve ter:

```
1. Webhook WhatsApp (entrada)
   ↓
2. Filtra Mensagem (dedup + número autorizado)
   ↓
3. É áudio? → [sim] Transcreve [não] ↓
   ↓
4. Carrega Config (SELECT do Postgres)
   ↓
5. Agente (nó Code — loop de tool use)
   ↓
6. Envia WhatsApp
```

**Nó 4 — Carrega Config:**
```
- Tipo: Postgres
- Query: SELECT * FROM usuarios WHERE numero = '{{numero}}'
- Resultado: $json.config
```

**Nó 5 — Agente:**
- Código acima
- Entradas: numero, texto, config
- Saída: resposta, ferramentas_usadas

**Nó 6 — Envia WhatsApp:**
```
POST https://evo-hub67.duckdns.org/message/sendText/samir-pessoal

Headers: apikey {{EVOLUTION_API_KEY}}

Body:
{
  "number": "5567998283590@s.whatsapp.net",
  "text": "{{$json.resposta}}"
}
```

---

### **PASSO 5 — Testar manualmente**

Abra o n8n e rode o webhook com curl:

```bash
curl -X POST https://hub67.duckdns.org/webhook/agente-pessoal \
  -H "Content-Type: application/json" \
  -d '{
    "numero": "556798283590",
    "texto": "almoço 45 reais",
    "id": "msg123"
  }'
```

Esperado: Resposta com mock "Entendi que gastou 45 reais em almoço..."

---

### **PASSO 6 — Implementar as 8 ferramentas**

Cada ferramenta é um nó HTTP ou Code que você chama dentro do Agente.

**Exemplo: registrar_gasto**
```
POST https://sheets.googleapis.com/v4/spreadsheets/{{planilha_id}}/values/Gastos!A:D/append

Headers: Authorization: Bearer {{GOOGLE_SHEETS_TOKEN}}

Body:
{
  "values": [[
    "{{data}}",
    "{{descricao}}",
    "{{valor}}",
    "{{categoria}}"
  ]]
}
```

(Completo depois — agora é só mock)

---

### **PASSO 7 — Onboarding**

Quando `onboarding_completo = false`, o agente:
1. Pergunta: "Como quer me chamar?" → grava `nome_assistente`
2. Pergunta: "Formal ou informal?" → grava `tom`
3. Pergunta: "Que idioma?" → grava `idioma`
4. Pergunta: "Quer revisão semanal?" → grava `revisao_dia`, `revisao_hora`
5. Pergunta: "Quer orçamento?" → chama `definir_orcamento`

Estado no Redis, chave `onboarding:{numero}`, exp 24h.

---

## 🎯 Critério de "Pronto"

Você manda pelo WhatsApp:
- "o que tenho pra hoje?" → retorna lista do Trello
- "quanto gastei essa semana?" → retorna total da planilha
- "contas pra vencer" → retorna contas pendentes

Se os 3 funcionar, v2 está pronto!

---

## 📋 Checklist Rápido

- [ ] PASSO 1: SQL executado, `SELECT * FROM usuarios` retorna Samir
- [ ] PASSO 2: Planilha tem abas "Contas" e "Orçamento"
- [ ] PASSO 3: Nó Agente criado no n8n
- [ ] PASSO 4: Canvas montado (webhook → filtra → carrega config → agente → envia)
- [ ] PASSO 5: Teste com curl retorna mock
- [ ] PASSO 6: Ferramentas implementadas (prioridade: registrar_gasto, listar_tarefas)
- [ ] PASSO 7: Onboarding ativo
- [ ] ✅ Mensagens pelo WhatsApp funcionando

---

## 💾 Credenciais necessárias

Adicione ao `.env` da VPS:

```
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_SHEETS_TOKEN=ya29....
GOOGLE_SHEETS_REFRESH_TOKEN=1//....
EVOLUTION_API_KEY=...
```

No n8n, crie credenciais nomeadas:
- `anthropic-api`
- `google-sheets`
- `evolution-api`

---

## 🆘 Troubleshooting

**"usuarios table not found"**
→ Rodar PASSO 1 SQL novamente

**"INVALID_GRANT do Google Sheets"**
→ Token expirou, refazer OAuth

**"Não recebe mensagem no WhatsApp"**
→ Checar se Evolution está rodando: `docker compose logs evolution-api`

**"Agente retorna "Não consegui concluir"**
→ Ferramentas ainda mocks — implementar as reais

---

## 📚 Próximos passos após "Pronto"

1. Implementar as 8 ferramentas reais (Sheets + Trello + Redis)
2. Testar cada uma isoladamente
3. Briefing 6h expandido (adicionar contas + orçamento + atrasados)
4. Revisão semanal (novo cron)
5. Produto: duplicar usuários

**Versão:** v2.0 — Estrutura  
**Última atualização:** 2026-08-14
