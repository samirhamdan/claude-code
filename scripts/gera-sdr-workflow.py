#!/usr/bin/env python3
"""
Gera workflows/sdr-alessio.json a partir dos arquivos .js de nó.

O CLAUDE.md manda nunca escrever JSON de workflow do zero, porque ele é
sensível a versão e importa quebrado. Este script existe para reduzir esse
risco, não para negá-lo:

- As `typeVersion` de code, redis e httpRequest são **copiadas do
  resumo-do-dia.json**, que é export real desta instalação.
- As de webhook e wait são as duas únicas chutadas — não há export com elas
  no repo. Se alguma importar quebrada, é só apagar aquele nó e recriá-lo
  pela interface; o resto do canvas continua válido.
- O código dos nós vem dos .js, nunca digitado aqui. Uma fonte só.

Uso:
    python3 scripts/gera-sdr-workflow.py
"""

import json
import pathlib
import sys

RAIZ = pathlib.Path(__file__).resolve().parent.parent
WF = RAIZ / "workflows"
DESTINO = WF / "sdr-alessio.json"

# Versões confirmadas no export real (agente-pessoal/resumo-do-dia.json).
V_CODE = 2
V_REDIS = 1
V_HTTP = 4.2
# Chutadas — não há export com estes nós no repo.
V_WEBHOOK = 2
V_WAIT = 1.1

EVO_URL = "https://evo-hub67.duckdns.org/message/sendText/alessio-comercial"
TTL_BUFFER = 120        # 2 min: a janela de debounce é 8s, sobra folga
TTL_ESTADO = 60 * 60 * 24 * 30  # 30 dias de conversa parada


def js(nome, **troca):
    """Lê um nó .js. `troca` faz substituição literal, para o MODO do debounce."""
    texto = (WF / nome).read_text(encoding="utf-8")
    for de, para in troca.items():
        alvo = f"const {de} = '{para['de']}';"
        novo = f"const {de} = '{para['para']}';"
        if alvo not in texto:
            sys.exit(f"não achei `{alvo}` em {nome} — o arquivo mudou de forma")
        texto = texto.replace(alvo, novo)
    return texto


# `telefone` sai do Filtra Mensagem e é a identidade da conversa em tudo.
TEL = "{{ $('Filtra Mensagem').first().json.telefone }}"

nos = []
ligacoes = {}


def no(nome, tipo, versao, parametros, x, y):
    nos.append({
        "parameters": parametros,
        "id": f"n-{len(nos):02d}",
        "name": nome,
        "type": f"n8n-nodes-base.{tipo}",
        "typeVersion": versao,
        "position": [x, y],
    })
    return nome


def liga(*sequencia):
    for origem, destino in zip(sequencia, sequencia[1:]):
        ligacoes.setdefault(origem, {"main": [[]]})
        ligacoes[origem]["main"][0].append(
            {"node": destino, "type": "main", "index": 0}
        )


def redis_get(nome, chave, propriedade, x, y):
    return no(nome, "redis", V_REDIS, {
        "operation": "get",
        "propertyName": propriedade,
        "key": f"={chave}",
        "keyType": "automatic",
        "options": {},
    }, x, y)


def redis_set(nome, chave, valor, ttl, x, y):
    return no(nome, "redis", V_REDIS, {
        "operation": "set",
        "key": f"={chave}",
        "value": f"={valor}",
        "keyType": "string",
        "expire": True,
        "ttl": ttl,
        "options": {},
    }, x, y)


def code(nome, fonte, x, y):
    return no(nome, "code", V_CODE, {
        "mode": "runOnceForAllItems",
        "jsCode": fonte,
    }, x, y)


L1, L2, L3, L4 = 0, 240, 480, 720  # três linhas, para o canvas não virar uma fita

# ── entrada ──────────────────────────────────────────────────────────────
no("Webhook", "webhook", V_WEBHOOK, {
    "httpMethod": "POST",
    "path": "sdr-alessio",
    # Immediately: a Evolution recebe 200 na hora e não reenvia por timeout.
    # A resposta ao lead sai pelo nó Envia, não por aqui.
    "responseMode": "onReceived",
    "options": {},
}, 0, L1)

code("Filtra Mensagem", js("no-filtra-mensagem.js"), 220, L1)

# ── roteadores: `[]` mata o ramo, e é um typeVersion a menos que um IF ───
code("Só Texto", """// Deixa passar só mensagem digitada. O ramo de áudio morre aqui.
return $input.first().json.tipo === 'texto' ? $input.all() : [];
""", 440, L1)

code("Só Áudio", """// Espelho do Só Texto. Um dos dois sempre devolve [].
return $input.first().json.tipo === 'audio' ? $input.all() : [];
""", 440, L2)

# ── ramo de áudio ────────────────────────────────────────────────────────
no("Baixa Áudio", "httpRequest", V_HTTP, {
    "method": "POST",
    "url": "https://evo-hub67.duckdns.org/chat/getBase64FromMediaMessage/alessio-comercial",
    "authentication": "genericCredentialType",
    "genericAuthType": "httpHeaderAuth",
    "sendBody": True,
    "contentType": "json",
    "specifyBody": "json",
    "jsonBody": "={{ JSON.stringify({ message: { key: { id: $json.audio_id } } }) }}",
    "options": {},
}, 660, L2)

