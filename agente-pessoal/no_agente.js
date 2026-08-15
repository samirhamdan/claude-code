/**
 * Nó Agente — Laço de Tool Use
 *
 * Cole isto num nó Code do n8n, modo "Run Once for All Items".
 *
 * Entrada (do nó Carrega Config):
 *   numero  — telefone do WhatsApp, só dígitos
 *   texto   — mensagem do usuário (digitada ou transcrita)
 *   config  — linha da tabela `usuarios`
 *
 * Saída:
 *   resposta          — texto final para o WhatsApp
 *   ferramentas_usadas — o que foi chamado, para depuração
 *   voltas            — quantas idas ao modelo
 *
 * Requer no docker-compose do n8n:
 *   N8N_BLOCK_ENV_ACCESS_IN_NODE: "false"
 * e no .env:
 *   ANTHROPIC_API_KEY
 *   GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN
 *   (ou, só para teste rápido, GOOGLE_SHEETS_TOKEN)
 */

const entrada = $input.first().json;
const config = entrada.config;
const texto = entrada.texto;

// Turnos anteriores, vindos do Redis pelo nó Lê Histórico.
const historico = Array.isArray(entrada.historico) ? entrada.historico : [];

const ANTHROPIC_KEY = $env.ANTHROPIC_API_KEY;

const MODELO = 'claude-sonnet-5';
const MAX_VOLTAS = 5;

// Quanto o modelo pensa antes de responder. O padrão da API é 'high', que
// é lento demais para conversa de WhatsApp. Se ele começar a escolher a
// ferramenta errada, sobe para 'high'; se ainda estiver lento e as escolhas
// seguirem certas, desce para 'low'.
const EFFORT = 'medium';

// Quantas mensagens do histórico mandar de volta. Par, para não cortar
// um turno do usuário sem a resposta dele — a API exige alternância.
//
// Este é o botão que custa dinheiro, não o TTL do Redis: o histórico é
// reenviado ao modelo a cada mensagem. O TTL só decide por quanto tempo
// a chave sobrevive; este número decide o tamanho de cada chamada.
//
// 20 são 10 trocas: o onboarding gasta 5 nas perguntas iniciais e sobram
// 5 de folga. Se o agente começar a esquecer algo dito na mesma conversa,
// é este número que precisa subir.
const MAX_HISTORICO = 20;

// ------------------------------------------------------------------ rede
//
// O Code node do n8n roda no task runner, que não expõe `fetch` global.
// A porta de saída é `this.helpers.httpRequest`, que já devolve o corpo
// parseado e lança exceção em status fora de 2xx.

const ctx = this;

// URLSearchParams é Web API e pode não existir no sandbox, igual ao fetch.
function qs(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

async function http(opcoes) {
  try {
    return await ctx.helpers.httpRequest(opcoes);
  } catch (e) {
    const status = e.statusCode ?? e.httpCode ?? '?';
    let corpo = e.response?.body ?? e.error ?? e.message;
    if (typeof corpo === 'object') corpo = JSON.stringify(corpo);
    throw new Error(`${status} em ${opcoes.url} — ${String(corpo).slice(0, 300)}`);
  }
}

// ---------------------------------------------------------------- utilidades

// Campo Grande é UTC-4 o ano todo.
function agoraLocal() {
  return new Date(Date.now() - 4 * 60 * 60 * 1000);
}

function dataISO(d) {
  return d.toISOString().slice(0, 10);
}

function porExtenso(d) {
  const dias = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
                'quinta-feira', 'sexta-feira', 'sábado'];
  const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
                 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return `${dias[d.getUTCDay()]}, ${d.getUTCDate()} de ${meses[d.getUTCMonth()]}`;
}

const hoje = agoraLocal();

// ------------------------------------------------------------------- Trello

const TRELLO_AUTH = `key=${config.trello_key}&token=${config.trello_token}`;

