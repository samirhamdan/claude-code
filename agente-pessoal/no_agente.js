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

// Fatos duradouros sobre o usuário, do nó Lê Fatos. Diferente do histórico:
// não expira por idade, entra inteiro no system prompt, e é o modelo que
// decide o que merece virar fato.
const fatos = Array.isArray(entrada.fatos) ? entrada.fatos.slice() : [];

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

// Teto de fatos guardados. Todos vão no system prompt em toda chamada, então
// o custo é linear e permanente — a ~15 tokens por fato, 50 dá uns 750 tokens.
const MAX_FATOS = 50;

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

// `helpers.httpRequest` não tem timeout por padrão — espera para sempre — e o
// n8n vem com EXECUTIONS_TIMEOUT desligado. Uma chamada pendurada prende a
// execução inteira, e com ela um slot de concorrência, até alguém reiniciar o
// n8n. É assim que uma resposta de segundos vira "demorou horas".
const TIMEOUT_MS = 20000;         // Google, Trello: round trip curto
const TIMEOUT_MODELO_MS = 120000; // Anthropic: pensa, e web_search roda lá

async function http(opcoes) {
  try {
    // Espalhado depois do padrão para o chamador poder subir o teto.
    return await ctx.helpers.httpRequest({ timeout: TIMEOUT_MS, ...opcoes });
  } catch (e) {
    const expirou = e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT'
      || /timeout/i.test(String(e.message));
    if (expirou) {
      // Numa ferramenta isto vira tool_result com is_error, e o modelo
      // consegue dizer que não falou com o serviço em vez de sumir.
      throw new Error(`tempo esgotado em ${opcoes.url}`);
    }
    const status = e.statusCode ?? e.httpCode ?? '?';
    let corpo = e.response?.body ?? e.error ?? e.message;
    if (typeof corpo === 'object') corpo = JSON.stringify(corpo);
    throw new Error(`${status} em ${opcoes.url} — ${String(corpo).slice(0, 300)}`);
  }
}

// ---------------------------------------------------------- Google Calendar

const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

