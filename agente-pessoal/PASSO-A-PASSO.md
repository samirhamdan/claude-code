# Agente Pessoal v2 — Passo a passo

Ordem: valida Trello → grava no banco → configura n8n → monta canvas → testa.
Não pule para a fase seguinte se a anterior não fechou.

---

## Estado — 14/08/2026

| Fase | Status |
|---|---|
| 1. Credenciais do Trello | ✅ |
| 2. Gravar no banco | ✅ |
| 3. Env no Code node | ✅ |
| 4. Canvas | ✅ 5 nós ligados |
| 5. Teste por curl | ✅ criar_tarefa e listar_tarefas |
| 5b. Memória entre turnos | ✅ histórico no Redis, db 2, TTL 1 ano |
| 6. Google Sheets | ✅ OAuth com refresh token |
| 7. WhatsApp de verdade | ✅ em produção, texto e áudio |

**Provado em produção:** webhook → Postgres → Redis → laço de tool use →
Anthropic → Trello → WhatsApp → Redis. Card criado com prazo convertido
certo para UTC (14h local → `18:00Z`), listado de volta no turno seguinte,
e o agente lembra do turno anterior sem reconsultar o Trello.

**Canvas atual:**

```
Webhook → Filtra Mensagem → Texto ou Audio
                             ├─ (0, texto) ──────────────────────┐
                             └─ (1, áudio) → Baixa audio →       │
                                Converte Base64 → Audio          │
                                transcreve → Monta payload ──────┤
                                                                 ▼
                                                        Carrega Config
                                                                 ↓
                                Lê Histórico → Lê Fatos → Monta Entrada
                                           → Agente → Envia WhatsApp
                                           → Grava Histórico
```

O código de `Monta Entrada` está em `agente-pessoal/monta_entrada.js`; o do
`Agente`, em `agente-pessoal/no_agente.js`.

### Código de nó: o .js manda, o JSON é gerado

O n8n não tem import — o código de um nó Code mora dentro do JSON do
workflow. O `Agente` existe em dois workflows (`Agente Pessoal v2` e
`Resumo do Dia`), e manter as duas cópias na mão já falhou uma vez: a do
`Resumo do Dia` passou semanas sem `concluir_tarefa` e `arquivar_tarefa`.

Agora a fonte é o `.js` e o JSON é gerado a partir dele:

```bash
node scripts/n8n-sync-code.mjs           # injeta os .js nos JSON
node scripts/n8n-sync-code.mjs --check   # só acusa divergência, sai 1
```

Ferramenta nova se edita em **um** lugar: `no_agente.js`, depois `sync-code`,
depois sobe pela API REST do n8n.

Para trazer um workflow do n8n para o repo — é assim que o resto do canvas
sai de dentro da VPS:

```bash
export N8N_DOMAIN=hub67.duckdns.org
export N8N_API_KEY=...            # Settings → API dentro do n8n
scripts/n8n-pull.sh                                   # lista id e nome
scripts/n8n-pull.sh <id> agente-pessoal/agente-v2.json
```

O `n8n-pull.sh` descarta `id`, `versionId`, `createdAt`, `updatedAt` e
`active`, que mudam a cada salvamento, e esvazia o `pinData`, que é dado de
teste e no v2 carrega payload real de WhatsApp — telefone e conteúdo de
mensagem. Depois de baixar o v2, acrescente as linhas dele ao `MAPA` do
`n8n-sync-code.mjs`.

O v2 assumiu o path `whatsapp-pessoal` da Evolution e o v1 foi desativado —
a Evolution não precisou ser tocada. Para reverter: despublica o v2, devolve
o path dele para `agente-v2`, republica o v1.

**Faltando:** onboarding (seção 9 do CLAUDE.md). Depende de gravar as
respostas na tabela `usuarios`, e o Code node não alcança o Postgres —
vai precisar de um nó Postgres depois do Agente, no mesmo padrão que o
Redis resolveu a memória.

**Faltando também:** o export do `Agente Pessoal v2`. O `scripts/n8n-pull.sh`
já faz o download, mas ele precisa rodar contra a VPS com `N8N_API_KEY` no
ambiente — até lá, `Filtra Mensagem`, `Texto ou Audio`, `Converte Base64` e
`Monta payload audio` continuam existindo só dentro do n8n.

### Armadilhas já resolvidas, não repetir

