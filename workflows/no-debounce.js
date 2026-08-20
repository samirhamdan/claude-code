/**
 * Nó "Confere Debounce" — decide se esta execução é a que responde.
 *
 * O problema: o lead manda "oi", "tudo bem?", "queria um orçamento" em três
 * mensagens seguidas. Sem debounce o bot responde três vezes e a conversa
 * desanda. É obrigatório — está no CLAUDE.md.
 *
 * A ideia: toda mensagem que chega grava a própria id de execução numa chave
 * do Redis. Depois de esperar 8s, cada execução relê a chave. Só continua
 * quem ainda estiver lá — ou seja, a última a chegar. As outras morrem em
 * silêncio, e a última responde por todas.
 *
 * Nó Code, modo "Run Once for All Items".
 *
 * Posição no canvas:
 *
 *   Filtra Mensagem
 *        ↓
 *   Lê Buffer (Redis GET  buffer:{jid})
 *        ↓
 *   Marca Vez (Code, este arquivo, modo="marcar")
 *        ↓
 *   Grava Buffer (Redis SET buffer:{jid}, TTL 120)
 *   Marca Token  (Redis SET debounce:{jid} = id da execução, TTL 120)
 *        ↓
 *   Espera 8s (Wait)
 *        ↓
 *   Relê Token (Redis GET debounce:{jid})
 *        ↓
 *   Confere Debounce (Code, este arquivo, modo="conferir")
 *        ↓
 *   IF continuar == true → segue para a qualificação
 *
 * Os dois modos vivem no mesmo arquivo porque são as duas metades da mesma
 * regra; separá-los em dois arquivos faz um ser alterado sem o outro.
 * Escolha o modo pela constante abaixo ao colar em cada nó.
 */

// ─── ao colar, ajuste só isto ────────────────────────────────────────────
const MODO = 'marcar'; // 'marcar' antes do Wait, 'conferir' depois
// ─────────────────────────────────────────────────────────────────────────

const JANELA_MS = 8000; // o debounce em si é o nó Wait; isto é só documentação

const entrada = $input.first().json;

// Cada nó Redis devolve SÓ a propriedade que setou e descarta o resto do
// item. Com vários deles em série, o que chega no `$input` é sempre só o
// último valor lido — tudo o mais tem que ser buscado pelo nome do nó.
// Ler de `$input` aqui não dá erro: dá `undefined`, que é pior.
function daFiltra(campo) {
  return $('Filtra Mensagem').first().json[campo];
}

// Referenciar com `$()` um nó que não rodou derruba o nó inteiro. Como
// texto e áudio são ramos alternativos, o `Monta Texto` fica sem executar
// em toda mensagem digitada — tem que ser lido atrás de uma guarda.
function noOpcional(nome) {
  try {
    return $(nome).isExecuted ? $(nome).first().json : null;
  } catch (e) {
    return null;
  }
}

// O texto da conversa vem do ramo que rodou: transcrição, se veio áudio;
// o que a pessoa digitou, caso contrário. Assumir um dos dois é o erro que
// derrubou o Monta Entrada do agente pessoal.
function textoDaConversa() {
  const audio = noOpcional('Monta Texto');
  if (audio && audio.texto) return audio.texto;
  return daFiltra('texto');
}

// O jid vem do Filtra Mensagem e é a identidade da conversa em tudo:
// chave de buffer, de debounce e de estado.
const jid = String(entrada.jid ?? daFiltra('jid') ?? '');
const telefone = jid.split('@')[0];

if (!telefone) {
  throw new Error('Sem jid — o Filtra Mensagem não passou a identidade da conversa.');
}

if (MODO === 'marcar') {
  // O `Lê Buffer` que vem logo antes deixou só `buffer_raw` no item, então o
  // texto vem pelo nome do nó — e de qual nó depende do ramo que rodou.
  const texto = String(entrada.texto ?? textoDaConversa() ?? '').trim();

  // O buffer acumula as mensagens da rajada para a vencedora ler todas.
  //
  // Isto é um read-modify-write: duas mensagens que chegam no mesmo instante
  // podem ler o mesmo buffer e uma sobrescrever a outra. A janela é de uns
  // 100ms e o pior caso é perder uma mensagem da rajada, com as outras e o
  // histórico ainda no lugar.
  //
  // Se o nó Redis desta instalação oferecer a operação `push`, prefira: lista
  // é append atômico e a corrida deixa de existir. Aí este nó só monta o
  // texto e o push vira o "Grava Buffer".
  let anteriores = [];
  try {
    const bruto = entrada.buffer_raw;
    const v = bruto ? JSON.parse(bruto) : [];
    if (Array.isArray(v)) anteriores = v;
  } catch (e) {
    anteriores = [];
  }

  const buffer = texto ? [...anteriores, texto] : anteriores;

  return [{
    json: {
      jid,
      telefone,
      // Quem chegar depois sobrescreve, e é isso que faz a última vencer.
      token: String($execution.id),
      buffer: JSON.stringify(buffer),
      janela_ms: JANELA_MS,
    },
  }];
}

if (MODO === 'conferir') {
  // O `Relê Buffer` vem depois do `Relê Token` e descartou o token do item.
  // Buscar pelo nome é obrigatório aqui — de `$input` viria undefined, e o
  // nó concluiria que ninguém superou ninguém, respondendo em duplicata.
  const tokenAtual = String(
    entrada.token_atual ?? $('Relê Token').first().json.token_atual ?? ''
  ).trim();
  const meuToken = String($execution.id);

  // Chegou mensagem depois da minha: ela responde por mim. Saio sem falar.
  if (tokenAtual && tokenAtual !== meuToken) {
    return [{
      json: {
        continuar: false,
        jid,
        telefone,
        motivo: `execução ${meuToken} superada por ${tokenAtual}`,
      },
    }];
  }

  // Token vazio significa que a chave expirou (TTL curto demais para a
  // janela) ou que alguém limpou o Redis. Seguir é melhor que ficar mudo:
  // pior caso o bot responde duas vezes; o outro caso é não responder nunca.
  let mensagens = [];
  try {
    const v = entrada.buffer_raw ? JSON.parse(entrada.buffer_raw) : [];
    if (Array.isArray(v)) mensagens = v;
  } catch (e) {
    mensagens = [];
  }

  const texto = mensagens.join('\n').trim()
    || String(entrada.texto ?? textoDaConversa() ?? '').trim();

  return [{
    json: {
      continuar: true,
      jid,
      telefone,
      // As três mensagens da rajada viram um texto só para o modelo.
      texto,
      mensagens_na_rajada: mensagens.length,
      token: meuToken,
    },
  }];
}

throw new Error(`MODO inválido: "${MODO}". Use 'marcar' ou 'conferir'.`);
