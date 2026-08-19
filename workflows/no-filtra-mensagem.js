/**
 * Nó "Filtra Mensagem" — primeira porta do fluxo.
 *
 * Descarta o que não é conversa de lead e normaliza o que sobra num item
 * único: jid, telefone, texto. Tudo depois deste nó pode confiar nesses três.
 *
 * Devolver `[]` mata o ramo — é assim que o n8n para um fluxo sem precisar de
 * nó IF. Execução descartada aparece como sucesso em milissegundos, o que é
 * o esperado e não é erro.
 *
 * Nó Code, modo "Run Once for All Items".
 */

const corpo = $input.first().json.body ?? $input.first().json;
const dados = corpo.data ?? {};
const chave = dados.key ?? {};

// A inscrição do webhook já é allow-list de MESSAGES_UPSERT, mas a Evolution
// muda o default entre versões e o global pode ser religado por engano. Uma
// linha aqui é mais barata que descobrir de novo por que a fila encheu.
if (corpo.event && corpo.event !== 'messages.upsert') return [];

const jid = String(chave.remoteJid ?? '');

// Mensagem que o próprio bot enviou volta como evento. Sem isto ele responde
// a si mesmo, em laço.
if (chave.fromMe === true) return [];

// Grupo. O groupsIgnore da instância já barra, mas vale a trava dupla —
// SDR respondendo grupo é vexame na frente dos clientes do cliente.
if (jid.endsWith('@g.us')) return [];

// Status/broadcast do WhatsApp não é conversa.
if (jid.startsWith('status@')) return [];

const msg = dados.message ?? {};

// O texto vem em lugares diferentes conforme o tipo. Só estes dois são
// mensagem digitada; o resto (imagem, áudio, localização, contato) ainda não
// é tratado neste fluxo.
const texto = String(
  msg.conversation
  ?? msg.extendedTextMessage?.text
  ?? ''
).trim();

if (!texto) return [];

const telefone = jid.split('@')[0].split(':')[0];
if (!telefone) return [];

return [{
  json: {
    jid,
    telefone,
    texto,
    nome_whatsapp: dados.pushName ?? null,
    instancia: corpo.instance ?? null,
  },
}];
