/**
 * Escolhe o vídeo do dia no canal da igreja, comparando com a leitura do
 * plano. O canal publica mais de um vídeo por dia às vezes (séries
 * diferentes), então "o mais recente" não é confiável — precisa comparar
 * com o que está sendo lido.
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
  return [{ json: { encontrou: false, motivo: 'sem leitura de hoje para comparar' } }];
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
  return [{ json: { encontrou: false, motivo: 'nenhum vídeo publicado hoje' } }];
}

if (candidatos.length === 1) {
  // só um candidato — nada para comparar, usa direto
  return [{ json: { encontrou: true, titulo: candidatos[0].titulo, link: candidatos[0].link } }];
}

// ── mais de um vídeo hoje: pergunta ao modelo qual bate com a leitura ────
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
    max_tokens: 20,
    system: 'Você escolhe, numa lista numerada de vídeos, qual corresponde à '
          + 'leitura bíblica do dia. Responda só o número. Se nenhum título '
          + 'tiver relação com a leitura, responda "nenhum".',
    messages: [{
      role: 'user',
      content: `Leitura de hoje: ${referencia}\n\nVídeos publicados hoje:\n`
        + candidatos.map((c, i) => `${i + 1}. ${c.titulo}`).join('\n'),
    }],
  },
  json: true,
});

const texto = (resp.content || []).map((b) => b.text || '').join('').trim().toLowerCase();
const num = parseInt((texto.match(/\d+/) || [])[0], 10);
const escolhido = candidatos[num - 1];

if (!escolhido) {
  return [{ json: { encontrou: false, motivo: `nenhum dos ${candidatos.length} vídeos de hoje bate com "${referencia}"` } }];
}

return [{ json: { encontrou: true, titulo: escolhido.titulo, link: escolhido.link } }];