code("Converte Base64", js("no-audio.js",
                           MODO={"de": "binario", "para": "binario"}), 880, L2)

no("Transcreve", "httpRequest", V_HTTP, {
    "method": "POST",
    "url": "https://api.groq.com/openai/v1/audio/transcriptions",
    "sendHeaders": True,
    "headerParameters": {"parameters": [
        {"name": "Authorization", "value": "=Bearer {{ $env.GROQ_API_KEY }}"},
    ]},
    "sendBody": True,
    "contentType": "multipart-form-data",
    "bodyParameters": {"parameters": [
        {"parameterType": "formBinaryData", "name": "file", "inputDataFieldName": "data"},
        {"name": "model", "value": "whisper-large-v3-turbo"},
        {"name": "language", "value": "pt"},
    ]},
    "options": {},
}, 1100, L2)

code("Monta Texto", js("no-audio.js",
                       MODO={"de": "binario", "para": "texto"}), 1320, L2)

# ── debounce ─────────────────────────────────────────────────────────────
redis_get("Lê Buffer", f"buffer:{TEL}", "buffer_raw", 660, L1)

code("Marca Vez", js("no-debounce.js",
                     MODO={"de": "marcar", "para": "marcar"}), 880, L1)

redis_set("Grava Buffer", f"buffer:{TEL}",
          "{{ $('Marca Vez').first().json.buffer }}", TTL_BUFFER, 1100, L1)

redis_set("Marca Token", f"debounce:{TEL}",
          "{{ $('Marca Vez').first().json.token }}", TTL_BUFFER, 1320, L1)

no("Espera 8s", "wait", V_WAIT, {"amount": 8, "unit": "seconds"}, 1540, L1)

redis_get("Relê Token", f"debounce:{TEL}", "token_atual", 0, L3)
redis_get("Relê Buffer", f"buffer:{TEL}", "buffer_raw", 220, L3)

# Devolve [] quando perdeu a corrida — mata o ramo sem precisar de nó IF,
# que é um typeVersion a menos para errar.
code("Confere Debounce", js("no-debounce.js",
                            MODO={"de": "marcar", "para": "conferir"}), 440, L3)

# ── qualificação ─────────────────────────────────────────────────────────
redis_get("Lê Estado", f"estado:{TEL}", "estado_raw", 660, L3)

code("Qualifica", js("no-qualificacao.js"), 880, L3)

redis_set("Grava Estado", f"estado:{TEL}",
          "{{ $('Qualifica').first().json.estado }}", TTL_ESTADO, 1100, L3)

no("Limpa Buffer", "redis", V_REDIS, {
    "operation": "delete",
    "key": f"=buffer:{TEL}",
    "options": {},
}, 1320, L3)

code("Decide Envio", """// Silêncio proposital: conversa já entregue a humano, ou nada a dizer.
// Devolver [] aqui em vez de um IF é um typeVersion a menos para errar.
const j = $('Qualifica').first().json;
if (!j.enviar) return [];
return [{ json: j }];
""", 0, L4)

no("Envia WhatsApp", "httpRequest", V_HTTP, {
    "method": "POST",
    "url": EVO_URL,
    "authentication": "genericCredentialType",
    "genericAuthType": "httpHeaderAuth",
    "sendBody": True,
    "contentType": "json",
    "specifyBody": "keypair",
    "bodyParameters": {"parameters": [
        {"name": "number",
         "value": "={{ $('Qualifica').first().json.telefone }}@s.whatsapp.net"},
        {"name": "text",
         "value": "={{ $('Qualifica').first().json.resposta }}"},
    ]},
    "options": {},
}, 220, L4)

# Ramo de texto e ramo de áudio saem do mesmo Filtra Mensagem e voltam a se
# encontrar no Lê Buffer. Só um roda por mensagem — o outro morre com [].
liga("Webhook", "Filtra Mensagem")
liga("Filtra Mensagem", "Só Texto", "Lê Buffer")
liga("Filtra Mensagem", "Só Áudio", "Baixa Áudio", "Converte Base64",
     "Transcreve", "Monta Texto", "Lê Buffer")
liga("Lê Buffer", "Marca Vez", "Grava Buffer", "Marca Token", "Espera 8s",
     "Relê Token", "Relê Buffer", "Confere Debounce",
     "Lê Estado", "Qualifica", "Grava Estado", "Limpa Buffer",
     "Decide Envio", "Envia WhatsApp")

workflow = {
    "name": "SDR Alessio",
    "nodes": nos,
    "connections": ligacoes,
    "settings": {"executionOrder": "v1", "timezone": "America/Campo_Grande"},
    "pinData": {},
}

# Mesmo formato dos exports já versionados: 2 espaços, sem newline no fim.
DESTINO.write_text(json.dumps(workflow, indent=2, ensure_ascii=False),
                   encoding="utf-8")

print(f"Gravado: {DESTINO.relative_to(RAIZ)}")
print(f"  {len(nos)} nós, {sum(len(v['main'][0]) for v in ligacoes.values())} ligações")
print(f"  typeVersion chutadas: webhook={V_WEBHOOK}, wait={V_WAIT}")
