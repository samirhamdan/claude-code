# CLAUDE.md — SDR Agent

Contexto permanente do projeto. Leia antes de qualquer tarefa.

---

## 1. O que é

Agente de qualificação de leads por mensagem. Recebe quem chega pelo
WhatsApp (ou Telegram), dá boas-vindas, qualifica em conversa natural e
entrega para o vendedor só o que está pronto — com follow-up automático
para o resto.

**Cliente piloto:** Alessio Segurança e Climatização, Campo Grande/MS.

**Objetivo comercial:** transformar isso em produto vendido junto com
tráfego pago — pacote de atração, conversão e qualificação. A Alessio é o
caso zero que gera as métricas de venda (tempo de resposta, % de leads
qualificados, custo por lead quente).

**Nichos-alvo, nesta ordem:** prestadores de serviço (climatização,
segurança, solar, reforma) → imobiliárias → clínicas por último.
Clínica exige API oficial e contrato de tratamento de dados, porque
conversa de paciente é dado sensível pela LGPD.

Por isso o código é **multi-cliente desde o começo**. Nada de valor
fixo da Alessio espalhado pelos fluxos — tudo vem de arquivo de config.

---

## 2. Estado atual (agosto/2026)

| Item | Status |
|---|---|
| VPS RackNerd (2 GB, New York, Ubuntu 24.04) | contratada |
| docker-compose lite (Postgres + Redis + n8n + Caddy) | implantado |
| DuckDNS + Caddy HTTPS | concluído (hub67.duckdns.org) |
| Bot do Telegram | concluído — eco funcionando |
| Fluxo de qualificação no n8n | em andamento (etapa 2) |
| Prompt de qualificação | escrito, não testado |
| Régua de score | não iniciada |
| Funil no Trello | não iniciado |
| Evolution API / WhatsApp | fase 2, não iniciada |

---

## 3. Decisões fechadas — não reabrir

Estas já foram discutidas. Se você discordar, diga o porquê em uma
frase e siga; não refaça sozinho.

1. **Telegram primeiro, WhatsApp depois.** O Telegram é bancada de teste:
   grátis, oficial, sem risco de banimento. Toda a lógica (prompt, estado,
   Trello, score) é idêntica. Na fase 2 trocam-se só os nós de entrada e
   saída pelo Evolution.

2. **WhatsApp via Evolution API, não API oficial da Meta.** Escolha
   consciente: elimina a janela de 24h, então o follow-up D+3 e D+7
   funciona sem template aprovado. Custo: risco de banimento do número,
   mitigado com chip dedicado, aquecimento e delay aleatório no envio.

3. **Estado da conversa no Redis, não no Postgres.** Chave por telefone,
   guarda histórico e campos coletados. O modelo é stateless — quem
   lembra é o Redis.

4. **Registro e follow-up no Trello**, board ALESSIO. Não construir CRM.

5. **O bot responde e qualifica sozinho**, mas passa para humano nos
   gatilhos de handoff (ver `prompts/system-qualificacao.md`).

6. **Uma chamada ao Claude por turno**, retornando JSON estrito.

---

## 4. Arquitetura

```
Telegram / WhatsApp
        │
        ▼
   n8n (webhook)
        │
   ┌────┴─────────────────────────┐
   │ 1. filtra (grupo, fromMe)    │
   │ 2. debounce 8s               │
   │ 3. lê estado no Redis        │
   │ 4. chama Claude → JSON       │
   │ 5. envia resposta            │
   │ 6. regrava estado            │
   │ 7. se completo → card Trello │
   └──────────────────────────────┘
        │
   cron diário → follow-up D+1 / D+3 / D+7
```

**Debounce de 8 segundos é obrigatório.** O lead manda três mensagens
seguidas; sem isso o bot responde três vezes e a conversa desanda.

**Injetar os campos já coletados em todo turno é obrigatório.** Sem
isso o bot repergunta o nome na quarta mensagem.