async function trello(caminho, metodo = 'GET', params = {}) {
  const query = qs(params);
  const url = `https://api.trello.com/1${caminho}?${TRELLO_AUTH}${query ? '&' + query : ''}`;
  return http({ method: metodo, url, json: true });
}

// ------------------------------------------------------------ Google Sheets

// Um access_token do Google vale 1 hora. Se houver refresh_token no .env,
// trocamos por um token novo a cada execução; senão caímos no token fixo,
// que serve para testar mas vence sozinho.
let tokenSheets = null;

async function tokenGoogle() {
  if (tokenSheets) return tokenSheets;

  const refresh = $env.GOOGLE_REFRESH_TOKEN;
  if (!refresh) {
    tokenSheets = $env.GOOGLE_SHEETS_TOKEN;
    return tokenSheets;
  }

  const r = await http({
    method: 'POST',
    url: 'https://oauth2.googleapis.com/token',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: qs({
      client_id: $env.GOOGLE_CLIENT_ID,
      client_secret: $env.GOOGLE_CLIENT_SECRET,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
    json: true,
  });
  tokenSheets = (typeof r === 'string' ? JSON.parse(r) : r).access_token;
  return tokenSheets;
}

async function sheetsLer(aba, intervalo) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.planilha_id}`
            + `/values/${encodeURIComponent(aba + '!' + intervalo)}`;
  const dados = await http({
    method: 'GET',
    url,
    headers: { Authorization: `Bearer ${await tokenGoogle()}` },
    json: true,
  });
  return dados.values || [];
}

async function sheetsAcrescentar(aba, intervalo, linha) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.planilha_id}`
            + `/values/${encodeURIComponent(aba + '!' + intervalo)}`
            + `:append?valueInputOption=USER_ENTERED`;
  return http({
    method: 'POST',
    url,
    headers: {
      Authorization: `Bearer ${await tokenGoogle()}`,
      'Content-Type': 'application/json',
    },
    body: { values: [linha] },
    json: true,
  });
}

function paraNumero(v) {
  // A planilha pode devolver "45,90" ou "R$ 45,90".
  return Number(String(v ?? '').replace(/[^\d,.-]/g, '').replace(',', '.')) || 0;
}

// -------------------------------------------------------------- ferramentas

const ferramentas = [
  {
    name: 'criar_tarefa',
    description: 'Cria uma tarefa como card no Trello, na lista de entrada.',
    input_schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: 'Comece por verbo no infinitivo.' },
        descricao: { type: 'string' },
        prazo: { type: 'string', description: 'ISO 8601 em UTC. Some 4h ao horário local.' },
      },
      required: ['titulo'],
    },
  },
  {
    name: 'listar_tarefas',
    description: 'Lista tarefas abertas do Trello.',
    input_schema: {
      type: 'object',
      properties: {
        filtro: { type: 'string', enum: ['hoje', 'semana', 'atrasados', 'todos'] },
      },
      required: ['filtro'],
    },
  },
  {
    name: 'registrar_gasto',
    description: 'Grava um gasto na aba Gastos. Depois consulte o orçamento da categoria.',
    input_schema: {
      type: 'object',
      properties: {
        descricao: { type: 'string' },
        valor: { type: 'number' },
        categoria: { type: 'string' },
        data: { type: 'string', description: 'AAAA-MM-DD. Omita para hoje.' },
      },
      required: ['descricao', 'valor', 'categoria'],
    },
  },
  {
    name: 'consultar_gastos',
    description: 'Soma gastos de um período, opcionalmente filtrando por categoria.',
    input_schema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', enum: ['ontem', 'semana', 'mes'] },
        categoria: { type: 'string' },
      },
      required: ['periodo'],
    },
  },
  {
    name: 'registrar_conta',
    description: 'Grava uma conta a pagar ou receber na aba Contas.',
    input_schema: {
      type: 'object',
      properties: {
        descricao: { type: 'string' },
        valor: { type: 'number' },
        dia: { type: 'number', description: 'Dia do mês do vencimento, 1 a 31.' },
        categoria: { type: 'string' },
        tipo: { type: 'string', enum: ['fixa', 'parcelada'] },
        fluxo: { type: 'string', enum: ['pagar', 'receber'] },
      },
      required: ['descricao', 'valor', 'dia', 'categoria', 'tipo', 'fluxo'],
    },
  },
  {
    name: 'listar_contas',
    description: 'Lista contas pendentes. Uma conta é pendente quando não há gasto '
               + 'correspondente na categoria dela no mês corrente.',
    input_schema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', enum: ['proximos_dias', 'mes', 'atrasadas'] },
      },
      required: ['periodo'],
    },
  },
  {
    name: 'definir_orcamento',
    description: 'Define o limite mensal de uma categoria.',
    input_schema: {
      type: 'object',
      properties: {
        categoria: { type: 'string' },
        limite: { type: 'number' },
      },
      required: ['categoria', 'limite'],
    },
  },
  {
    name: 'consultar_orcamento',
    description: 'Compara o gasto do mês com o limite. Sem categoria, devolve todas.',
    input_schema: {
      type: 'object',
      properties: { categoria: { type: 'string' } },
    },
  },
];

