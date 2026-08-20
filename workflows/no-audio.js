/**
 * Ramo de áudio — os dois nós Code que cercam a transcrição.
 *
 * Fluxo:
 *
 *   Filtra Mensagem
 *     ├─ Só Texto ────────────────────────────────────────────┐
 *     └─ Só Áudio                                             │
 *          ↓                                                  │
 *        Baixa Áudio (HTTP → Evolution getBase64FromMediaMessage)
 *          ↓                                                  │
 *        Converte Base64 (Code, este arquivo, modo="binario") │
 *          ↓                                                  │
 *        Transcreve (HTTP → Groq, multipart)                  │
 *          ↓                                                  │
 *        Monta Texto (Code, este arquivo, modo="texto") ──────┤
 *                                                             ▼
 *                                                        Lê Buffer
 *
 * Os dois ramos entram no mesmo `Lê Buffer`. Só um deles roda por mensagem —
 * o outro morreu com `[]` lá no roteador — e é por isso que quem vem depois
 * precisa perguntar qual rodou em vez de assumir.
 *
 * Nó Code, modo "Run Once for All Items".
 * Requer no container: GROQ_API_KEY (o nó Transcreve usa).
 */

// ─── ao colar, ajuste só isto ────────────────────────────────────────────
const MODO = 'binario'; // 'binario' depois do Baixa Áudio, 'texto' depois do Transcreve
// ─────────────────────────────────────────────────────────────────────────

const ctx = this;
const entrada = $input.first().json;

if (MODO === 'binario') {
  // A Evolution devolve o arquivo em base64 dentro do JSON. O nó Transcreve
  // manda multipart para o Groq, e multipart precisa de binário de verdade —
  // é esta a conversão.
  const b64 = String(entrada.base64 ?? entrada.media ?? '').trim();
  if (!b64) {
    throw new Error(
      'A Evolution não devolveu base64. Confira se o Baixa Áudio está usando '
      + 'POST /chat/getBase64FromMediaMessage/{instancia} e mandando o id da '
      + 'mensagem no corpo.'
    );
  }

  // O WhatsApp manda voz em Opus dentro de container OGG. O Groq aceita ogg,
  // então não há conversão a fazer — só embrulhar.
  const mime = String(entrada.mimetype ?? 'audio/ogg').split(';')[0];

  return [{
    json: {},
    binary: {
      data: await ctx.helpers.prepareBinaryData(
        Buffer.from(b64, 'base64'), 'audio.ogg', mime
      ),
    },
  }];
}

if (MODO === 'texto') {
  // Resposta do Groq: { text: "..." }
  const texto = String(entrada.text ?? entrada.texto ?? '').trim();

  // Transcrição vazia é áudio que não deu para entender — barulho, engano de
  // botão, três segundos de silêncio. Devolver `[]` faria o lead sumir sem
  // resposta; melhor pedir que repita, e é o Qualifica quem redige isso.
  const daFiltra = $('Filtra Mensagem').first().json;

  return [{
    json: {
      jid: daFiltra.jid,
      telefone: daFiltra.telefone,
      nome_whatsapp: daFiltra.nome_whatsapp,
      instancia: daFiltra.instancia,
      tipo: 'audio',
      transcricao_vazia: texto.length === 0,
      texto: texto || '[o lead mandou um áudio que não deu para entender]',
    },
  }];
}

throw new Error(`MODO inválido: "${MODO}". Use 'binario' ou 'texto'.`);
