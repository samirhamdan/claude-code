# CLAUDE.md — Agente Pessoal v2

Contexto permanente do projeto. Leia antes de qualquer tarefa.

---

## 1. O que é

Assistente pessoal acessível por WhatsApp (texto e voz). Executa
tarefas, registra gastos, controla contas a pagar e receber, alerta
sobre orçamento e entrega briefings automáticos.

**Multi-tenant desde o começo.** Hoje tem um usuário (Samir). A
estrutura suporta N usuários sem reescrever o fluxo. Cada um tem seu
nome de assistente, tom, idioma e configurações.

**Potencial produto.** Se outras pessoas pedirem agentes pessoais,
a gestão é por tabela no Postgres — sem painel por enquanto.

---

## 2. Infraestrutura

| Componente | Detalhe |
|---|---|
| VPS | RackNerd, 2 GB, New York, Ubuntu 24.04 |
| Stack | Docker: Postgres, Redis, n8n, Caddy, Evolution API |
| Caminho | `/opt/sdr-agent/infra/lite/` |
| n8n | `https://hub67.duckdns.org` |
| Evolution | `https://evo-hub67.duckdns.org` |
| Instância WhatsApp | `samir-pessoal` |
| Timezone | `America/Campo_Grande` (UTC-4) |

---

## 3. O que já funciona (não quebrar)

| Funcionalidade | Status |
|---|---|
| Captura texto → gasto (planilha) ou tarefa (Trello) | ✅ |
| Captura áudio → Groq transcreve → mesmo fluxo | ✅ |
| Briefing 6h — tempo (Telegram) | ✅ |
| Briefing 8h — mercado (WhatsApp, número 5567998283590) | ✅ |
| Deduplicação por msgId | ✅ |
| Filtro por número autorizado | ✅ |

---

## 4. IDs e configuração do Samir

| Item | Valor |
|---|---|
| Número WhatsApp (remoteJid) | `556798283590` (sem o 9 após DDD) |
| Planilha Gastos (Drive) | `1n2zYgTP3reMH4XHKMGp9kcjoGrZvvW5b7pvw7MxTQFQ` |
| Board Trello | `6a7dc5727395c7659ee6c198` |
| Lista Entrada (Trello) | `6a7dc621a617c68855a4df89` |
| Chat ID Telegram | `497123917` |
| Credencial Telegram no n8n | id: `gK70qWirI4c5903j` |
| Número destino briefing WhatsApp | `5567998283590` |

---

## 5. Arquitetura v2 — Laço de Tool Use

### Fluxo

```
WhatsApp → Webhook
              ↓
         Filtra Mensagem (dedup + número autorizado)
              ↓
         É áudio? ─── sim → Baixa Audio → Converte Base64
              │                   → Groq Transcreve → Monta Payload
              └── não ─────────────────────────────────────┐
                                                           ↓
                                                  Carrega Config
                                                  (SELECT do Postgres)
                                                           ↓
                                                  Agente (Code)
                                                  ┌─────────────────┐
                                                  │ Claude + tools   │
                                                  │ loop até 5x     │
                                                  │ ou resposta text │
                                                  └─────────────────┘
                                                           ↓
                                                  Responde WhatsApp
```

### Nó Agente — lógica do loop

```
1. Monta system prompt com config do usuário
2. Chama Claude com tools + mensagem
3. Se resposta tem tool_use:
   a. Executa a ferramenta (HTTP ou código)
   b. Adiciona tool_result ao array de messages
   c. Volta pro passo 2
4. Se resposta é só text:
   → retorna o texto como resposta
5. Se 5 voltas sem text:
   → "Não consegui concluir, tenta de novo"
```

---

## 6. Tabela de usuários (Postgres)

```sql
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
```

Inserir o registro do Samir na criação. As chaves do Trello e da API
ficam no banco, não no JSON do workflow — assim cada usuário tem as
suas.

---

## 7. Planilha — Estrutura de abas

### Aba "Gastos" (já existe)
| Data | Descrição | Valor | Categoria |

### Aba "Contas" (criar)
| Descrição | Valor | Dia | Categoria | Tipo | Fluxo |

- Dia = dia do mês do vencimento
- Tipo = fixa | parcelada
- Fluxo = pagar | receber

### Aba "Orçamento" (criar)
| Categoria | Limite |

Limites são opcionais. Categoria sem limite não gera alerta.
Categorias são dinâmicas — o Claude infere pelo contexto.
Quando registrar gasto numa categoria sem limite, ele pergunta
se o usuário quer definir um.

---

## 8. Ferramentas do Claude

### Escrita

| Ferramenta | Argumentos | Destino |
|---|---|---|
| criar_tarefa | titulo, descricao?, prazo? | Trello |
| registrar_gasto | descricao, valor, categoria, data? | Planilha aba Gastos |
| registrar_conta | descricao, valor, dia, categoria, tipo, fluxo | Planilha aba Contas |
| definir_orcamento | categoria, limite | Planilha aba Orçamento |

