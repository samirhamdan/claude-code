// Testa o ramo de áudio: o filtro que separa voz de texto e os dois nós
// que cercam a transcrição.
//
//   node workflows/no-audio.test.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ler = (n) => fs.readFileSync(path.join(AQUI, n), 'utf8');

let falhas = 0;
const ok = (nome, cond, det = '') => {
  console.log(`${cond ? '  ok  ' : ' FALHA'}  ${nome}${cond ? '' : ' — ' + det}`);
  if (!cond) falhas++;
};

// ── Filtra Mensagem ──────────────────────────────────────────────────────

const filtra = new Function('$input',
  `return (async function () {\n${ler('no-filtra-mensagem.js')}\n})();`);

const rodarFiltra = (body) =>
  filtra({ first: () => ({ json: { body } }) });

const base = (message, extra = {}) => ({
  event: 'messages.upsert',
  instance: 'alessio-comercial',
  data: {
    key: { remoteJid: '5567999990000@s.whatsapp.net', fromMe: false, id: 'ABC123' },
    pushName: 'Carlos',
    message,
    ...extra,
  },
});

let r = await rodarFiltra(base({ conversation: 'quero uma câmera' }));
ok('1. texto sai marcado como texto', r[0].json.tipo === 'texto' && r[0].json.texto === 'quero uma câmera');

r = await rodarFiltra(base({ audioMessage: { seconds: 5, mimetype: 'audio/ogg' } }));
ok('2. áudio sai marcado como áudio, com o id da mensagem',
  r[0].json.tipo === 'audio' && r[0].json.audio_id === 'ABC123',
  JSON.stringify(r[0]?.json));

r = await rodarFiltra(base({ imageMessage: { mimetype: 'image/jpeg' } }));
ok('3. imagem continua sendo descartada', r.length === 0);

r = await rodarFiltra({
  ...base({ conversation: 'oi' }),
  data: { ...base({ conversation: 'oi' }).data,
          key: { remoteJid: '123@g.us', fromMe: false, id: 'X' } },
});
ok('4. grupo continua barrado mesmo mandando texto', r.length === 0);

r = await rodarFiltra({
  ...base({ conversation: 'resposta do bot' }),
  data: { ...base({ conversation: 'x' }).data,
          key: { remoteJid: '5567999990000@s.whatsapp.net', fromMe: true, id: 'Y' } },
});
ok('5. mensagem do próprio bot não vira laço', r.length === 0);

// ── Converte Base64 / Monta Texto ────────────────────────────────────────

function rodarAudio({ modo, input, nos = {} }) {
  const corpo = ler('no-audio.js').replace(
    "const MODO = 'binario';", `const MODO = '${modo}';`);
  const fabrica = new Function('$input', '$',
    `return (async function () {\n${corpo}\n}).call(this);`);
  const ctx = {
    helpers: {
      // Devolve algo reconhecível para o teste conferir que o binário foi montado.
      prepareBinaryData: async (buf, nome, mime) =>
        ({ bytes: buf.length, fileName: nome, mimeType: mime }),
    },
  };
  const $ = (nome) => {
    if (!(nome in nos)) throw new Error(`no "${nome}" nao existe`);
    return { first: () => ({ json: nos[nome] }) };
  };
  return fabrica.call(ctx, { first: () => ({ json: input }) }, $);
}

const b64 = Buffer.from('audio-falso').toString('base64');

r = await rodarAudio({ modo: 'binario', input: { base64: b64, mimetype: 'audio/ogg; codecs=opus' } });
ok('6. base64 vira binário com o mimetype limpo, sem o "; codecs="',
  r[0].binary.data.bytes === 11 && r[0].binary.data.mimeType === 'audio/ogg',
  JSON.stringify(r[0].binary.data));

let erro = null;
try {
  await rodarAudio({ modo: 'binario', input: {} });
} catch (e) { erro = e.message; }
ok('7. sem base64 o erro diz onde olhar, em vez de estourar undefined',
  erro && erro.includes('getBase64FromMediaMessage'), String(erro).slice(0, 60));

const FILTRA = { jid: '5567999990000@s.whatsapp.net', telefone: '5567999990000',
                 nome_whatsapp: 'Carlos', instancia: 'alessio-comercial' };

r = await rodarAudio({
  modo: 'texto',
  input: { text: 'queria um orçamento de portão' },
  nos: { 'Filtra Mensagem': FILTRA },
});
ok('8. transcrição vira texto com a identidade da conversa junto',
  r[0].json.texto === 'queria um orçamento de portão'
  && r[0].json.telefone === '5567999990000'
  && r[0].json.transcricao_vazia === false);

r = await rodarAudio({
  modo: 'texto', input: { text: '   ' }, nos: { 'Filtra Mensagem': FILTRA },
});
ok('9. áudio inaudível não some: vira texto que o modelo sabe responder',
  r[0].json.transcricao_vazia === true && r[0].json.texto.length > 0,
  r[0].json.texto);

// ── convergência: o debounce tem que ler do ramo que rodou ───────────────

function rodarDebounce({ input, nos, execId = '1' }) {
  const corpo = ler('no-debounce.js');
  const fabrica = new Function('$input', '$', '$execution',
    `return (async function () {\n${corpo}\n})();`);
  const $ = (nome) => {
    if (!(nome in nos)) throw new Error(`no "${nome}" nao existe`);
    return { first: () => ({ json: nos[nome] }), isExecuted: true };
  };
  return fabrica({ first: () => ({ json: input }) }, $, { id: execId });
}

r = await rodarDebounce({
  input: { buffer_raw: '' },
  nos: {
    'Filtra Mensagem': { ...FILTRA, tipo: 'audio', texto: '' },
    'Monta Texto': { texto: 'quero pôr câmera na chácara' },
  },
});
ok('10. veio áudio: o buffer usa a transcrição, não o texto vazio do filtro',
  JSON.parse(r[0].json.buffer)[0] === 'quero pôr câmera na chácara',
  r[0].json.buffer);

// Sem áudio, `Monta Texto` não roda — e referenciar nó não executado derruba
// o nó inteiro se não houver guarda. É o bug do Monta Entrada, de novo.
const corpoDeb = ler('no-debounce.js');
const fabDeb = new Function('$input', '$', '$execution',
  `return (async function () {\n${corpoDeb}\n})();`);
r = await fabDeb(
  { first: () => ({ json: { buffer_raw: '' } }) },
  (nome) => {
    if (nome === 'Monta Texto') return { isExecuted: false,
      first: () => { throw new Error('nó não executado'); } };
    return { isExecuted: true,
      first: () => ({ json: { ...FILTRA, tipo: 'texto', texto: 'quero câmera' } }) };
  },
  { id: '1' });
ok('11. veio texto: o nó de áudio não executado não derruba o debounce',
  JSON.parse(r[0].json.buffer)[0] === 'quero câmera', r[0].json.buffer);

console.log(falhas === 0 ? '\nTodos os 11 casos passaram.' : `\n${falhas} de 11 FALHARAM.`);
process.exit(falhas === 0 ? 0 : 1);