- O banco `alessio` não existia; o n8n usa o banco `n8n`. Precisou `CREATE DATABASE`.
- Heredoc do `psql` engoliu o SQL — o que funcionou foi `docker cp` + `psql -f`.
- Na página do Trello há **Key**, **Secret** e **Token**. O Secret não serve aqui.
- O task runner do n8n 2.33 não expõe `fetch` nem `URLSearchParams`. A saída
  de rede é `this.helpers.httpRequest`.
- "Execute step" num nó sem entrada põe o Webhook em escuta — parece travado,
  mas está esperando o curl.
- A aba de gastos da planilha chamava `Untitled`, não `Gastos`. O nó do Sheets
  no v1 a referencia por ID ("From list"), então renomear não quebrou o v1.
- Um refresh token gerado com o app OAuth em "Teste" **expira em 7 dias** — a
  resposta do Google traz `refresh_token_expires_in` quando isso acontece.
  Publicar o app antes de gerar é o que evita.
- O `!` do intervalo (`Gastos!A1:D3`) dispara expansão de histórico no bash
  interativo mesmo entre aspas duplas. Use aspas simples na URL.
- **Referenciar com `$('nome')` um nó que não rodou derruba o nó inteiro.**
  Numa mensagem de texto o ramo de áudio fica todo sem executar, então ler
  `$('Monta payload audio')` direto quebra o `Monta Entrada`. A guarda é
  `$('nome').isExecuted` antes do `.first()`, dentro de try/catch.
  No painel INPUT dá para reconhecer: nó que rodou mostra "1 item", nó que
  não rodou não mostra contagem nenhuma.
- **O nó Redis devolve só a propriedade que setou, e descarta o resto do
  item.** Com `Lê Histórico` e `Lê Fatos` em série, o item que chega no
  `Monta Entrada` tem `fatos_raw` e já perdeu `historico_raw`. Ler o
  histórico de `$input` não dá erro — dá histórico vazio, que é pior. Leia
  pelo nome do nó: `$('Lê Histórico').first().json.historico_raw`.
- **Regra do prompt que contradiz uma ferramenta o modelo contorna sozinho, e
  de um jeito diferente a cada chamada.** O `## Limites` seguiu dizendo "não
  apaga nada" depois que `cancelar_evento`, `arquivar_tarefa` e
  `esquecer_fato` já existiam; perguntado o que fazia, o agente reescreveu a
  regra para "não apago sem você pedir". Acertou dessa vez — podia ter
  recusado um cancelamento legítimo. Ferramenta nova pede passada no prompt.

---

## FASE 1 — Validar Trello antes de qualquer coisa

Pegue key e token em https://trello.com/app-key
(o token sai do link "Token" na mesma página; autorize com validade `never`).

Exporte na VPS para não repetir:

```bash
export TK="sua_key"
export TT="seu_token"
export BOARD="6a7e8330ecaf78018711005b"
```

### 1.1 — A credencial é válida?

```bash
curl -s "https://api.trello.com/1/members/me?key=$TK&token=$TT" | head -c 200
```

**Esperado:** JSON com `"username":"samirhamdan"`.
**Se vier `invalid key` ou `unauthorized`:** key ou token errados, pare aqui.

### 1.2 — O board existe e é acessível?

```bash
curl -s "https://api.trello.com/1/boards/$BOARD?key=$TK&token=$TT&fields=name" 
```

**Esperado:** `{"id":"6a7e8330ecaf78018711005b","name":"Agente Pessoal v2"}`

### 1.3 — As listas batem?

```bash
curl -s "https://api.trello.com/1/boards/$BOARD/lists?key=$TK&token=$TT&fields=name"
```

**Esperado:** quatro listas, com estes IDs (já conferidos):

| Lista | ID |
|---|---|
| Entrada | `6a7e8338c1c5d2be03bcc512` |
| Hoje | `6a7e833bb712c022333b8601` |
| Semana | `6a7e833d205e792df694e439` |
| Concluído | `6a7e833f688b608673bed02c` |

```bash
export LISTA="6a7e8338c1c5d2be03bcc512"
```

Se os IDs vierem diferentes, use os que a chamada devolveu — ela é a
fonte da verdade.

### 1.4 — Consigo criar card? (é o que `criar_tarefa` faz)