// ------------------------------------------------------- execução das tools

async function executar(nome, args) {
  switch (nome) {

    case 'criar_tarefa': {
      const card = await trello('/cards', 'POST', {
        idList: config.trello_list_id,
        name: args.titulo,
        ...(args.descricao ? { desc: args.descricao } : {}),
        ...(args.prazo ? { due: args.prazo } : {}),
      });
      return `Card criado: "${card.name}" (${card.shortUrl})`;
    }

    case 'listar_tarefas': {
      const cards = await trello(`/boards/${config.trello_board_id}/cards`, 'GET', {
        fields: 'name,due,dueComplete,shortUrl',
      });
      const limite = new Date(hoje);
      if (args.filtro === 'hoje') limite.setUTCHours(23, 59, 59);
      if (args.filtro === 'semana') limite.setUTCDate(limite.getUTCDate() + 7);

      const filtrados = cards.filter((c) => {
        if (c.dueComplete) return false;
        if (args.filtro === 'todos') return true;
        if (!c.due) return false;
        const due = new Date(c.due);
        if (args.filtro === 'atrasados') return due < hoje;
        return due <= limite;
      });

      if (!filtrados.length) return 'Nenhuma tarefa nesse filtro.';
      return filtrados
        .map((c) => `- ${c.name}${c.due ? ` (vence ${c.due.slice(0, 10)})` : ''}`)
        .join('\n');
    }

    case 'registrar_gasto': {
      const data = args.data || dataISO(hoje);
      await sheetsAcrescentar('Gastos', 'A:D',
        [data, args.descricao, args.valor, args.categoria]);
      return `Gasto gravado: ${args.descricao}, R$ ${args.valor}, ${args.categoria}, ${data}.`;
    }

    case 'consultar_gastos': {
      const linhas = (await sheetsLer('Gastos', 'A2:D')).filter((l) => l.length);
      const inicio = new Date(hoje);
      if (args.periodo === 'ontem') inicio.setUTCDate(inicio.getUTCDate() - 1);
      if (args.periodo === 'semana') inicio.setUTCDate(inicio.getUTCDate() - 7);
      if (args.periodo === 'mes') inicio.setUTCDate(1);
      const corte = dataISO(inicio);
      const limite = args.periodo === 'ontem' ? corte : dataISO(hoje);

      const selecao = linhas.filter(([data, , , cat]) => {
        if (!data || data < corte || data > limite) return false;
        return !args.categoria
          || String(cat).toLowerCase() === args.categoria.toLowerCase();
      });

      if (!selecao.length) return 'Nenhum gasto no período.';
      const total = selecao.reduce((s, l) => s + paraNumero(l[2]), 0);
      const porCategoria = {};
      for (const l of selecao) {
        porCategoria[l[3] || 'sem categoria'] =
          (porCategoria[l[3] || 'sem categoria'] || 0) + paraNumero(l[2]);
      }
      const detalhe = Object.entries(porCategoria)
        .map(([c, v]) => `${c}: R$ ${v.toFixed(2)}`).join('; ');
      return `Total R$ ${total.toFixed(2)} em ${selecao.length} lançamentos. ${detalhe}`;
    }

    case 'registrar_conta': {
      await sheetsAcrescentar('Contas', 'A:F', [
        args.descricao, args.valor, args.dia, args.categoria, args.tipo, args.fluxo,
      ]);
      return `Conta gravada: ${args.descricao}, R$ ${args.valor}, `
           + `vence dia ${args.dia}, ${args.fluxo}.`;
    }

    case 'listar_contas': {
      const contas = (await sheetsLer('Contas', 'A2:F')).filter((l) => l.length);
      if (!contas.length) return 'Nenhuma conta cadastrada.';

      // Gastos do mês corrente, para saber o que já foi pago.
      const inicioMes = dataISO(new Date(Date.UTC(
        hoje.getUTCFullYear(), hoje.getUTCMonth(), 1)));
      const gastos = (await sheetsLer('Gastos', 'A2:D'))
        .filter((l) => l.length && l[0] >= inicioMes)
        .map((l) => String(l[3] || '').toLowerCase());

      const diaHoje = hoje.getUTCDate();
      const pendentes = contas.filter(([, , dia, cat]) => {
        if (gastos.includes(String(cat).toLowerCase())) return false;
        const d = Number(dia);
        if (args.periodo === 'atrasadas') return d < diaHoje;
        if (args.periodo === 'proximos_dias') return d >= diaHoje && d <= diaHoje + 7;
        return true;
      });

      if (!pendentes.length) return 'Nenhuma conta pendente nesse período.';
      const formata = (fluxo) => pendentes
        .filter((c) => c[5] === fluxo)
        .map((c) => `- ${c[0]}: R$ ${paraNumero(c[1]).toFixed(2)} (dia ${c[2]})`)
        .join('\n') || '- nenhuma';
      return `A pagar:\n${formata('pagar')}\n\nA receber:\n${formata('receber')}`;
    }

    case 'definir_orcamento': {
      await sheetsAcrescentar('Orçamento', 'A:B', [args.categoria, args.limite]);
      return `Limite de R$ ${args.limite} definido para ${args.categoria}.`;
    }

    case 'consultar_orcamento': {
      const limites = (await sheetsLer('Orçamento', 'A2:B')).filter((l) => l.length);
      if (!limites.length) return 'Nenhum limite de orçamento definido ainda.';

      const inicioMes = dataISO(new Date(Date.UTC(
        hoje.getUTCFullYear(), hoje.getUTCMonth(), 1)));
      const gastos = (await sheetsLer('Gastos', 'A2:D'))
        .filter((l) => l.length && l[0] >= inicioMes);

      const alvo = args.categoria
        ? limites.filter(([c]) => String(c).toLowerCase() === args.categoria.toLowerCase())
        : limites;

      if (!alvo.length) {
        return `A categoria "${args.categoria}" não tem limite definido.`;
      }

      return alvo.map(([cat, lim]) => {
        const limite = paraNumero(lim);
        const gasto = gastos
          .filter((g) => String(g[3]).toLowerCase() === String(cat).toLowerCase())
          .reduce((s, g) => s + paraNumero(g[2]), 0);
        const pct = limite ? Math.round((gasto / limite) * 100) : 0;
        return `${cat}: R$ ${gasto.toFixed(2)} de R$ ${limite.toFixed(2)} (${pct}%)`;
      }).join('\n');
    }

    default:
      return `Ferramenta desconhecida: ${nome}`;
  }
}