async function calendario(opcoes) {
  return http({
    ...opcoes,
    headers: {
      Authorization: `Bearer ${await tokenGoogle()}`,
      ...(opcoes.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opcoes.headers || {}),
    },
  });
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

const TZ = 'America/Campo_Grande';

// O modelo sempre passa horário local. A conversão de fuso acontece aqui,
// não na cabeça dele — pedir aritmética de fuso ao modelo é fonte de erro
// silencioso, e um compromisso quatro horas fora do lugar não parece bug.
function dataHoraLocal(s) {
  const t = String(s).trim().replace(' ', 'T');
  return /\d{2}:\d{2}:\d{2}$/.test(t) ? t : `${t}:00`;
}

function paraUTC(local) {
  const m = String(local).trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const [, ano, mes, dia, hora, min] = m;
  return new Date(Date.UTC(+ano, +mes - 1, +dia, +hora + 4, +min)).toISOString();
}

// Instante UTC correspondente a uma hora local de Campo Grande.
function instanteUTC(ano, mes, dia, hora = 0, min = 0) {
  return new Date(Date.UTC(ano, mes, dia, hora + 4, min)).toISOString();
}

// Aritmética de calendário sobre a hora local, sem passar por UTC: trata os
// componentes como se fossem UTC só para somar, e devolve no mesmo formato.
function somaHoraLocal(local, horas) {
  const m = String(local).trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const [, ano, mes, dia, hora, min] = m;
  return new Date(Date.UTC(+ano, +mes - 1, +dia, +hora + horas, +min))
    .toISOString().slice(0, 16);
}

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
        prazo: {
          type: 'string',
          description: 'AAAA-MM-DDTHH:MM em horário local de Campo Grande. '
                     + 'Não converta fuso.',
        },
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
    name: 'concluir_tarefa',
    description: 'Marca uma tarefa como concluída, sem apagar o card. Use '
               + 'quando o usuário disser que terminou algo. O id vem de '
               + 'listar_tarefas — chame listar_tarefas antes se não tiver '
               + 'o id em mãos.',
    input_schema: {
      type: 'object',
      properties: { tarefa_id: { type: 'string' } },
      required: ['tarefa_id'],
    },
  },
  {
    name: 'arquivar_tarefa',
    description: 'Remove uma tarefa do quadro sem marcar como concluída — use '
               + 'quando foi cancelada ou não vai mais ser feita. O id vem de '
               + 'listar_tarefas.',
    input_schema: {
      type: 'object',
      properties: { tarefa_id: { type: 'string' } },
      required: ['tarefa_id'],
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

  {
    name: 'lembrar_fato',
    description: 'Guarda um fato duradouro sobre o usuário, para lembrar em '
               + 'conversas futuras: preferências, pessoas e o papel delas, '
               + 'rotinas, decisões tomadas, restrições. Use quando aparecer '
               + 'algo que valeria saber daqui a meses. Não use para o que já '
               + 'tem ferramenta: gasto, conta, tarefa e compromisso vão nas '
               + 'delas, não aqui.',
    input_schema: {
      type: 'object',
      properties: {
        fato: {
          type: 'string',
          description: 'Uma frase curta que se entenda sozinha, sem depender '
                     + 'do contexto da conversa. "O João é o fornecedor de '
                     + 'peças", não "ele é o fornecedor".',
        },
      },
      required: ['fato'],
    },
  },
  {
    name: 'esquecer_fato',
    description: 'Remove um fato que deixou de valer. Passe o texto como ele '
               + 'aparece na lista de fatos.',
    input_schema: {
      type: 'object',
      properties: { fato: { type: 'string' } },
      required: ['fato'],
    },
  },
  {
    name: 'criar_evento',
    description: 'Cria um compromisso na agenda do Google. Use para reunião, '
               + 'consulta, viagem — coisas com hora marcada. Para algo que só '
               + 'precisa ser feito até certo dia, use criar_tarefa.',
    input_schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string' },
        inicio: {
          type: 'string',
          description: 'AAAA-MM-DDTHH:MM em horário local de Campo Grande. '
                     + 'Não converta fuso — passe a hora que o usuário disse.',
        },
        fim: {
          type: 'string',
          description: 'Mesmo formato. Omita para uma hora depois do início.',
        },
        local: { type: 'string' },
        descricao: { type: 'string' },
      },
      required: ['titulo', 'inicio'],
    },
  },
  {
    name: 'listar_eventos',
    description: 'Lista os compromissos da agenda num período.',
    input_schema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', enum: ['hoje', 'amanha', 'semana'] },
      },
      required: ['periodo'],
    },
  },
  {
    name: 'cancelar_evento',
    description: 'Cancela um compromisso. O id vem de listar_eventos — chame '
               + 'listar_eventos antes se não tiver o id em mãos.',
    input_schema: {
      type: 'object',
      properties: { evento_id: { type: 'string' } },
      required: ['evento_id'],
    },
  },

  // Estas duas rodam no servidor da Anthropic, não aqui. Não têm entrada no
  // `executar()` — chegam já resolvidas dentro da resposta. Por isso não
  // aparecem em `ferramentas_usadas`; para ver se houve busca, olhe os
  // blocos server_tool_use na execução.
  { type: 'web_search_20260209', name: 'web_search' },
  { type: 'web_fetch_20260209', name: 'web_fetch' },
];

// ------------------------------------------------------- execução das tools

