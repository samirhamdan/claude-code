/**
 * Lê um intervalo de planilha usando as credenciais do .env, no mesmo padrão
 * do nó Agente. Substitui o nó Google Sheets do n8n e dispensa a credencial
 * OAuth dele — uma fonte de autenticação a menos para manter.
 *
 * Nó Code, modo "Run Once for All Items".
 *
 * Requer no container: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e
 * GOOGLE_REFRESH_TOKEN — já estão lá desde o agente.
 */

// ─── preencher ───────────────────────────────────────────────────────────
const PLANILHA = 'COLE_AQUI_O_ID_DA_PLANILHA';
const INTERVALO = 'NomeDaAba!A:C';
// ─────────────────────────────────────────────────────────────────────────

const ctx = this;

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

const resp = await http({
  method: 'POST',
  url: 'https://oauth2.googleapis.com/token',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: qs({
    client_id: $env.GOOGLE_CLIENT_ID,
    client_secret: $env.GOOGLE_CLIENT_SECRET,
    refresh_token: $env.GOOGLE_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  }),
  json: true,
});

const token = (typeof resp === 'string' ? JSON.parse(resp) : resp).access_token;

const dados = await http({
  method: 'GET',
  url: `https://sheets.googleapis.com/v4/spreadsheets/${PLANILHA}`
     + `/values/${encodeURIComponent(INTERVALO)}`,
  headers: { Authorization: `Bearer ${token}` },
  json: true,
});

const linhas = dados.values || [];

// ─── busca da linha de hoje ──────────────────────────────────────────────
// Ajustar ao formato real da coluna de data. Este trecho assume D/M sem zero
// à esquerda ("5/9"), que é o formato do plano de leitura.
const hoje = new Date(Date.now() - 4 * 60 * 60 * 1000); // Campo Grande, UTC-4
const chave = `${hoje.getUTCDate()}/${hoje.getUTCMonth() + 1}`;

const linha = linhas.find((l) => String(l[0] || '').trim() === chave);

return [{
  json: {
    encontrou: Boolean(linha),
    data: chave,
    colunas: linha || [],
    total_linhas: linhas.length,
  },
}];
