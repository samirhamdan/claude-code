/**
 * Nó "Qualifica" — uma chamada ao modelo por turno, JSON estrito na volta.
 *
 * Diferente do agente pessoal: aqui **não há laço de tool use**. O SDR não
 * executa nada, ele conversa e preenche campos. Uma chamada, uma resposta —
 * é o que o CLAUDE.md manda, e é o que segura o custo e a latência.
 *
 * Nó Code, modo "Run Once for All Items".
 *
 * Canvas:
 *
 *   Webhook → Filtra Mensagem → [debounce: ver no-debounce.js] → IF continuar
 *        ↓
 *   Lê Estado (Redis GET estado:{telefone})
 *        ↓
 *   Qualifica (Code, este arquivo)
 *        ↓
 *   IF enviar → Envia (HTTP, Evolution sendText)
 *        ↓
 *   Grava Estado (Redis SET estado:{telefone}, TTL 30 dias)
 *
 * Entrada esperada no item:
 *   telefone    — só dígitos
 *   texto       — mensagens da rajada já juntadas pelo debounce
 *   estado_raw  — JSON do Redis, ou vazio na primeira mensagem
 *
 * Saída:
 *   enviar, resposta, campos, intencao, handoff, motivo_handoff,
 *   completo, temperatura, estado (JSON para o Redis)
 *
 * Requer no container: ANTHROPIC_API_KEY
 */

// ═══════════════════════════════════════════════════════ config do cliente
//
// Espelha prompts/clientes/alessio.md. Está inline porque o Code node não
// alcança o Postgres — quando existir a tabela `clientes`, isto vira um nó
// Postgres antes deste, no mesmo padrão que o `Carrega Config` do v2, e o
// objeto sai daqui inteiro. Foi escrito como um objeto só por causa disso.

const CLIENTE = {
  empresa: 'Alessio Segurança e Climatização',
  atendente: 'Samir',
  cidade: 'Campo Grande / MS',

  servicos: {
    1: { rotulo: 'Câmeras de Segurança', valor: 'camera' },
    2: { rotulo: 'Ar Condicionado', valor: 'ar_condicionado' },
    3: { rotulo: 'Cerca Elétrica', valor: 'cerca_eletrica' },
    4: { rotulo: 'Alarmes', valor: 'alarme' },
    5: { rotulo: 'Interfones e Portões', valor: 'interfone_portao' },
    6: { rotulo: 'Falar com vendedor', valor: null, intencao: 'vendedor' },
    7: { rotulo: 'Falar com suporte', valor: null, intencao: 'suporte' },
  },

  // Frase pré-preenchida pelo Click-to-WhatsApp. O casamento é por trecho
  // distintivo, sem acento e sem caixa: a pessoa edita o texto antes de
  // enviar, e o começo é o que ela mais mexe. Mais específico primeiro —
  // se um dia houver campanha de portão sem wifi, a ordem decide.
  campanhas: [
    { trecho: 'motor de portao', servico: 'interfone_portao' },
  ],

  boasVindas: `Olá! Seja bem vindo a ${'Alessio Segurança e Climatização'}!

Meu nome é Samir e estou aqui para ajudar com nossas soluções.

Escolha uma opção:

1️⃣ Câmeras de Segurança
2️⃣ Ar Condicionado
3️⃣ Cerca Elétrica
4️⃣ Alarmes
5️⃣ Interfones e Portões
6️⃣ Falar com vendedor
7️⃣ Falar com suporte

Responda com o número desejado!`,

  gatilhosHandoff: [
    'A pessoa pediu para falar com alguém, de qualquer jeito que tenha pedido.',
    'É chamado de suporte — já é cliente, com algo instalado.',
    'Insistiu em preço, prazo ou disponibilidade depois de você já ter recusado uma vez.',
    'Reclamação, cobrança ou irritação.',
    'Duas mensagens seguidas que você não entendeu.',
  ],
};

