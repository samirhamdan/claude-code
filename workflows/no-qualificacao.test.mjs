// Testa o nó Qualifica sem gastar chamada de API: reproduz o envelope do
// Code node do n8n e simula a resposta do modelo.
//
//   node workflows/no-qualificacao.test.mjs
//
// Precisa de node, então roda na máquina de desenvolvimento — a VPS não tem.
//
// A régua de temperatura vai mudar quando o vendedor opinar. Quando mudar,
// é aqui que se descobre o que quebrou junto.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FONTE = path.join(AQUI, 'no-qualificacao.js');

const corpo = fs.readFileSync(FONTE, 'utf8');

// O Code node envolve o corpo num async function e injeta $input, $env etc.
const fabrica = new Function(
  '$input', '$env', '$execution', '$',
  `return (async function () {\n${corpo}\n}).call(this);`
);

function rodar({ telefone = '5567999990000', texto, estado_raw = '', modelo,
                 // O `Lê Estado` e um no Redis: ele entrega SO estado_raw e
                 // descarta telefone e texto. Por padrao o harness simula
                 // isso, que e o que acontece no canvas de verdade.
                 inputCompleto = false }) {
  const $input = {
    first: () => ({
      json: inputCompleto ? { telefone, texto, estado_raw } : { estado_raw },
    }),
  };
  const $ = (nome) => {
    if (nome !== 'Confere Debounce') throw new Error(`no "${nome}" nao existe`);
    return { first: () => ({ json: { telefone, texto } }) };
  };
  const $env = { ANTHROPIC_API_KEY: 'sk-teste' };
  const $execution = { id: '123' };

  let chamouModelo = false;
  const ctx = {
    helpers: {
      httpRequest: async () => {
        chamouModelo = true;
        return {
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', name: 'responder', input: modelo }],
        };
      },
    },
  };

  return fabrica.call(ctx, $input, $env, $execution, $)
    .then((r) => ({ saida: r[0].json, chamouModelo }));
}

const RESP_PADRAO = {
  resposta: 'Certo! É pra casa ou pra um ponto comercial?',
  intencao: 'qualificar',
  campos: { nome: null, servico: null, tipo_imovel: null, regiao: null, urgencia: null, porte: null },
  completo: false,
  handoff: false,
  motivo_handoff: null,
};

let falhas = 0;
function ok(nome, cond, detalhe = '') {
  console.log(`${cond ? '  ok  ' : ' FALHA'}  ${nome}${cond ? '' : ' — ' + detalhe}`);
  if (!cond) falhas++;
}

const casos = [];

casos.push(async () => {
  const { saida, chamouModelo } = await rodar({ texto: 'oi', modelo: RESP_PADRAO });
  ok('1. primeiro turno vai ao modelo, sem saudacao enlatada',
    chamouModelo && saida.enviar === true && !saida.resposta.includes('1\u20e3'),
    `chamouModelo=${chamouModelo}`);
});

casos.push(async () => {
  const { saida, chamouModelo } = await rodar({
    texto: 'Olá! Vim pelo anúncio do motor de portão com Wi-Fi.',
    modelo: RESP_PADRAO,
  });
  const e = JSON.parse(saida.estado);
  ok('2. lead de anúncio pula o menu e já vem com o serviço',
    e.origem === 'anuncio' && saida.campos.servico === 'interfone_portao' && chamouModelo,
    `origem=${e.origem} servico=${saida.campos.servico}`);
});

casos.push(async () => {
  // Acento e caixa diferentes do cadastrado, como a pessoa costuma editar.
  const { saida } = await rodar({
    texto: 'vim pelo ANUNCIO do MOTOR DE PORTÃO',
    modelo: RESP_PADRAO,
  });
  ok('3. casamento de campanha ignora acento e caixa',
    JSON.parse(saida.estado).origem === 'anuncio');
});

casos.push(async () => {
  const estado = JSON.stringify({ origem: 'desconhecida', saudou: true, campos: {} });
  const { saida } = await rodar({
    texto: 'queria pôr um motor no portão de casa', estado_raw: estado,
    modelo: { ...RESP_PADRAO,
      campos: { ...RESP_PADRAO.campos, servico: 'interfone_portao' } },
  });
  ok('4. serviço vem da linguagem natural, sem menu numerado',
    saida.campos.servico === 'interfone_portao', `servico=${saida.campos.servico}`);
});

casos.push(async () => {
  const estado = JSON.stringify({ origem: 'desconhecida', saudou: true, campos: {} });
  const { saida } = await rodar({
    texto: 'o ar que vocês instalaram parou de gelar', estado_raw: estado,
    modelo: { ...RESP_PADRAO, intencao: 'suporte' },
  });
  ok('5. intenção de suporte sobrevive até a saída e o estado',
    saida.intencao === 'suporte'
    && JSON.parse(saida.estado).intencao === 'suporte',
    `intencao=${saida.intencao}`);
});

