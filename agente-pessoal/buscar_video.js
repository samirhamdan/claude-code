/**
 * Busca o vídeo mais recente do canal da igreja via feed RSS do YouTube.
 * Sem API key, sem credencial — GET simples num feed público.
 *
 * Nó Code, modo "Run Once for All Items".
 *
 * O canal publica por volta das 8h. Se este workflow roda antes disso,
 * o vídeo do dia ainda não existe — por isso o nó confere se o mais
 * recente do feed foi publicado HOJE, em vez de aceitar qualquer um.
 * O ideal é o Cron deste workflow rodar depois das 8h (ex.: 8:15), com
 * folga; esta checagem é uma proteção a mais, não substitui isso.
 */

// ─── preencher ───────────────────────────────────────────────────────────
const CHANNEL_ID = 'UCyjFCsUVfRQsE262-xbaS7w'; // Igreja Batista Central CG
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

const xml = await http({
  method: 'GET',
  url: `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`,
});

// O feed é XML regular o bastante para não precisar de parser: pega o
// primeiro bloco <entry>...</entry>, que é sempre o vídeo mais recente.
const bloco = String(xml).match(/<entry>[\s\S]*?<\/entry>/);
if (!bloco) {
  return [{ json: { encontrou: false, motivo: 'feed sem vídeos ou formato mudou' } }];
}

const entry = bloco[0];
const titulo = (entry.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
const videoId = (entry.match(/<yt:videoId>([\s\S]*?)<\/yt:videoId>/) || [])[1] || '';
const publicadoEm = (entry.match(/<published>([\s\S]*?)<\/published>/) || [])[1] || '';

if (!videoId) {
  return [{ json: { encontrou: false, motivo: 'não achei o id do vídeo no feed' } }];
}

// "Hoje" em Campo Grande, comparado com a data de publicação (que vem em UTC).
const hojeLocal = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
const publicadoLocal = publicadoEm
  ? new Date(new Date(publicadoEm).getTime() - 4 * 60 * 60 * 1000).toISOString().slice(0, 10)
  : null;

const ehDeHoje = publicadoLocal === hojeLocal;

return [{
  json: {
    encontrou: ehDeHoje,
    titulo: titulo.trim(),
    link: `https://www.youtube.com/watch?v=${videoId}`,
    publicado_em: publicadoEm,
    // Se o Cron rodou cedo e o vídeo de hoje ainda não saiu, isto fica
    // false mesmo achando um vídeo — é o vídeo de ontem.
  },
}];
