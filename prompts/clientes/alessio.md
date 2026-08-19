# Cliente: Alessio Segurança e Climatização

Config do cliente. O `system-qualificacao.md` é genérico e lê tudo daqui —
nada da Alessio deve aparecer no prompt de qualificação.

**Marcado com ⚠️ o que ainda falta.** Só sobrou o Trello, que é a etapa 5 do
roadmap — não bloqueia a qualificação.

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
| `horario` | Qualquer horário — o bot atende 24/7 |
| `regiao_atendimento` | **Não existe faixa fixa.** Viabilidade = região × porte |

### A regra da região, que é diferente do óbvio

Não há lista de cidades atendidas. Obra pequena longe não fecha a conta;
sistema completo para residência, empresa ou fazenda fecha, mesmo longe.
Quem decide é o vendedor, caso a caso.

Consequência para o bot, e ela é rígida nas duas direções:

- **Nunca diga que não atende** determinada região. A decisão não é dele e
  ele perde um lead que fecharia.
- **Nunca diga que atende** também. Isso é promessa de disponibilidade, que
  está entre os limites duros.
- Colete `regiao` e `porte` e siga. Neutro.

É por causa dessa regra que existe o campo `porte`: sem ele o vendedor
recebe a região sozinha e não consegue decidir nada.

### Sobre atender 24/7

O bot responde de madrugada, mas o humano não. Ele já é proibido de prometer
prazo de retorno — e no handoff de madrugada isso importa mais, não menos.
Avisa que alguém vai assumir, sem dizer quando.

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
| `anuncio` | Frase-chave pré-preenchida no Click-to-WhatsApp (tabela abaixo) | Pula o menu. Confirma o serviço do anúncio e já começa a qualificar. |
| `cliente` | Telefone já existe na base | Não oferece menu de venda — pergunta se é sobre um serviço já instalado |
| `desconhecida` | Qualquer outro caso | Menu completo acima |

### Frases-chave das campanhas

A Meta deixa definir o texto que já vem digitado quando a pessoa clica no
anúncio. Uma frase por campanha, e o casamento é por **trecho distintivo**,
sem acento e sem diferenciar maiúscula — a pessoa pode editar o texto antes
de enviar, e o começo é o que ela mais mexe.

| Campanha | Texto sugerido para o anúncio | Trecho que casa | `servico` |
|---|---|---|---|
| Motor de portão com Wi-Fi | `Olá! Vim pelo anúncio do motor de portão com Wi-Fi.` | `motor de portao` | `interfone_portao` |

Ao criar campanha nova, acrescente uma linha aqui **antes** de subir o
anúncio. Frase que não está na tabela cai em `desconhecida` e a pessoa recebe
o menu — funciona, mas desperdiça o que ela já disse ao clicar.

Escolha trechos que não colidam entre si: se um dia houver campanha de
portão eletrônico *sem* wifi, `motor de portao` casa com as duas e a mais
específica precisa vir antes na tabela.

## Handoff — quando o bot para e chama humano

Sempre:

- Pediu explicitamente falar com pessoa (opção 6, ou "quero falar com alguém")
- Opção 7 (suporte): é cliente com problema, não lead
- Insistiu em preço, prazo ou disponibilidade depois de uma recusa
- Reclamação, cobrança ou tom de irritação
- Lead quente completo (ver régua abaixo)
- Duas mensagens seguidas que o bot não entendeu

**Destino:** uma pessoa só — vendas e suporte são a mesma. Não há roteamento
a fazer.

Mesmo assim `intencao` continua importando, por dois motivos: muda o que o
bot faz **antes** de passar (não se qualifica quem já é cliente com um
equipamento quebrado), e muda o que vira card no Trello — chamado de suporte
não é lead e não entra no funil de venda.

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
- **Não dizer se atende ou não atende uma região** — ver a regra acima.
- Não marcar visita técnica — isso é do vendedor.

## Trello

| Campo | Valor |
|---|---|
| `board` | ALESSIO |
| `board_id` | ⚠️ |
| `lista_novos` | ⚠️ id da lista onde o card do lead entra |