```bash
curl -s -X POST "https://api.trello.com/1/cards?key=$TK&token=$TT&idList=$LISTA&name=teste%20do%20agente" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['name'], d['shortUrl'])"
```

**Esperado:** `teste do agente https://trello.com/c/xxxxx`
Confira no Trello que o card apareceu na lista certa.

### 1.5 — Consigo listar cards? (é o que `listar_tarefas` faz)

```bash
curl -s "https://api.trello.com/1/boards/$BOARD/cards?key=$TK&token=$TT&fields=name,due,dueComplete"
```

**Esperado:** array com o card de teste.

✅ **Fase 1 fecha quando 1.1 a 1.5 passam.** Apague o card de teste no Trello.

---

## FASE 2 — Gravar as credenciais no banco

```bash
docker exec alessio_postgres psql -U alessio -d alessio -c \
  "UPDATE usuarios SET trello_key='$TK', trello_token='$TT', trello_list_id='$LISTA' WHERE numero='556798283590';"
```

Conferir:

```bash
docker exec alessio_postgres psql -U alessio -d alessio -c \
  "SELECT numero, nome, trello_board_id, trello_list_id, left(trello_key,6)||'...' AS key FROM usuarios;"
```

**Esperado:** uma linha, com board e lista preenchidos.

---

## FASE 3 — Liberar env no Code node do n8n

### 3.1 — Chave da Anthropic no .env

```bash
cd /opt/sdr-agent/infra/lite
echo 'ANTHROPIC_API_KEY=sk-ant-sua-chave' >> .env
```

### 3.2 — Passar a variável para o container

Em `docker-compose.yml`, serviço `n8n`, dentro de `environment:`:

```yaml
      N8N_BLOCK_ENV_ACCESS_IN_NODE: "false"
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
```

### 3.3 — Subir

```bash
docker compose up -d n8n
docker compose logs --tail=20 n8n
```

### 3.4 — Conferir que a variável chegou

```bash
docker exec alessio_n8n printenv ANTHROPIC_API_KEY | head -c 12
```

**Esperado:** `sk-ant-api03` ou parecido. Se vier vazio, o compose não pegou.

---

## FASE 4 — Montar o canvas

Crie um **workflow novo** — não edite o v1, ele tem que continuar rodando.

Nome: `Agente Pessoal v2`

### Nó 1 — Webhook

- Tipo: Webhook
- Method: POST
- Path: `agente-v2`
- Response Mode: `Last Node`

### Nó 2 — Carrega Config (Postgres)

- Tipo: Postgres → Execute Query
- Credencial: a mesma que o v1 já usa, mas **database `alessio`**
- Query:

```sql
SELECT * FROM usuarios WHERE numero = '{{ $json.body.numero }}' AND ativo = true;
```

### Nó 3 — Monta Entrada (Code)

O nó Agente espera `texto` e `config` no mesmo item. Nesta fase, com cinco
nós e sem Redis, isso é o suficiente:

```javascript
return [{
  json: {
    numero: $('Webhook').first().json.body.numero,
    texto:  $('Webhook').first().json.body.texto,
    config: $input.first().json,
  }
}];
```

> **No canvas atual isto já não basta.** Depois que entraram o ramo de áudio,
> o `Lê Histórico` e o `Lê Fatos`, a versão que vale é
> `agente-pessoal/monta_entrada.js` — ela acrescenta `historico` e `fatos` e
> trata o ramo de áudio como opcional. Veja as duas armadilhas no topo.

### Nó 4 — Agente (Code)

- Tipo: Code
- Mode: **Run Once for All Items**
- Cole o conteúdo de `agente-pessoal/no_agente.js`

### Nó 5 — Envia WhatsApp (HTTP Request)

- Method: POST
- URL: `https://evo-hub67.duckdns.org/message/sendText/samir-pessoal`
- Header: `apikey` = sua Evolution key
- Body (JSON):

```json
{
  "number": "5567998283590@s.whatsapp.net",
  "text": "={{ $json.resposta }}"
}
```

Ligação: `Webhook → Carrega Config → Monta Entrada → Agente → Envia WhatsApp`

---

## FASE 5 — Testar

Clique em **Listen for test event** no Webhook, depois dispare:

### 5.1 — Caminho só-Trello (não depende do Google)