// ------------------------------------------------------------ system prompt

const systemPrompt = `Você se chama ${config.nome_assistente || 'Assistente'}.
Fale de forma ${config.tom || 'informal'}.
Responda em ${config.idioma || 'pt-BR'}.

Você é o assistente pessoal de ${config.nome} pelo WhatsApp.

Hoje é ${porExtenso(hoje)} (${dataISO(hoje)}), fuso de Campo Grande, UTC-4.

## Regras
- Mensagens curtas, 2 a 6 linhas. Formatação: *negrito*, _itálico_.
- Use ferramentas quando precisar de dado real. Nunca invente.
- Pode chamar mais de uma ferramenta antes de responder.
- Após registrar gasto, consulte o orçamento da categoria.
- Se o orçamento passou de 80%, alerte. Se passou de 100%, alerte com mais urgência.
- Quando registrar gasto em categoria sem limite, pergunte se quer definir um.
- Responda direto, sem preâmbulo.

## Sobre tarefas
- Títulos começando por verbo no infinitivo.
- Prazos em UTC: some 4h ao horário local que o usuário disser.
- "O que tenho pra hoje" é listar_tarefas com filtro hoje.

## Sobre contas
- "Contas para vencer" mostra a pagar e a receber separados.
- Conta sem gasto correspondente no mês é pendente.

## Áudio
- Se a mensagem veio de transcrição, interprete pelo contexto.
- Responda sempre em texto.

## Limites
- Não envia e-mail, não apaga nada, não fala com terceiros.
- Não dá recomendação de investimento.`;