### Leitura

| Ferramenta | Argumentos | Fonte |
|---|---|---|
| listar_tarefas | filtro: hoje\|semana\|atrasados\|todos | Trello |
| consultar_gastos | periodo: ontem\|semana\|mes, categoria? | Planilha aba Gastos |
| listar_contas | periodo: proximos_dias\|mes\|atrasadas | Planilha Contas × Gastos |
| consultar_orcamento | categoria? | Planilha Orçamento × Gastos |

### Regras

- Após registrar_gasto, sempre chamar consultar_orcamento da mesma
  categoria. Se > 80%, alertar. Se > 100%, alertar com urgência.
- Ao registrar gasto em categoria sem limite, perguntar se quer definir.
- listar_contas cruza aba Contas com aba Gastos: conta sem gasto
  correspondente no mês = pendente.

---

## 9. Onboarding

Quando `onboarding_completo = false`, o agente faz 5 perguntas na
primeira conversa, uma por vez:

1. "Como quer me chamar?" → grava `nome_assistente`
2. "Prefere que eu fale formal ou informal?" → grava `tom`
3. "Em que idioma?" → grava `idioma`
4. "Quer receber uma revisão semanal? Se sim, qual dia e horário?" →
   grava `revisao_dia` e `revisao_hora`
5. "Quer definir limites de orçamento por categoria?" → chama
   `definir_orcamento` se sim

Depois marca `onboarding_completo = true` e entra no modo normal.

O estado do onboarding (qual pergunta está) fica no Redis, chave
`onboarding:{numero}`, com expiração de 24h.

---

## 10. System prompt (template)

```
Você se chama {nome_assistente}.
Fale de forma {tom}.
Responda em {idioma}.

Você é o assistente pessoal de {nome} pelo WhatsApp.

Hoje é {data_extenso} ({data_iso}), fuso de Campo Grande, UTC-4.

## Regras
- Mensagens curtas, 2 a 6 linhas. Formatação: *negrito*, _itálico_.
- Use ferramentas quando precisar de dado real. Nunca invente.
- Pode chamar mais de uma ferramenta antes de responder.
- Após registrar gasto, consulte o orçamento da categoria.
- Se o orçamento passou de 80%, alerte. Se passou de 100%, alerte
  com mais urgência.
- Quando registrar gasto em categoria sem limite, pergunte se quer
  definir um.
- Responda direto, sem preâmbulo.

## Sobre tarefas
- Títulos começando por verbo no infinitivo.
- Prazos em UTC (some 4h ao horário local).
- "O que tenho pra hoje" = listar_tarefas(hoje).

## Sobre contas
- "Contas para vencer" mostra a pagar e a receber separados.
- Conta sem gasto correspondente no mês = pendente.

## Áudio
- Se vier de transcrição, interprete pelo contexto.
- Responda sempre em texto.

## Limites
- Não envia e-mail, não apaga nada, não fala com terceiros.
- Não dá recomendação de investimento.
```

---

## 11. Briefings

### Briefing 6h — Tempo (já existe no Telegram)
Adicionar depois:
- Contas que vencem hoje ou amanhã
- Categorias de orçamento acima de 80%
- Cards atrasados no Trello

### Briefing 8h — Mercado (já existe no WhatsApp)
Sem alteração.

### Revisão semanal (novo cron, dia/hora por usuário)
Resumo: tarefas criadas/concluídas/abertas, gastos totais e por
categoria, orçamento, contas pendentes, próxima semana.

---

## 12. Convenções

- Idioma: português do Brasil em tudo
- Timezone: America/Campo_Grande
- Modelo: claude-sonnet-4-6
- Commits: imperativo, em português
- Nunca commitar .env, token ou chave
- Um passo de cada vez — espere confirmação

---

## 13. Credenciais necessárias no n8n

| Serviço | Onde fica |
|---|---|
| Anthropic API key | header do nó HTTP |
| Evolution API key | header do nó HTTP |
| Google Sheets | credencial OAuth2 ou Service Account |
| Trello key + token | tabela `usuarios` no Postgres |
| Groq API key | header do nó HTTP |

---

## 14. Comandos úteis

```bash
# VPS
ssh root@23.95.96.132
cd /opt/sdr-agent/infra/lite

# Logs
docker compose logs -f n8n
docker compose logs -f evolution-api

# Postgres
docker exec -it alessio_postgres psql -U alessio

# Backup
docker exec alessio_postgres pg_dumpall -U alessio > backup_$(date +%F).sql

# Reconectar WhatsApp
curl https://evo-hub67.duckdns.org/instance/connect/samir-pessoal \
  -H "apikey: SUA_API_KEY"
```
