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
