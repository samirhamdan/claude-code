/**
 * Nó "Monta Entrada" — junta tudo num item só para o nó Agente.
 *
 * O Agente espera `numero`, `texto`, `config`, `historico` e `fatos` no mesmo
 * item. Cada um vem de um lugar diferente do canvas, e é isso que este nó
 * resolve.
 *
 * Nó Code, modo "Run Once for All Items".
 * Posição: depois de `Lê Fatos`, antes de `Agente`.
 *
 * Canvas em volta:
 *   Webhook → Filtra Mensagem → Texto ou Audio
 *                                ├─ (0, texto) ─────────────────┐
 *                                └─ (1, áudio) → Baixa audio →  │
 *                                   Converte Base64 → Audio     │
 *                                   transcreve → Monta payload ─┤
 *                                                               ▼
 *                                                       Carrega Config
 *                                                               ↓
 *                                 Lê Histórico → Lê Fatos → Monta Entrada
 *
 * Dois detalhes do n8n que este nó existe para contornar:
 *
 * 1. Referenciar com `$('nome')` um nó que não rodou **derruba o nó inteiro**.
 *    Numa mensagem de texto, todo o ramo de áudio fica sem executar, então
 *    `$('Monta payload audio')` só pode ser lido atrás de uma guarda.
 *
 * 2. O nó Redis devolve **só** a propriedade que ele setou, descartando o
 *    resto do item. Como `Lê Histórico` e `Lê Fatos` estão em série, o item
 *    que chega aqui tem `fatos_raw` e já perdeu `historico_raw` — por isso o
 *    histórico é lido pelo nome do nó, não de `$input`.
 */

const config = $('Carrega Config').first().json;

function parseLista(bruto) {
  try {
    const v = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

// Lê um nó que pode não ter rodado (ramo condicional). Sem isto, referenciar
// o ramo de áudio numa mensagem de texto derruba o nó inteiro.
function noOpcional(nome) {
  try {
    return $(nome).isExecuted ? $(nome).first().json : null;
  } catch (e) {
    return null;
  }
}

const msg = $('Filtra Mensagem').first().json;
const audio = noOpcional('Monta payload audio');

// Áudio primeiro: quando o ramo rodou, o texto que vale é o transcrito.
const texto = (audio && (audio.texto ?? audio.transcricao ?? audio.text))
  ?? msg.texto ?? msg.conversation ?? msg.mensagem ?? msg.text ?? '';

return [{
  json: {
    numero: String(msg.jid || '').split('@')[0],
    texto,
    config,
    historico: parseLista($('Lê Histórico').first().json.historico_raw),
    fatos: parseLista($input.first().json.fatos_raw),
  }
}];
