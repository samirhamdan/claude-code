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
| docker-compose (Postgres + Redis + n8n + Caddy + Evolution) | implantado |
| DuckDNS + Caddy HTTPS | concluído (hub67.duckdns.org) |
| Evolution API / WhatsApp | ✅ instalado e funcionando |
| Bot de qualificação no WhatsApp | funcionando |
| Briefing matutino (horário pré-definido) | ✅ funcionando (7am) |
| Fluxo de qualificação (webhook → Redis → Claude) | próximo passo |
| Prompt de qualificação | escrito, em validação |
| Régua de score | não iniciada |
| Funil no Trello | não iniciado |

---

## 3. Decisões arquiteturais — implementadas

1. **WhatsApp via Evolution API, não API oficial da Meta.** ✅ Em produção.
   Elimina a janela de 24h, então o follow-up D+1/D+3/D+7 funciona sem
   template. Risco de banimento mitigado com chip dedicado e delay aleatório.

2. **Estado da conversa no Redis, não no Postgres.** ✅ Implementado.
   Chave por telefone, guarda histórico e campos coletados. O modelo é
   stateless — quem lembra é o Redis.

3. **Registro e follow-up no Trello**, board ALESSIO. Não construir CRM.
   (próximo passo após qualificação)

4. **O bot responde e qualifica sozinho**, mas passa para humano nos
   gatilhos de handoff (ver `prompts/system-qualificacao.md`).

5. **Uma chamada ao Claude por turno**, retornando JSON estrito.

---

## 4. Arquitetura

```
WhatsApp (Evolution API)
        │
        ▼
   n8n (webhook)
        │
   ┌────┴──────────────────────────┐
   │ 1. filtra (grupo, fromMe)     │
   │ 2. debounce 8s                │
   │ 3. lê estado no Redis         │
   │ 4. chama Claude → JSON        │
   │ 5. envia resposta (Evolution) │
   │ 6. regrava estado no Redis    │
   │ 7. se lead quente → card Trello
   └───────────────────────────────┘
        │
   cron diário → follow-up D+1 / D+3 / D+7 (Evolution)
```

**Fluxo:** Mensagem WhatsApp → Evolution webhook → n8n → Redis + Claude
→ resposta qualificadora → WhatsApp (Evolution).

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
│   ├── lite/                 # stack: Postgres + Redis + n8n + Caddy + Evolution
│   │   ├── docker-compose.yml
│   │   ├── Caddyfile
│   │   └── env.example
│   └── README.md             # passo a passo de implantação
├── prompts/
│   ├── system-qualificacao.md  # sistema do agente qualificador
│   ├── schema-saida.json       # estrutura JSON esperada
│   ├── briefing.md             # template de briefing matutino
│   └── clientes/
│       └── alessio.md          # variáveis por cliente
├── workflows/
│   ├── qualificacao.json       # export do n8n (webhook → Claude → Redis)
│   ├── followup.json           # cron diário (D+1, D+3, D+7)
│   └── briefing-matutino.json  # cron 7am (dados de mercado)
├── scripts/
│   ├── backup.sh               # backup do Postgres
│   ├── n8n-deploy.sh           # deploy via API do n8n
│   └── test-apis.sh            # validação de fontes
└── .env.example                # variáveis globais
```

---

## 6. Roadmap — seguir nesta ordem

1. **Infra** — VPS, DuckDNS, HTTPS, n8n, Evolution API. **✅ concluído**
2. **Briefing matutino** — cron 7am, dados de mercado via WhatsApp. **✅ funcionando**
3. **Fluxo de qualificação** — webhook → debounce → Redis → Claude → resposta. **← próximo**
4. **Score** — régua de classificação do lead, definida com vendedor.
5. **Funil** — Trello, criação de card, cron de follow-up D+1/D+3/D+7.

Cada etapa tem um critério de pronto verificável antes de passar à próxima.

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
- **Handoff** — bot para de qualificar e chama humano (vendedor).
- **Caso zero** — a Alessio, primeiro cliente em produção e fonte das
  métricas de venda do produto.
