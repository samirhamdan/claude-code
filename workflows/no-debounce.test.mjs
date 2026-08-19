// Testa o nó de debounce nos dois modos.
//
//   node workflows/no-debounce.test.mjs
//
// O ponto central destes testes: **o $input simula o que os nós Redis
// realmente entregam**, que é só a propriedade que eles setaram, sem o resto
// do item. Foi por não simular isso que a primeira versão lia `token_atual`
// de `$input`, recebia undefined, concluía que ninguém a superou e respondia
// em duplicata — o defeito exato que o debounce existe para evitar.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const bruto = fs.readFileSync(path.join(AQUI, 'no-debounce.js'), 'utf8');

function rodar({ modo, input, nos, execId = '100' }) {
  const corpo = bruto.replace(
    "const MODO = 'marcar';",
    `const MODO = '${modo}';`
  );
  const fabrica = new Function('$input', '$', '$execution',
    `return (async function () {\n${corpo}\n})();`);

  const $ = (nome) => {
    if (!(nome in nos)) throw new Error(`nó "${nome}" não existe no canvas`);
    return { first: () => ({ json: nos[nome] }) };
  };
  return fabrica({ first: () => ({ json: input }) }, $, { id: execId });
}

const FILTRA = { jid: '5567999990000@s.whatsapp.net', telefone: '5567999990000', texto: 'oi' };

let falhas = 0;
const ok = (nome, cond, det = '') => {
  console.log(`${cond ? '  ok  ' : ' FALHA'}  ${nome}${cond ? '' : ' — ' + det}`);
  if (!cond) falhas++;
};

// ── marcar: o $input é o que o "Lê Buffer" entrega, ou seja, só buffer_raw ──

let r = await rodar({
  modo: 'marcar',
  input: { buffer_raw: '' },
  nos: { 'Filtra Mensagem': FILTRA },
});
ok('1. primeira mensagem: pega o texto do Filtra, não do $input',
  JSON.parse(r[0].json.buffer)[0] === 'oi', `buffer=${r[0].json.buffer}`);

r = await rodar({
  modo: 'marcar',
  input: { buffer_raw: '["oi","tudo bem?"]' },
  nos: { 'Filtra Mensagem': { ...FILTRA, texto: 'queria um orçamento' } },
});
ok('2. rajada acumula em vez de sobrescrever',
  JSON.parse(r[0].json.buffer).length === 3, `buffer=${r[0].json.buffer}`);

r = await rodar({
  modo: 'marcar',
  input: { buffer_raw: '{quebrado' },
  nos: { 'Filtra Mensagem': FILTRA },
});
ok('3. buffer corrompido recomeça em vez de derrubar',
  JSON.parse(r[0].json.buffer).length === 1);

r = await rodar({
  modo: 'marcar', execId: '777',
  input: { buffer_raw: '' },
  nos: { 'Filtra Mensagem': FILTRA },
});
ok('4. o token gravado é a id desta execução',
  r[0].json.token === '777', `token=${r[0].json.token}`);

// ── conferir: o $input é o que o "Relê Buffer" entrega — o token já se foi ──

r = await rodar({
  modo: 'conferir', execId: '100',
  input: { buffer_raw: '["oi","tudo bem?"]' },
  nos: { 'Filtra Mensagem': FILTRA, 'Relê Token': { token_atual: '200' } },
});
ok('5. superada por execução mais nova: para e não responde',
  r[0].json.continuar === false, `continuar=${r[0].json.continuar}`);

r = await rodar({
  modo: 'conferir', execId: '200',
  input: { buffer_raw: '["oi","tudo bem?","queria um orçamento"]' },
  nos: { 'Filtra Mensagem': FILTRA, 'Relê Token': { token_atual: '200' } },
});
ok('6. última da rajada segue e leva as três mensagens juntas',
  r[0].json.continuar === true
  && r[0].json.mensagens_na_rajada === 3
  && r[0].json.texto.includes('orçamento'),
  `texto=${JSON.stringify(r[0].json.texto)}`);

r = await rodar({
  modo: 'conferir', execId: '100',
  input: { buffer_raw: '["oi"]' },
  nos: { 'Filtra Mensagem': FILTRA, 'Relê Token': { token_atual: '' } },
});
ok('7. token expirado segue em frente — mudo é pior que duplicado',
  r[0].json.continuar === true);

// A regressão que motivou o teste: se o token for lido de $input, ele vem
// undefined e toda execução da rajada se acha a vencedora.
r = await rodar({
  modo: 'conferir', execId: '100',
  input: { buffer_raw: '["oi"]' }, // repare: sem token_atual, como o Redis entrega
  nos: { 'Filtra Mensagem': FILTRA, 'Relê Token': { token_atual: '999' } },
});
ok('8. token vem do nó Relê Token mesmo ausente do $input',
  r[0].json.continuar === false,
  'leu de $input e se achou vencedora — todas responderiam');

console.log(falhas === 0 ? '\nTodos os 8 casos passaram.' : `\n${falhas} de 8 FALHARAM.`);
process.exit(falhas === 0 ? 0 : 1);