```bash
curl -s -X POST https://hub67.duckdns.org/webhook-test/agente-v2 \
  -H 'Content-Type: application/json' \
  -d '{"numero":"556798283590","texto":"o que tenho pra hoje?"}'
```

**Esperado:** resposta listando cards, ou "Nenhuma tarefa nesse filtro."
No painel do nó Agente, `ferramentas_usadas` deve mostrar `listar_tarefas`.

### 5.2 — Criar tarefa

```bash
curl -s -X POST https://hub67.duckdns.org/webhook-test/agente-v2 \
  -H 'Content-Type: application/json' \
  -d '{"numero":"556798283590","texto":"ligar pro fornecedor sexta 14h"}'
```

**Esperado:** card novo no Trello com prazo, e confirmação curta na resposta.

✅ **Se 5.1 e 5.2 passam, o laço de tool use está funcionando.**
As ferramentas de planilha só faltam credencial — a mecânica já está provada.

### 5.3 — Depois de configurar o Google (Fase 6)

```bash
curl -s -X POST https://hub67.duckdns.org/webhook-test/agente-v2 \
  -H 'Content-Type: application/json' \
  -d '{"numero":"556798283590","texto":"almoço 45 reais"}'

curl -s -X POST https://hub67.duckdns.org/webhook-test/agente-v2 \
  -H 'Content-Type: application/json' \
  -d '{"numero":"556798283590","texto":"quanto gastei essa semana?"}'

curl -s -X POST https://hub67.duckdns.org/webhook-test/agente-v2 \
  -H 'Content-Type: application/json' \
  -d '{"numero":"556798283590","texto":"internet 150 dia 10 conta fixa"}'

curl -s -X POST https://hub67.duckdns.org/webhook-test/agente-v2 \
  -H 'Content-Type: application/json' \
  -d '{"numero":"556798283590","texto":"contas pra vencer"}'
```

---

## FASE 6 — Google Sheets

O nó renova o token sozinho se tiver refresh token. No `.env`:

```
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_REFRESH_TOKEN=1//...
```

E no `docker-compose.yml`, serviço `n8n`:

```yaml
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET}
      GOOGLE_REFRESH_TOKEN: ${GOOGLE_REFRESH_TOKEN}
```

Client id e secret saem da mesma credencial OAuth que o v1 usa
(n8n → Credentials → a credencial do Google → Client ID / Secret).
O refresh token: https://developers.google.com/oauthplayground, escopo
`https://www.googleapis.com/auth/spreadsheets`, marcando "Use your own
OAuth credentials".

Testar sem passar pelo agente:

```bash
docker exec alessio_n8n printenv GOOGLE_REFRESH_TOKEN | head -c 8
```

Depois rode 5.3.

---

## FASE 7 — Ligar no WhatsApp de verdade

Só depois que 5.1 a 5.3 passarem por curl.

1. Copie os nós de filtro do v1 (dedup por msgId + número autorizado) para
   antes do `Carrega Config`.
2. Copie o ramo de áudio do v1 (Baixa Audio → Base64 → Groq → Monta Payload).
3. Troque o Webhook de teste pelo de produção (`webhook` no lugar de
   `webhook-test`).
4. Aponte o webhook global da Evolution para o path novo, **ou** deixe o v1
   ativo e teste o v2 por um número secundário até confiar.
5. Só então desative o v1.

---

## Ainda não implementado

| O quê | Onde entra |
|---|---|
| Onboarding (5 perguntas) | precisa de estado no Redis, chave `onboarding:{numero}` |
| Histórico de conversa | hoje cada mensagem chega sem memória do turno anterior |
| Revisão semanal | cron novo, dia/hora por usuário |
| Briefing 6h expandido | somar contas + orçamento + atrasados ao que já existe |

---

## Quando der errado

| Sintoma | Causa provável |
|---|---|
| `invalid key` no Trello | key/token errados — refaça a Fase 1 |
| `Anthropic 401` | `ANTHROPIC_API_KEY` não chegou no container (Fase 3.4) |
| `$env is not defined` | falta `N8N_BLOCK_ENV_ACCESS_IN_NODE: "false"` |
| `Sheets 401` | token vencido — configure o refresh token (Fase 6) |
| Resposta "Não consegui concluir" | bateu as 5 voltas; veja `ferramentas_usadas` no painel |
| `config is undefined` | o SELECT não achou o número, ou o nó 3 não montou o item |