// -------------------------------------------------------------------- laço

async function chamarClaude(mensagens) {
  return http({
    method: 'POST',
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: {
      model: MODELO,
      max_tokens: 1024,
      system: systemPrompt,
      tools: ferramentas,
      messages: mensagens,
      // Sem isto o modelo roda em effort `high`, que é o padrão, e pensa
      // fundo até para decidir que "almoço 45 reais" é um registrar_gasto.
      // Num laço de três chamadas isso vira dezenas de segundos no WhatsApp.
      output_config: { effort: EFFORT },
    },
    json: true,
  });
}

const mensagens = [...historico, { role: 'user', content: texto }];
const usadas = [];
let resposta = 'Não consegui concluir, tenta de novo?';
let voltas = 0;

while (voltas < MAX_VOLTAS) {
  voltas++;
  const r = await chamarClaude(mensagens);

  if (r.stop_reason !== 'tool_use') {
    const bloco = r.content.find((b) => b.type === 'text');
    if (bloco) resposta = bloco.text;
    break;
  }

  // Registra o turno do modelo antes de devolver os resultados.
  mensagens.push({ role: 'assistant', content: r.content });

  const resultados = [];
  for (const bloco of r.content) {
    if (bloco.type !== 'tool_use') continue;
    let saida;
    let erro = false;
    try {
      saida = await executar(bloco.name, bloco.input);
    } catch (e) {
      saida = `Erro ao executar ${bloco.name}: ${e.message}`;
      erro = true;
    }
    usadas.push({ ferramenta: bloco.name, entrada: bloco.input, saida, volta: voltas });
    resultados.push({
      type: 'tool_result',
      tool_use_id: bloco.id,
      content: saida,
      ...(erro ? { is_error: true } : {}),
    });
  }

  mensagens.push({ role: 'user', content: resultados });
}

// O histórico guarda só o texto de cada turno, não os blocos de tool_use
// e tool_result. Eles incham a chave depressa e, se um tool_use for cortado
// pelo limite sem o tool_result correspondente, a API rejeita a conversa.
const historicoNovo = [
  ...historico,
  { role: 'user', content: texto },
  { role: 'assistant', content: resposta },
].slice(-MAX_HISTORICO);

return [{
  json: {
    resposta,
    ferramentas_usadas: usadas,
    voltas,
    historico: JSON.stringify(historicoNovo),
  },
}];