---

## 5. Estrutura do repositório

```
sdr-agent/
├── CLAUDE.md
├── infra/
│   ├── lite/                 # fase 1: sem Evolution
│   │   ├── docker-compose.yml
│   │   ├── Caddyfile
│   │   └── env.example
│   ├── full/                 # fase 2: com Evolution
│   └── README.md             # passo a passo de implantação
├── prompts/
│   ├── system-qualificacao.md
│   ├── schema-saida.json
│   └── clientes/
│       └── alessio.md        # variáveis por cliente
├── workflows/
│   ├── qualificacao.json     # export do n8n
│   └── followup.json
└── scripts/
    ├── backup.sh
    └── n8n-deploy.sh         # sobe workflow via API do n8n
```

---

## 6. Roadmap — seguir nesta ordem

1. **Infra** — VPS no ar, DuckDNS, HTTPS válido, n8n acessível, bot do
   Telegram respondendo um eco. **✅ concluída**
2. **Fluxo** — webhook → debounce → Redis → Claude → resposta. Ponta a
   ponta no Telegram, sem Trello ainda. **← em andamento**
3. **Score** — régua de classificação do lead, definida com o vendedor.
4. **Funil** — listas no Trello, criação de card, cron de follow-up.
5. **Fase 2** — Evolution API, chip aquecido, troca dos nós de I/O.

Não pule etapa. Cada uma tem um critério de pronto verificável.

---

## 7. Convenções

- **Idioma:** tudo em português do Brasil — código, comentários, commits,
  documentação. Nomes de variável em inglês quando for convenção da
  ferramenta (`docker-compose`, campos do n8n).
- **Timezone:** `America/Campo_Grande` em tudo.
- **Modelo:** `claude-sonnet-4-6` para qualificação.
- **Workflows do n8n:** nunca gerar JSON do zero. O JSON de nó é sensível
  a versão e importa quebrado. O caminho é: montar o esqueleto na
  interface → exportar → editar o export. Se precisar subir alterações,
  use a API REST do n8n (`/api/v1/workflows`), não import manual.
- **Commits:** mensagem curta, imperativo, em português.

---

## 8. Regras rígidas

- **Nunca commitar `.env`, token, API key ou chave privada.** O
  `.gitignore` cobre `.env`, mas confira antes de qualquer `git add -A`.
- **Nunca colocar credencial dentro do JSON do workflow.** O n8n guarda
  credenciais criptografadas com a `N8N_ENCRYPTION_KEY`; o JSON só
  referencia o ID delas.
- **Nunca trocar a `N8N_ENCRYPTION_KEY`** depois que houver credencial
  cadastrada — todas ficam ilegíveis.
- **Nunca fazer o bot prometer preço, prazo ou disponibilidade.** Ele
  qualifica; quem promete é o vendedor.
- **Backup antes de qualquer `docker compose pull`.** A RackNerd não tem
  snapshot automático — o `pg_dumpall` é o único backup que existe.

---

## 9. Comandos

```bash
# na VPS
docker compose ps
docker compose logs -f n8n
docker compose logs -f caddy
docker compose restart n8n

# backup
docker exec alessio_postgres pg_dumpall -U alessio > backup_$(date +%F).sql

# listar workflows via API do n8n
curl -H "X-N8N-API-KEY: $N8N_API_KEY" \
  https://$N8N_DOMAIN/api/v1/workflows
```

---

## 10. Glossário

- **Lead quente** — nome, serviço, tipo de imóvel, região e urgência
  preenchidos, e urgência é `imediata` ou `esta_semana`.
- **Handoff** — bot para de qualificar e chama humano.
- **Bancada** — ambiente Telegram, para testar sem risco de chip.
- **Fase 1 / Fase 2** — antes e depois da entrada do Evolution.
- **Caso zero** — a Alessio, primeiro cliente e fonte das métricas de
  venda do produto.
