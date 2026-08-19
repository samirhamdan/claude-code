# Cliente: Alessio Segurança e Climatização

Config do cliente. O `system-qualificacao.md` é genérico e lê tudo daqui —
nada da Alessio deve aparecer no prompt de qualificação.

**Marcado com ⚠️ o que ainda precisa ser preenchido por quem conhece a
operação.** O bot funciona sem, mas erra mais: sem faixa de atendimento ele
qualifica lead de fora da área, e sem horário promete resposta de madrugada.

---

## Identidade

| Campo | Valor |
|---|---|
| `empresa` | Alessio Segurança e Climatização |
| `atendente` | Samir |
| `cidade` | Campo Grande / MS |
| `timezone` | America/Campo_Grande |

## Atendimento

| Campo | Valor |
|---|---|
| `horario` | ⚠️ seg–sex 8h–18h? sábado? |
| `regiao_atendimento` | ⚠️ só Campo Grande, ou região? quais cidades? |
| `fora_de_area` | ⚠️ o que dizer para quem está fora — recusa, ou passa para vendedor avaliar? |

## Serviços — e os números do menu

O número que a pessoa digita mapeia direto para `campos.servico`:

| Menu | Rótulo | `servico` |
|---|---|---|
| 1️⃣ | Câmeras de Segurança | `camera` |
| 2️⃣ | Ar Condicionado | `ar_condicionado` |
| 3️⃣ | Cerca Elétrica | `cerca_eletrica` |
| 4️⃣ | Alarmes | `alarme` |
| 5️⃣ | Interfones e Portões | `interfone_portao` |
| 6️⃣ | Falar com vendedor | — (`intencao: vendedor`) |
| 7️⃣ | Falar com suporte | — (`intencao: suporte`) |

**Motor de portão com wifi**, que é a campanha atual de tráfego pago, cai em
`interfone_portao`. O anúncio não usa a palavra "interfone", então quem vem
dele pode não reconhecer a opção 5 — por isso a origem `anuncio` pula o menu.

## Mensagem de boas-vindas

Usada quando a origem é desconhecida (indicação, busca orgânica, contato
direto):

```
Olá! Seja bem vindo a Alessio Segurança e Climatização!

Meu nome é Samir e estou aqui para ajudar com nossas soluções.

Escolha uma opção:

1️⃣ Câmeras de Segurança
2️⃣ Ar Condicionado
3️⃣ Cerca Elétrica
4️⃣ Alarmes
5️⃣ Interfones e Portões
6️⃣ Falar com vendedor
7️⃣ Falar com suporte

Responda com o número desejado!
```

## Origens

De onde o contato chega muda a primeira mensagem.

| Origem | Como se detecta | Primeira mensagem |
|---|---|---|
| `anuncio` | ⚠️ depende do Click-to-WhatsApp: a Meta manda o texto pré-preenchido do anúncio na primeira mensagem. Confirmar o texto exato da campanha atual. | Pula o menu. Confirma o serviço do anúncio e já começa a qualificar. |
| `cliente` | Telefone já existe na base | Não oferece menu de venda — pergunta se é sobre um serviço já instalado |
| `desconhecida` | Qualquer outro caso | Menu completo acima |

## Handoff — quando o bot para e chama humano

Sempre:

- Pediu explicitamente falar com pessoa (opção 6, ou "quero falar com alguém")
- Opção 7 (suporte): é cliente com problema, não lead
- Insistiu em preço, prazo ou disponibilidade depois de uma recusa
- Reclamação, cobrança ou tom de irritação
- Lead quente completo (ver régua abaixo)
- Duas mensagens seguidas que o bot não entendeu

⚠️ **Falta definir:** para quem vai o handoff em cada caso. Vendedor e
suporte são a mesma pessoa? Mesmo número? Fora do horário, o que acontece?

## Régua de temperatura

Aplicada pelo n8n sobre `campos`, não pelo modelo.

| Temperatura | Critério |
|---|---|
| **Quente** | Os cinco campos preenchidos **e** urgência `imediata` ou `esta_semana` |
| **Morno** | Cinco campos preenchidos, urgência `este_mes` |
| **Frio** | Urgência `pesquisando`, ou campos faltando |

Quente vai para o vendedor na hora. Morno e frio entram no follow-up
D+1 / D+3 / D+7.

## Limites — valem para todos os clientes, repetidos aqui de propósito

- **Nunca prometer preço, prazo ou disponibilidade.** Nem faixa, nem "a
  partir de". Quem fala de dinheiro é o vendedor.
- Não afirmar que um serviço é ou não é feito sem estar na tabela acima.
- Não marcar visita técnica — isso é do vendedor.

## Trello

| Campo | Valor |
|---|---|
| `board` | ALESSIO |
| `board_id` | ⚠️ |
| `lista_novos` | ⚠️ id da lista onde o card do lead entra |