async function executar(nome, args) {
  switch (nome) {

    case 'criar_tarefa': {
      const due = args.prazo ? paraUTC(args.prazo) : null;
      const card = await trello('/cards', 'POST', {
        idList: config.trello_list_id,
        name: args.titulo,
        ...(args.descricao ? { desc: args.descricao } : {}),
        ...(due ? { due } : {}),
      });
      return `Card criado: "${card.name}" (${card.shortUrl})`;
    }

    case 'lembrar_fato': {
      const f = String(args.fato || '').trim();
      if (!f) return 'Fato vazio, nada guardado.';
      if (fatos.some((x) => x.toLowerCase() === f.toLowerCase())) {
        return 'Isso já estava guardado.';
      }
      if (fatos.length >= MAX_FATOS) {
        return `Já são ${MAX_FATOS} fatos guardados, que é o limite. Pergunte `
             + 'ao usuário o que pode ser esquecido antes de guardar mais.';
      }
      fatos.push(f);
      return `Guardado: ${f}`;
    }

    case 'esquecer_fato': {
      const alvo = String(args.fato || '').trim().toLowerCase();
      const i = fatos.findIndex((x) => x.toLowerCase() === alvo);
      if (i === -1) return 'Não achei esse fato na lista.';
      const [removido] = fatos.splice(i, 1);
      return `Esquecido: ${removido}`;
    }

    case 'criar_evento': {
      const inicio = dataHoraLocal(args.inicio);
      const fimLocal = dataHoraLocal(args.fim || somaHoraLocal(args.inicio, 1));

      const ev = await calendario({
        method: 'POST',
        url: CAL,
        body: {
          summary: args.titulo,
          start: { dateTime: inicio, timeZone: TZ },
          end: { dateTime: fimLocal, timeZone: TZ },
          ...(args.local ? { location: args.local } : {}),
          ...(args.descricao ? { description: args.descricao } : {}),
        },
        json: true,
      });
      return `Compromisso criado: "${ev.summary}" em ${inicio.slice(0, 16).replace('T', ' ')}.`;
    }

    case 'listar_eventos': {
      const A = hoje.getUTCFullYear();
      const M = hoje.getUTCMonth();
      const D = hoje.getUTCDate();

      let timeMin = instanteUTC(A, M, D, 0, 0);
      let timeMax = instanteUTC(A, M, D, 23, 59);
      if (args.periodo === 'amanha') {
        timeMin = instanteUTC(A, M, D + 1, 0, 0);
        timeMax = instanteUTC(A, M, D + 1, 23, 59);
      }
      if (args.periodo === 'semana') {
        timeMax = instanteUTC(A, M, D + 7, 23, 59);
      }

      const r = await calendario({
        method: 'GET',
        url: `${CAL}?${qs({
          timeMin,
          timeMax,
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '25',
        })}`,
        json: true,
      });

      const itens = r.items || [];
      if (!itens.length) return 'Nenhum compromisso no período.';
      return itens.map((e) => {
        const quando = e.start?.dateTime || e.start?.date || '';
        return `- ${e.summary || '(sem título)'} — ${quando.slice(0, 16).replace('T', ' ')}`
             + ` [id ${e.id}]`;
      }).join('\n');
    }

    case 'cancelar_evento': {
      await calendario({
        method: 'DELETE',
        url: `${CAL}/${encodeURIComponent(args.evento_id)}`,
      });
      return 'Compromisso cancelado.';
    }

    case 'listar_tarefas': {
      const cards = await trello(`/boards/${config.trello_board_id}/cards`, 'GET', {
        fields: 'id,name,due,dueComplete,shortUrl',
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
        .map((c) => `- ${c.name}${c.due ? ` (vence ${c.due.slice(0, 10)})` : ''} [id ${c.id}]`)
        .join('\n');
    }

    case 'concluir_tarefa': {
      await trello(`/cards/${args.tarefa_id}`, 'PUT', { dueComplete: 'true' });
      return 'Tarefa marcada como concluída.';
    }

    case 'arquivar_tarefa': {
      await trello(`/cards/${args.tarefa_id}`, 'PUT', { closed: 'true' });
      return 'Tarefa arquivada.';
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

## Sobre tarefas e agenda
- Títulos de tarefa começando por verbo no infinitivo.
- **Datas e horas sempre no horário local que o usuário falou.** Não converta
  fuso — a conversão é feita depois de você.
- Compromisso com hora marcada é evento na agenda. Coisa a fazer até certo
  dia é tarefa. "Reunião com o João terça 15h" é evento; "ligar pro João até
  terça" é tarefa.
- "O que tenho pra hoje" pede as duas coisas: listar_eventos e listar_tarefas.
- Quando o usuário disser que terminou algo, use concluir_tarefa. Quando
  disser que cancelou ou não vai mais fazer, use arquivar_tarefa. Se não
  tiver o id da tarefa na conversa, chame listar_tarefas primeiro.

## Sobre contas
- "Contas para vencer" mostra a pagar e a receber separados.
- Conta sem gasto correspondente no mês é pendente.

## Pesquisa
- Use web_search quando a resposta depender de informação atual: preço,
  notícia, horário de funcionamento, disponibilidade, qualquer coisa que possa
  ter mudado. Nesses casos não responda de memória.
- Use web_fetch quando o usuário mandar um link e quiser saber o que tem nele.
- Não pesquise para registrar gasto, criar tarefa, consultar a planilha ou
  conversar. Essas coisas já têm ferramenta própria ou não precisam de nada.
- Ao usar resultado de busca, diga de onde veio.

## Áudio
- Se a mensagem veio de transcrição, interprete pelo contexto.
- Responda sempre em texto.

## Limites
- Não envia e-mail e não fala com terceiros. Tudo o que você faz fica entre
  você e ${config.nome}.
- Apaga só o que tem ferramenta para apagar, e só a pedido: cancelar_evento,
  arquivar_tarefa, esquecer_fato. Não existe nada que apague gasto, conta ou
  histórico — se pedirem, diga que não dá e explique o que dá.
- Não dá recomendação de investimento.

## Fatos
- Quando o usuário contar algo que valeria saber daqui a meses — uma
  preferência, quem é alguém, uma rotina, uma decisão — guarde com
  lembrar_fato. Não peça permissão, só guarde e siga a conversa.
- Não guarde o que já vai para outra ferramenta, nem o que só vale hoje.
- Se um fato guardado contradisser algo novo, esqueça o antigo.`
+ (fatos.length
    ? `\n\n## O que você já sabe sobre ${config.nome}\n`
      + fatos.map((f) => `- ${f}`).join('\n')
    : '');

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
      // Cobre pensamento e texto juntos. 1024 apertava quando entra resultado
      // de busca para resumir.
      max_tokens: 2048,
      system: systemPrompt,
      tools: ferramentas,
      messages: mensagens,
      // Sem isto o modelo roda em effort `high`, que é o padrão, e pensa
      // fundo até para decidir que "almoço 45 reais" é um registrar_gasto.
      // Num laço de três chamadas isso vira dezenas de segundos no WhatsApp.
      output_config: { effort: EFFORT },
    },
    json: true,
    timeout: TIMEOUT_MODELO_MS,
  });
}

const mensagens = [...historico, { role: 'user', content: texto }];
const usadas = [];
let resposta = 'Não consegui concluir, tenta de novo?';
let voltas = 0;

while (voltas < MAX_VOLTAS) {
  voltas++;
  const r = await chamarClaude(mensagens);

  // As ferramentas de servidor (busca) rodam num laço próprio do lado da
  // Anthropic. Se ele bate o limite interno, a resposta volta com pause_turn
  // e nenhum texto — é só reenviar a conversa com o turno do modelo no fim,
  // sem acrescentar mensagem de usuário, que ele retoma de onde parou.
  if (r.stop_reason === 'pause_turn') {
    mensagens.push({ role: 'assistant', content: r.content });
    continue;
  }

  if (r.stop_reason !== 'tool_use') {
    // Resposta com busca costuma vir quebrada em vários blocos de texto,
    // com os resultados no meio. Pegar só o primeiro entregaria um pedaço.
    const textos = r.content.filter((b) => b.type === 'text').map((b) => b.text);
    if (textos.length) resposta = textos.join('');
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
    fatos: JSON.stringify(fatos),
  },
}];
