/**
 * Nó Agente — Loop de Tool Use
 *
 * Entrada esperada:
 * - $json.numero (WhatsApp)
 * - $json.texto (mensagem do usuário)
 * - $json.config (SELECT do Postgres com usuário)
 *
 * Saída:
 * - $json.resposta (texto final)
 * - $json.ferramentas_usadas (array de calls)
 */

const Anthropic = require("@anthropic-ai/sdk").default;

// Inicializar cliente
const client = new Anthropic({
  apiKey: $env.ANTHROPIC_API_KEY,
});

// Config do usuário (vem do nó anterior)
const config = $json.config;
const numero = $json.numero;
const texto = $json.texto;

// Montarystem prompt com config
const systemPrompt = `Você se chama ${config.nome_assistente || "Assistente"}.
Fale de forma ${config.tom || "profissional"}.
Responda em ${config.idioma || "pt-BR"}.

Você é o assistente pessoal de ${config.nome} pelo WhatsApp.

Hoje é ${new Date().toLocaleDateString("pt-BR")}, fuso de Campo Grande, UTC-4.

## Regras
- Mensagens curtas, 2 a 6 linhas. Formatação: *negrito*, _itálico_.
- Use ferramentas quando precisar de dado real. Nunca invente.
- Pode chamar mais de uma ferramenta antes de responder.
- Após registrar gasto, consulte o orçamento da categoria.
- Se o orçamento passou de 80%, alerte. Se passou de 100%, alerte com urgência.
- Quando registrar gasto em categoria sem limite, pergunte se quer definir um.
- Responda direto, sem preâmbulo.

## Sobre tarefas
- Títulos começando por verbo no infinitivo.
- "O que tenho pra hoje" = listar_tarefas(hoje).

## Sobre contas
- "Contas para vencer" mostra a pagar e a receber separados.

## Limites
- Não envia e-mail, não apaga nada, não fala com terceiros.
`;

// Definição das ferramentas
const tools = [
  {
    name: "criar_tarefa",
    description: "Criar uma tarefa no Trello",
    input_schema: {
      type: "object",
      properties: {
        titulo: { type: "string", description: "Título da tarefa (verbo no infinitivo)" },
        descricao: { type: "string", description: "Descrição opcional" },
        prazo: { type: "string", description: "Prazo em ISO 8601 (opcional)" },
      },
      required: ["titulo"],
    },
  },
  {
    name: "registrar_gasto",
    description: "Registrar um gasto na planilha",
    input_schema: {
      type: "object",
      properties: {
        descricao: { type: "string" },
        valor: { type: "number" },
        categoria: { type: "string" },
        data: { type: "string", description: "YYYY-MM-DD (default hoje)" },
      },
      required: ["descricao", "valor", "categoria"],
    },
  },
  {
    name: "registrar_conta",
    description: "Registrar uma conta a pagar/receber",
    input_schema: {
      type: "object",
      properties: {
        descricao: { type: "string" },
        valor: { type: "number" },
        dia: { type: "number", description: "Dia do mês (1-31)" },
        categoria: { type: "string" },
        tipo: { type: "string", enum: ["fixa", "parcelada"] },
        fluxo: { type: "string", enum: ["pagar", "receber"] },
      },
      required: ["descricao", "valor", "dia", "categoria", "tipo", "fluxo"],
    },
  },
  {
    name: "definir_orcamento",
    description: "Definir limite de orçamento para uma categoria",
    input_schema: {
      type: "object",
      properties: {
        categoria: { type: "string" },
        limite: { type: "number" },
      },
      required: ["categoria", "limite"],
    },
  },
  {
    name: "listar_tarefas",
    description: "Listar tarefas do Trello",
    input_schema: {
      type: "object",
      properties: {
        filtro: {
          type: "string",
          enum: ["hoje", "semana", "atrasados", "todos"],
        },
      },
      required: ["filtro"],
    },
  },
  {
    name: "consultar_gastos",
    description: "Consultar gastos na planilha",
    input_schema: {
      type: "object",
      properties: {
        periodo: { type: "string", enum: ["ontem", "semana", "mes"] },
        categoria: { type: "string", description: "Opcional" },
      },
      required: ["periodo"],
    },
  },
  {
    name: "listar_contas",
    description: "Listar contas a pagar/receber",
    input_schema: {
      type: "object",
      properties: {
        periodo: {
          type: "string",
          enum: ["proximos_dias", "mes", "atrasadas"],
        },
      },
      required: ["periodo"],
    },
  },
  {
    name: "consultar_orcamento",
    description: "Consultar orçamento por categoria",
    input_schema: {
      type: "object",
      properties: {
        categoria: { type: "string", description: "Opcional — se vazio, retorna todas" },
      },
    },
  },
];

// Loop de tool use
async function runAgent() {
  let messages = [
    {
      role: "user",
      content: texto,
    },
  ];

  let voltas = 0;
  const maxVoltas = 5;
  let ferramentasUsadas = [];

  while (voltas < maxVoltas) {
    voltas++;
    console.log(`[Volta ${voltas}] Chamando Claude...`);

    // Chamar Claude
    const response = await client.messages.create({
      model: "claude-opus-4-1",
      max_tokens: 1024,
      system: systemPrompt,
      tools: tools,
      messages: messages,
    });

    // Verificar resposta
    if (response.stop_reason === "end_turn") {
      // Só texto, retornar
      const textBlock = response.content.find((b) => b.type === "text");
      if (textBlock) {
        return {
          resposta: textBlock.text,
          ferramentas_usadas: ferramentasUsadas,
          voltas: voltas,
        };
      }
    }

    // Processar tool_use
    if (response.stop_reason === "tool_use") {
      for (const block of response.content) {
        if (block.type === "tool_use") {
          const toolName = block.name;
          const toolInput = block.input;
          const toolUseId = block.id;

          console.log(`[Tool] Executando: ${toolName}`, toolInput);
          ferramentasUsadas.push({
            ferramenta: toolName,
            input: toolInput,
            volta: voltas,
          });

          // AQUI: Executar a ferramenta
          // Por enquanto, mock. Em produção: chamar HTTP, Sheets API, etc.
          let toolResult = `✅ ${toolName} executado com sucesso`;

          // Adicionar à messages para próxima volta
          messages.push({
            role: "assistant",
            content: response.content,
          });

          messages.push({
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: toolUseId,
                content: toolResult,
              },
            ],
          });
        }
      }
    }
  }

  // Se saiu do loop sem resposta
  return {
    resposta: "Não consegui concluir a solicitação. Tenta de novo?",
    ferramentas_usadas: ferramentasUsadas,
    voltas: voltas,
  };
}

// Executar
runAgent().then((resultado) => {
  return {
    resposta: resultado.resposta,
    ferramentas_usadas: resultado.ferramentas_usadas,
    voltas: resultado.voltas,
  };
});