const MODELO = 'claude-sonnet-4-6'; // o CLAUDE.md fixa este para qualificação
const MAX_HISTORICO = 20;           // 10 trocas; o histórico é reenviado por turno

// A lição do agente pessoal: sem timeout o helper espera para sempre, a
// execução pendura e segura um slot de concorrência até alguém reiniciar.
const TIMEOUT_MODELO_MS = 60000;

// ═══════════════════════════════════════════════════════════════════ rede

const ctx = this;

async function http(opcoes) {
  try {
    return await ctx.helpers.httpRequest({ timeout: TIMEOUT_MODELO_MS, ...opcoes });
  } catch (e) {
    const expirou = e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT'
      || /timeout/i.test(String(e.message));
    if (expirou) throw new Error(`tempo esgotado em ${opcoes.url}`);
    const status = e.statusCode ?? e.httpCode ?? '?';
    let corpo = e.response?.body ?? e.error ?? e.message;
    if (typeof corpo === 'object') corpo = JSON.stringify(corpo);
    throw new Error(`${status} em ${opcoes.url} — ${String(corpo).slice(0, 300)}`);
  }
}

// ══════════════════════════════════════════════════════════════ entrada

const entrada = $input.first().json;

// O `Lê Estado` logo antes é um nó Redis, e nó Redis devolve SÓ a
// propriedade que setou: o que chega no `$input` é `{ estado_raw }`, sem
// telefone e sem texto. Eles vêm do Confere Debounce, pelo nome do nó.
//
// Este erro já apareceu três vezes neste projeto — no Monta Entrada do
// agente pessoal, no Confere Debounce, e aqui. Toda vez que um nó Redis
// estiver entre a origem de um dado e quem o consome, busque pelo nome.
function doDebounce(campo) {
  try {
    return $('Confere Debounce').first().json[campo];
  } catch (e) {
    return undefined; // permite rodar o nó isolado no editor
  }
}

const telefone = String(entrada.telefone ?? doDebounce('telefone') ?? '').trim();
const texto = String(entrada.texto ?? doDebounce('texto') ?? '').trim();

if (!telefone) {
  throw new Error(
    'Sem telefone na entrada. Confira se o nó anterior se chama exatamente '
    + '"Confere Debounce" — este nó busca telefone e texto por esse nome, '
    + 'porque o Lê Estado descarta tudo menos o estado_raw.'
  );
}

const ESTADO_VAZIO = {
  campos: {
    nome: null, servico: null, tipo_imovel: null,
    regiao: null, urgencia: null, porte: null,
  },
  intencao: 'indefinido',
  historico: [],
  handoff: false,
  origem: null,
  saudou: false,
};

let estado = ESTADO_VAZIO;
try {
  if (entrada.estado_raw) {
    const v = JSON.parse(entrada.estado_raw);
    if (v && typeof v === 'object') {
      estado = {
        ...ESTADO_VAZIO,
        ...v,
        campos: { ...ESTADO_VAZIO.campos, ...(v.campos || {}) },
        historico: Array.isArray(v.historico) ? v.historico : [],
      };
    }
  }
} catch (e) {
  estado = ESTADO_VAZIO; // estado corrompido não pode derrubar o atendimento
}

// ── conversa já entregue a humano ────────────────────────────────────────
// Depois do handoff o bot cala. Sem isto ele volta a falar por cima do
// vendedor no meio da negociação, que é o pior defeito possível aqui.
if (estado.handoff) {
  return [{
    json: {
      enviar: false,
      motivo: 'conversa já está com humano',
      telefone,
      estado: JSON.stringify(estado),
    },
  }];
}

// ══════════════════════════════════════════════════════════ classificação