casos.push(async () => {
  const estado = JSON.stringify({ handoff: true, saudou: true, campos: {} });
  const { saida, chamouModelo } = await rodar({
    texto: 'ainda estou aí?', estado_raw: estado, modelo: RESP_PADRAO,
  });
  ok('6. depois do handoff o bot cala e nem chama o modelo',
    saida.enviar === false && !chamouModelo, `enviar=${saida.enviar}`);
});

casos.push(async () => {
  const { saida } = await rodar({
    texto: 'é pra minha casa no Tiradentes, preciso essa semana',
    estado_raw: JSON.stringify({ saudou: true, origem: 'anuncio', campos: {} }),
    modelo: {
      ...RESP_PADRAO,
      campos: { nome: 'Carlos', servico: 'camera', tipo_imovel: 'residencia',
                regiao: 'Tiradentes', urgencia: 'esta_semana', porte: 'sistema_completo' },
      completo: true,
    },
  });
  ok('7. cinco campos + urgência alta = quente, e quente força handoff',
    saida.temperatura === 'quente' && saida.handoff === true && saida.motivo_handoff,
    `temp=${saida.temperatura} handoff=${saida.handoff}`);
});

casos.push(async () => {
  const { saida } = await rodar({
    texto: 'mês que vem',
    estado_raw: JSON.stringify({ saudou: true, origem: 'anuncio', campos: {} }),
    modelo: {
      ...RESP_PADRAO,
      campos: { nome: 'Ana', servico: 'alarme', tipo_imovel: 'comercio',
                regiao: 'Centro', urgencia: 'este_mes', porte: null },
      completo: true,
    },
  });
  ok('8. urgência este_mes é morno, e morno não vira handoff',
    saida.temperatura === 'morno' && saida.handoff === false,
    `temp=${saida.temperatura} handoff=${saida.handoff}`);
});

casos.push(async () => {
  // O modelo "esqueceu" o nome; o valor já coletado tem que sobreviver.
  const { saida } = await rodar({
    texto: 'no centro',
    estado_raw: JSON.stringify({
      saudou: true, origem: 'anuncio',
      campos: { nome: 'Carlos', servico: 'camera', tipo_imovel: null,
                regiao: null, urgencia: null, porte: null },
    }),
    modelo: {
      ...RESP_PADRAO,
      campos: { nome: null, servico: 'camera', tipo_imovel: null,
                regiao: 'Centro', urgencia: null, porte: null },
    },
  });
  ok('9. campo já coletado não regride para null',
    saida.campos.nome === 'Carlos' && saida.campos.regiao === 'Centro',
    `nome=${saida.campos.nome}`);
});

casos.push(async () => {
  const { saida } = await rodar({
    texto: 'quero falar com alguém',
    estado_raw: JSON.stringify({ saudou: true, origem: 'anuncio', campos: {} }),
    modelo: { ...RESP_PADRAO, handoff: true, motivo_handoff: '' },
  });
  ok('10. handoff sem motivo ganha um motivo em vez de ir vazio',
    saida.handoff === true && String(saida.motivo_handoff || '').length > 0,
    `motivo=${JSON.stringify(saida.motivo_handoff)}`);
});

casos.push(async () => {
  const { saida } = await rodar({
    texto: 'oi', estado_raw: '{lixo que nao e json', modelo: RESP_PADRAO,
  });
  ok('11. estado corrompido no Redis não derruba o atendimento',
    typeof saida.resposta === 'string' && saida.resposta.length > 0);
});

// A regressão que derrubou o primeiro teste em produção: o nó Lê Estado é
// Redis, entrega só `estado_raw`, e ler telefone de `$input` estoura com
// "Sem telefone na entrada". Todos os casos acima já rodam assim; este
// existe para o defeito ter nome quando voltar.
casos.push(async () => {
  const { saida } = await rodar({
    texto: 'oi', modelo: RESP_PADRAO,
    // inputCompleto continua false: $input tem só estado_raw, como o Redis entrega
  });
  ok('12. telefone e texto vêm do Confere Debounce, não do $input',
    saida.telefone === '5567999990000' && saida.resposta.length > 0,
    `telefone=${saida.telefone}`);
});

for (const c of casos) await c();

console.log(falhas === 0
  ? `\nTodos os ${casos.length} casos passaram.`
  : `\n${falhas} de ${casos.length} FALHARAM.`);
process.exit(falhas === 0 ? 0 : 1);
