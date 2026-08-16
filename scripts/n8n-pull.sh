#!/usr/bin/env bash
#
# Baixa um workflow do n8n para o repo, no mesmo formato dos exports que já
# estão versionados.
#
# Por que existe: metade do canvas do `Agente Pessoal v2` — `Filtra Mensagem`,
# `Texto ou Audio`, `Converte Base64`, `Monta payload audio` — só existe dentro
# do n8n. A VPS da RackNerd não tem snapshot automático. Copiar nó a nó na mão
# não se repete; isto se repete.
#
#   scripts/n8n-pull.sh                                  # lista os workflows
#   scripts/n8n-pull.sh <id> agente-pessoal/v2.json      # baixa um
#
# Precisa de N8N_DOMAIN e N8N_API_KEY no ambiente (a API key sai de
# Settings → API dentro do n8n):
#
#   export N8N_DOMAIN=hub67.duckdns.org
#   export N8N_API_KEY=...
#
# Nunca exporte a API key para dentro de arquivo do repo.

set -euo pipefail

: "${N8N_DOMAIN:?defina N8N_DOMAIN, ex: hub67.duckdns.org}"
: "${N8N_API_KEY:?defina N8N_API_KEY (Settings -> API no n8n)}"

api() {
  curl -sS --fail-with-body -H "X-N8N-API-KEY: $N8N_API_KEY" \
    "https://$N8N_DOMAIN/api/v1/$1"
}

# Sem argumentos: lista id e nome, que é como se descobre o id para baixar.
if [ $# -eq 0 ]; then
  api 'workflows?limit=100' | node -e '
    let e = "";
    process.stdin.on("data", (d) => (e += d));
    process.stdin.on("end", () => {
      for (const w of JSON.parse(e).data) {
        console.log(`${w.id}\t${w.active ? "ativo   " : "inativo "}\t${w.name}`);
      }
    });
  '
  echo
  echo "Uso: scripts/n8n-pull.sh <id> <arquivo-destino>"
  exit 0
fi

if [ $# -ne 2 ]; then
  echo "Uso: scripts/n8n-pull.sh <id> <arquivo-destino>" >&2
  exit 1
fi

ID="$1"
DESTINO="$2"

# Guarda só o que descreve o workflow. O resto do que a API devolve — id,
# versionId, createdAt, updatedAt, active — muda a cada salvamento e sujaria
# o diff sem dizer nada. `pinData` sai também: é dado de teste, e no v2 ele
# carrega payload real de WhatsApp, com telefone e conteúdo de mensagem.
api "workflows/$ID" | node -e '
  let e = "";
  process.stdin.on("data", (d) => (e += d));
  process.stdin.on("end", () => {
    const w = JSON.parse(e);
    const limpo = {
      name: w.name,
      nodes: w.nodes,
      connections: w.connections,
      settings: w.settings ?? {},
      pinData: {},
    };
    // Mesmo formato dos exports já versionados: 2 espaços, sem newline final.
    process.stdout.write(JSON.stringify(limpo, null, 2));
  });
' > "$DESTINO"

echo "Gravado: $DESTINO"
echo
echo "Confira se não veio credencial junto antes de commitar:"
echo "  git diff -- $DESTINO | grep -iE 'apikey|api_key|token|secret|password'"