// Sem acento e sem caixa, para o casamento das campanhas e do menu.
function normaliza(s) {
  return String(s)
    .normalize('NFD')
    // Escape explícito de propósito: os combinantes literais são invisíveis
    // no código e este arquivo é colado num textarea do navegador.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const textoNorm = normaliza(texto);

// Primeira mensagem: de onde essa pessoa veio?
if (!estado.origem) {
  const campanha = CLIENTE.campanhas.find((c) => textoNorm.includes(normaliza(c.trecho)));
  if (campanha) {
    estado.origem = 'anuncio';
    // Ela já disse o que quer ao clicar no anúncio. Perguntar de novo com um
    // menu de sete opções é ignorar o que ela acabou de fazer.
    estado.campos.servico = estado.campos.servico ?? campanha.servico;
    estado.intencao = 'qualificar';
  } else {
    estado.origem = 'desconhecida';
  }
}

// Resposta ao menu: um número sozinho, na conversa que acabou de ser saudada.
const soNumero = /^[1-7]$/.test(textoNorm) ? Number(textoNorm) : null;
if (soNumero) {
  const opcao = CLIENTE.servicos[soNumero];
  if (opcao.intencao) {
    estado.intencao = opcao.intencao;
  } else {
    estado.intencao = 'qualificar';
    estado.campos.servico = estado.campos.servico ?? opcao.valor;
  }
}

// ── boas-vindas: determinístico, não vale gastar chamada de modelo ───────
// Primeira mensagem de origem desconhecida recebe o menu e pronto. Deixar o
// modelo redigir isso todo dia é pagar para ele reescrever um texto que já
// está aprovado — e correr o risco de ele reescrever diferente.
if (!estado.saudou && estado.origem === 'desconhecida' && !soNumero) {
  estado.saudou = true;
  estado.historico = [
    { role: 'user', content: texto },
    { role: 'assistant', content: CLIENTE.boasVindas },
  ];
  return [{
    json: {
      enviar: true,
      resposta: CLIENTE.boasVindas,
      telefone,
      campos: estado.campos,
      intencao: estado.intencao,
      handoff: false,
      completo: false,
      temperatura: 'frio',
      estado: JSON.stringify(estado),
    },
  }];
}
estado.saudou = true;

// ═════════════════════════════════════════════════════════ system prompt

const catalogo = Object.entries(CLIENTE.servicos)
  .filter(([, s]) => s.valor)
  .map(([n, s]) => `${n}. ${s.rotulo} (${s.valor})`)
  .join('\n');

const systemPrompt = `Você é ${CLIENTE.atendente}, do primeiro atendimento da ${CLIENTE.empresa}, em ${CLIENTE.cidade}, pelo WhatsApp.

Seu trabalho é entender o que a pessoa precisa e reunir cinco informações.
Você NÃO vende, NÃO orça e NÃO agenda — quem faz isso é o vendedor. Você
descobre o suficiente para ele entrar na conversa já sabendo com quem fala.

## Serviços deste cliente
${catalogo}

## As cinco informações
1. nome — primeiro nome basta
2. servico — o que a pessoa procura
3. tipo_imovel — residencia, comercio, industria, condominio ou rural
4. regiao — bairro ou cidade
5. urgencia — imediata, esta_semana, este_mes ou pesquisando

E um sexto campo, porte, que NÃO tem pergunta própria: deduza do que a pessoa
contar se é um ponto só (ponto_unico), um ambiente, ou um sistema_completo.
Se não der para deduzir, deixe null. Ninguém responde "qual o porte do meu
projeto".

## Como conversar
- Uma pergunta por mensagem. Duas juntas fazem a pessoa responder uma só.
- 2 a 5 linhas. Português falado, não formulário.
- NUNCA pergunte o que já sabe — o que já foi coletado vem abaixo.
- Se ela der duas informações de uma vez, registre as duas e pule adiante.
- Se ela perguntar algo, responda antes de continuar perguntando.
- Se ela não quiser responder, deixe null e siga. Não insista duas vezes.
- Pergunte primeiro o que muda o resto: serviço, tipo de imóvel, urgência,
  região. O nome, cedo, quando encaixar.

## O que você não faz, sem exceção
- Não fala de preço, prazo ou disponibilidade. Nem faixa, nem estimativa,
  nem "a partir de". Quem passa valor é o vendedor.
- NÃO diz se a região é atendida ou não — nem que sim, nem que não. Não há
  faixa fixa de atendimento: depende da região junto com o tamanho do
  projeto, e quem decide é o vendedor. Anote a região, entenda o tamanho, e
  siga. Se perguntarem direto, diga que quem confirma isso é o vendedor.
- Não marca visita nem agenda horário.
- Não promete retorno em tempo determinado. O atendimento é 24 horas, mas o
  humano não — nunca diga quando alguém vai responder.

Insistência depois de uma recusa é motivo de handoff, não motivo de ceder.

## Quando chamar um humano (handoff: true)
${CLIENTE.gatilhosHandoff.map((g) => `- ${g}`).join('\n')}

No handoff a resposta avisa em uma linha que alguém vai assumir, sem dizer
quando.

## Intenção
- qualificar — quer contratar algo
- vendedor — pediu vendedor direto
- suporte — já é cliente, é sobre algo instalado
- indefinido — ainda não dá para saber

Cliente com problema NÃO é lead. Quem escreve sobre equipamento que já tem vai
para suporte, e aí você não pergunta região nem urgência — soa como se você
não tivesse lido o que ele disse. O contrário também vale: quem digitou 7 mas
descreve instalação nova é qualificar.

## O que você já sabe desta conversa
Origem do contato: ${estado.origem}
${Object.entries(estado.campos)
  .map(([k, v]) => `- ${k}: ${v === null ? '(falta)' : v}`)
  .join('\n')}

Use a ferramenta responder para devolver sua resposta. Não escreva texto fora
dela.`;

// ══════════════════════════════════════════════════════════════ ferramenta
//
// Forçar tool use é o que garante JSON válido. Pedir "responda só JSON" no
// prompt funciona quase sempre, e "quase sempre" aqui significa uma conversa
// perdida por semana.
//
// Este schema é o dialeto da API do de prompts/schema-saida.json — que
// continua sendo o contrato. A diferença: a API ignora `if/then`, então a
// regra "handoff exige motivo" é conferida em código, mais abaixo.

const FERRAMENTA = {
  name: 'responder',
  description: 'Devolve a resposta ao lead e o estado atualizado da qualificação.',
  input_schema: {
    type: 'object',
    required: ['resposta', 'intencao', 'campos', 'handoff', 'completo'],
    properties: {
      resposta: {
        type: 'string',
        description: 'Texto que vai para o WhatsApp. 2 a 5 linhas.',
      },
      intencao: {
        type: 'string',
        enum: ['qualificar', 'vendedor', 'suporte', 'indefinido'],
      },
      campos: {
        type: 'object',
        required: ['nome', 'servico', 'tipo_imovel', 'regiao', 'urgencia', 'porte'],
        description: 'Sempre inteiro, com null no que falta. Nunca omita uma '
                   + 'chave e nunca apague algo já coletado.',
        properties: {
          nome: { type: ['string', 'null'] },
          servico: {
            type: ['string', 'null'],
            enum: ['camera', 'ar_condicionado', 'cerca_eletrica', 'alarme',
                   'interfone_portao', 'outro', null],
          },
          tipo_imovel: {
            type: ['string', 'null'],
            enum: ['residencia', 'comercio', 'industria', 'condominio', 'rural', null],
          },
          regiao: { type: ['string', 'null'] },
          urgencia: {
            type: ['string', 'null'],
            enum: ['imediata', 'esta_semana', 'este_mes', 'pesquisando', null],
          },
          porte: {
            type: ['string', 'null'],
            enum: ['ponto_unico', 'ambiente', 'sistema_completo', null],
          },
        },
      },
      completo: {
        type: 'boolean',
        description: 'true quando os CINCO primeiros campos estão preenchidos. '
                   + 'porte não entra na conta.',
      },
      handoff: { type: 'boolean' },
      motivo_handoff: {
        type: ['string', 'null'],
        description: 'Obrigatório quando handoff é true. Frase curta para o '
                   + 'vendedor ler antes de entrar.',
      },
      observacao: { type: ['string', 'null'] },
    },
  },
};

// ══════════════════════════════════════════════════════════════════ chamada

const mensagens = [
  ...estado.historico.slice(-MAX_HISTORICO),
  { role: 'user', content: texto },
];

const r = await http({
  method: 'POST',
  url: 'https://api.anthropic.com/v1/messages',
  headers: {
    'x-api-key': $env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  },
  body: {
    model: MODELO,
    max_tokens: 1024,
    system: systemPrompt,
    messages: mensagens,
    tools: [FERRAMENTA],
    // Sem isto o modelo às vezes responde em texto e o parse quebra.
    tool_choice: { type: 'tool', name: 'responder' },
  },
  json: true,
});

const bloco = (r.content || []).find((b) => b.type === 'tool_use' && b.name === 'responder');
if (!bloco) {
  throw new Error(
    `Modelo não usou a ferramenta. stop_reason=${r.stop_reason}. `
    + `Conteúdo: ${JSON.stringify(r.content).slice(0, 300)}`
  );
}

const saida = bloco.input || {};

// ════════════════════════════════════════════════════════════════ validação

// A regra que o schema expressa com if/then e a API não aplica.
if (saida.handoff && !String(saida.motivo_handoff || '').trim()) {
  saida.motivo_handoff = 'Handoff pedido pelo agente, sem motivo declarado.';
}

// Campo já coletado não pode voltar a null: se o modelo esquecer de repetir
// algo, o valor antigo prevalece. Perder um campo é pior que teimar nele.
const campos = { ...estado.campos };
for (const [k, v] of Object.entries(saida.campos || {})) {
  if (v !== null && v !== undefined && v !== '') campos[k] = v;
}

// ═══════════════════════════════════════════════════════ régua de temperatura
//
// Feita aqui, não pelo modelo. É regra de negócio: muda com o vendedor, e
// mudar prompt para ajustar régua é como se perde o controle do que o bot faz.

const CINCO = ['nome', 'servico', 'tipo_imovel', 'regiao', 'urgencia'];
const completo = CINCO.every((k) => campos[k] !== null && campos[k] !== undefined);

let temperatura = 'frio';
if (completo && ['imediata', 'esta_semana'].includes(campos.urgencia)) {
  temperatura = 'quente';
} else if (completo && campos.urgencia === 'este_mes') {
  temperatura = 'morno';
}

// Lead quente também é handoff: sentido de existir do fluxo é entregar isso
// ao vendedor enquanto ainda está quente.
const handoff = Boolean(saida.handoff) || temperatura === 'quente';
const motivoHandoff = saida.motivo_handoff
  || (temperatura === 'quente' ? 'Lead quente: cinco campos preenchidos e urgência alta.' : null);

const resposta = String(saida.resposta || '').trim();

// ══════════════════════════════════════════════════════════════════ saída

const estadoNovo = {
  ...estado,
  campos,
  intencao: saida.intencao || estado.intencao,
  handoff,
  historico: [
    ...estado.historico,
    { role: 'user', content: texto },
    { role: 'assistant', content: resposta },
  ].slice(-MAX_HISTORICO),
};

return [{
  json: {
    enviar: resposta.length > 0,
    resposta,
    telefone,
    campos,
    intencao: estadoNovo.intencao,
    completo,
    temperatura,
    handoff,
    motivo_handoff: motivoHandoff,
    observacao: saida.observacao || null,
    estado: JSON.stringify(estadoNovo),
  },
}];
