/**
 * Substitui o nó Google Sheets "Get Row(s)" com filtro, usando as credenciais
 * do .env em vez da credencial OAuth do n8n — uma fonte de autenticação a
 * menos para manter.
 *
 * Devolve a linha como objeto com as chaves do cabeçalho, igual ao nó do n8n,
 * para os nós seguintes não precisarem mudar.
 *
 * Nó Code, modo "Run Once for All Items".
 * Requer no container: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
 * GOOGLE_REFRESH_TOKEN.
 */

// ─── preencher ───────────────────────────────────────────────────────────
const PLANILHA = 'COLE_O_ID_COMPLETO';   // começa com 19TikjVLF_5o_MaN8LWgPXNR
const ABA = 'Untitled';
const COLUNA_FILTRO = 'Data';            // cabeçalho da coluna de data
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
     + `/values/${encodeURIComponent(`${ABA}!A:Z`)}`,
  headers: { Authorization: `Bearer ${token}` },
  json: true,
});

const linhas = dados.values || [];
if (!linhas.length) {
  throw new Error(`A aba "${ABA}" voltou vazia. Confira o nome da aba e o id da planilha.`);
}

const cabecalho = linhas[0].map((c) => String(c).trim());
const iFiltro = cabecalho.indexOf(COLUNA_FILTRO);
if (iFiltro === -1) {
  throw new Error(
    `Coluna "${COLUNA_FILTRO}" não existe. Cabeçalho lido: ${cabecalho.join(', ')}`
  );
}

// Mesma chave que o nó antigo montava: $now em Campo Grande, formato d/M.
// Sem zero à esquerda — "16/8", não "16/08".
const agora = new Date(Date.now() - 4 * 60 * 60 * 1000);
const chave = `${agora.getUTCDate()}/${agora.getUTCMonth() + 1}`;

const linha = linhas.slice(1).find(
  (l) => String(l[iFiltro] || '').trim() === chave
);

if (!linha) {
  // Sem linha para hoje não é erro: o plano pode simplesmente não cobrir a data.
  // Quem monta a mensagem decide se omite a seção.
  return [{ json: { encontrou: false, [COLUNA_FILTRO]: chave } }];
}

// Monta o objeto com as chaves do cabeçalho, como o nó do n8n devolvia.
const item = { encontrou: true };
cabecalho.forEach((nome, i) => {
  if (nome) item[nome] = linha[i] ?? '';
});

return [{ json: item }];
