# Implantação — SDR Agent

Passo a passo para subir a infra na VPS RackNerd (Ubuntu 24.04, 2 GB).

---

## 1. Acesso à VPS

```bash
ssh root@SEU_IP
```

---

## 2. Instalar Docker e Docker Compose

```bash
apt update && apt upgrade -y
apt install -y ca-certificates curl gnupg

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
```

Verificar:

```bash
docker --version
docker compose version
```

---

## 3. Criar subdomínio no DuckDNS

1. Acesse https://www.duckdns.org e faça login.
2. Crie um subdomínio (ex: `sdr`), apontando para o IP da VPS.
3. Copie o **token** — vai no `.env`.

---

## 4. Clonar o repositório e configurar

```bash
cd /opt
git clone https://github.com/samirhamdan/claude-code.git sdr-agent
cd sdr-agent/infra/lite
```

Criar o `.env` a partir do exemplo:

```bash
cp env.example .env
nano .env
```

Preencher:

| Variável | O que colocar |
|---|---|
| `DOMAIN` | `sdr.duckdns.org` (seu subdomínio) |
| `DUCKDNS_TOKEN` | token copiado do DuckDNS |
| `POSTGRES_PASSWORD` | senha forte gerada |
| `N8N_ENCRYPTION_KEY` | `openssl rand -hex 32` |
| `N8N_BASIC_AUTH_PASSWORD` | senha do painel n8n |
| `TELEGRAM_BOT_TOKEN` | token do @BotFather |
| `ANTHROPIC_API_KEY` | chave da Anthropic |

Gerar a encryption key:

```bash
openssl rand -hex 32
```

---

## 5. Subir os containers

```bash
docker compose up -d
```

Verificar:

```bash
docker compose ps
```

Todos devem estar `Up (healthy)` em ~30 segundos.

---

## 6. Verificar HTTPS

Acesse `https://sdr.duckdns.org` no navegador. O Caddy gera o
certificado TLS automaticamente na primeira requisição. Se demorar,
verifique:

```bash
docker compose logs caddy
```

---

## 7. Criar o bot do Telegram

1. Abra o Telegram e fale com o @BotFather.
2. `/newbot` → nome e username.
3. Copie o token e coloque no `.env` como `TELEGRAM_BOT_TOKEN`.
4. Reinicie o n8n: `docker compose restart n8n`.

---

## 8. Testar o eco

No n8n (`https://sdr.duckdns.org`):

1. Crie um workflow com um **Telegram Trigger** (tipo: message).
2. Conecte a um **Telegram Send Message** com:
   - Chat ID: `{{ $json.message.chat.id }}`
   - Text: `{{ $json.message.text }}`
3. Ative o workflow.
4. Mande uma mensagem pro bot no Telegram — deve ecoar.

Se ecoou, a **Etapa 1 está concluída**. Volte para montar o fluxo de
qualificação (Etapa 2).

---

## Webhook da Evolution — inscrição por instância

O agente pessoal levava **horas** para responder. Não era o modelo nem a
VPS: era enxurrada de webhook consumindo os três slots de concorrência do
n8n. O diagnóstico e o conserto, para não repetir.

### A regra

**Inscrição é por instância, não global.** O `WEBHOOK_GLOBAL_ENABLED` fica
`"false"` no compose de propósito.

```bash
export EVO=https://evo-hub67.duckdns.org
export EVO_KEY=$(grep -E '^EVOLUTION_API_KEY=' .env | head -1 | cut -d= -f2- | tr -d "\"' ")

curl -sS --fail-with-body -X POST "$EVO/webhook/set/samir-pessoal" \
  -H "apikey: $EVO_KEY" -H 'Content-Type: application/json' \
  -d '{"webhook":{"enabled":true,
       "url":"http://n8n:5678/webhook/whatsapp-pessoal",
       "webhookByEvents":false,
       "events":["MESSAGES_UPSERT"]}}'

curl -sS --fail-with-body "$EVO/webhook/find/samir-pessoal" -H "apikey: $EVO_KEY"
```

O `find` devolve `null` quando não há webhook por instância — `null` com
status 200 significa "não existe", não "deu errado".

### Por que não o global

1. **Vale para todas as instâncias.** Uma instância criada para outra coisa
   passa a despejar a conta de WhatsApp inteira dela no fluxo do agente.
2. **Os `WEBHOOK_EVENTS_*` do compose são lista de exclusão parcial** — o que
   não está lá vem ligado. Foi assim que `group-participants.update` chegou
   ao n8n sem nunca ter sido habilitado. O `events` do webhook por instância
   é lista de **permissão**: só passa o que está escrito.
3. **Global e por instância somam, não substituem** (v2.3.7). Com os dois
   ligados, cada mensagem gera duas execuções e o agente **responde
   duplicado**. Se aparecer resposta em dobro, é isso.

### Armadilhas que custaram tempo

- **`curl -s` esconde erro**, não só a barra de progresso. Com `$EVO` vazio
  a URL fica sem host, o curl recusa calado e a saída vazia parece sucesso.
  Use sempre `-sS --fail-with-body`.
- **A variável é `EVOLUTION_API_KEY`** no `.env`; `AUTHENTICATION_API_KEY` é
  o nome dela **dentro** do container. Buscar pelo nome errado dá chave
  vazia e 401.
- **`docker compose restart` não relê o ambiente.** Mudança em `.env` ou nos
  `environment:` do compose só entra com `docker compose up -d <serviço>`,
  que recria o container.
- **A URL do webhook é `http://n8n:5678/...`**, pela rede interna do Docker.
  Apontar para o domínio público faz cada evento sair da máquina, resolver
  DNS, atravessar o Caddy e negociar TLS — por evento.
- **`groupsIgnore`** é do endpoint `/settings/set/{instance}`, não do
  webhook. Sem ele, mensagem de grupo chega como `MESSAGES_UPSERT` legítimo
  e passa pela lista de permissão. Grupo de promoção sozinho gera dezenas de
  eventos por minuto.
- **`webhookBase64: true` volta como `false`** na v2.3.7. Não impede áudio:
  o fluxo busca a mídia sob demanda em vez de recebê-la embutida.

### Nó Webhook do n8n

**Respond: `Immediately`.** Em `When Last Node Finishes` a Evolution fica
pendurada esperando o fluxo inteiro — dezenas de segundos — e reenvia
quando desiste, multiplicando execuções. A resposta ao usuário sai pelo nó
`Envia Whatsapp`, então a resposta do webhook não serve para nada aqui.

---

## Comandos úteis

```bash
# ver logs
docker compose logs -f n8n
docker compose logs -f caddy

# backup do Postgres
docker exec alessio_postgres pg_dumpall -U alessio > backup_$(date +%F).sql

# reiniciar tudo
docker compose restart

# atualizar (backup antes!)
docker exec alessio_postgres pg_dumpall -U alessio > backup_pre_update_$(date +%F).sql
docker compose pull
docker compose up -d
```
