/**
 * Escolhe o(s) vídeo(s) do dia no canal da igreja, comparando com a leitura
 * do plano. Um dia de leitura pode cobrir vários capítulos e o canal às
 * vezes publica um vídeo por capítulo — por isso isto devolve uma LISTA,
 * não um único vídeo, e é o modelo quem decide quantos pertencem à leitura
 * de hoje, sem contagem de capítulo feita aqui no código.
 *
 * Nó Code, modo "Run Once for All Items". Precisa rodar DEPOIS do nó
 * "Buscar Leitura" (encadeado, não em paralelo) — é dele que vem a leitura
 * para comparar.
 *
 * Requer no container: ANTHROPIC_API_KEY (já está lá, usada pelo Agente).
 */

// ─── preencher ───────────────────────────────────────────────────────────
const CHANNEL_ID = 'UCyjFCsUVfRQsE262-xbaS7w'; // Igreja Batista Central CG
const NOME_NO_LEITURA = 'Buscar Leitura';       // nome exato do nó no canvas
// ─────────────────────────────────────────────────────────────────────────

const ctx = this;

async function http(opcoes) {
  try {
    return await ctx.helpers.httpRequest(opcoes);
  } catch (e) {
    const status = e.statusCode ?? e.httpCode ?? '?';
    const corpo = String(e.response?.body ?? e.error ?? e.message).slice(0, 300);
    throw new Error(`${status} em ${opcoes.url} — ${corpo}`);
  }
}

// ── leitura do dia, vinda do nó anterior ──────────────────────────────────
const leituraRows = $(NOME_NO_LEITURA).all();
if (!leituraRows.length) {
  return [{ json: { encontrou: false, videos: [], motivo: 'sem leitura de hoje para comparar' } }];
}
const leitura = leituraRows[0].json;
const referencia = `${leitura.Livro} ${leitura.Capitulos}`;

// ── todos os vídeos publicados hoje ───────────────────────────────────────
const xml = await http({
  method: 'GET',
  url: `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`,
});

const blocos = [...String(xml).matchAll(/<entry>[\s\S]*?<\/entry>/g)].map((m) => m[0]);

const hojeLocal = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString().slice(0, 10);

const candidatos = blocos
  .map((e) => {
    const titulo = (e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
    const videoId = (e.match(/<yt:videoId>([\s\S]*?)<\/yt:videoId>/) || [])[1] || '';
    const publicadoEm = (e.match(/<published>([\s\S]*?)<\/published>/) || [])[1] || '';
    const publicadoLocal = publicadoEm
      ? new Date(new Date(publicadoEm).getTime() - 4 * 3600000).toISOString().slice(0, 10)
      : null;
    return { titulo: titulo.trim(), link: `https://www.youtube.com/watch?v=${videoId}`, publicadoLocal };
  })
  .filter((c) => c.publicadoLocal === hojeLocal && c.link.includes('v='));

if (!candidatos.length) {
  return [{ json: { encontrou: false, videos: [], motivo: 'nenhum vídeo publicado hoje' } }];
}

// ── pergunta ao modelo quais candidatos pertencem à leitura de hoje ──────
// Sempre passa pelo modelo, mesmo com 1 candidato só: um único vídeo
// publicado não significa que é o certo — pode ser de outra série, e a
// leitura de hoje pode ainda não ter vídeo nenhum.
const resp = await http({
  method: 'POST',
  url: 'https://api.anthropic.com/v1/messages',
  headers: {
    'x-api-key': $env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  },
  body: {
    model: 'claude-haiku-4-5',
    max_tokens: 40,
    system: 'Você identifica, numa lista numerada de vídeos, quais pertencem '
          + 'à leitura bíblica do dia. A leitura pode ter mais de um capítulo, '
          + 'e às vezes há um vídeo por capítulo — nesse caso, mais de um item '
          + 'da lista pode pertencer à leitura. Responda só com os números que '
          + 'pertencem, separados por vírgula (ex: "2,3"), ou "nenhum" se '
          + 'nenhum título tiver relação com a leitura.',
    messages: [{
      role: 'user',
      content: `Leitura de hoje: ${referencia}\n\nVídeos publicados hoje:\n`
        + candidatos.map((c, i) => `${i + 1}. ${c.titulo}`).join('\n'),
    }],
  },
  json: true,
});

const texto = (resp.content || []).map((b) => b.text || '').join('').trim().toLowerCase();
const numeros = [...new Set(
  [...texto.matchAll(/\d+/g)]
    .map((m) => parseInt(m[0], 10))
    .filter((n) => n >= 1 && n <= candidatos.length)
)];

const escolhidos = numeros.map((n) => candidatos[n - 1]);

if (!escolhidos.length) {
  return [{
    json: {
      encontrou: false,
      videos: [],
      motivo: `nenhum dos ${candidatos.length} vídeos de hoje bate com "${referencia}"`,
    },
  }];
}

return [{
  json: {
    encontrou: true,
    videos: escolhidos.map((v) => ({ titulo: v.titulo, link: v.link })),
  },
}];
