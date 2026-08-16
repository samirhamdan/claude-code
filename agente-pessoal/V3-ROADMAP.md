# Agente Pessoal v3 — as 15 competências, por custo

Ordenadas por esforço de construção sobre a arquitetura do v2, não por
importância. Cada linha é entregável sozinha.

---

## O que o v2 mudou no cálculo

O laço de tool use significa que **adicionar competência é adicionar
ferramenta**. Não há mais roteamento nem classificação para mexer: escreve
o schema, escreve o executor, e o modelo passa a usar quando fizer sentido.

Isso barateia radicalmente o que é *integração*. Não barateia nada do que é
*julgamento* ou *iniciativa*.

---

## Já pronto

| # | Competência | Onde |
|---|---|---|
| 2 | Gestão de tarefas | `criar_tarefa`, `listar_tarefas` — Trello |
| 9 | Organização financeira | `registrar_gasto`, `registrar_conta`, `listar_contas`, `consultar_orcamento`, `definir_orcamento` — planilha |
| 8 | Pesquisa na internet | `web_search`, `web_fetch` — server-side, sem executor |
| 1 | Agenda | `criar_evento`, `listar_eventos`, `cancelar_evento` — Google Calendar |
| 10 | Memória pessoal | histórico no Redis + `lembrar_fato` / `esquecer_fato` |
| 3 | Lembretes | workflow `Resumo do Dia`, cron diário |

Restam nove das quinze. As seis acima foram feitas em uma sessão, o que é
menos sobre velocidade e mais sobre o laço de tool use: cinco delas foram
ferramenta nova em arquivo existente, sem tocar no fluxo.

---

## Ordem de construção

### 1. Pesquisa na internet (#8) — ✅ feito

**A mais barata da lista, e de uso diário.**

Web search na API da Anthropic é ferramenta *server-side*: declara no array
`ferramentas` e a Anthropic executa. Não tem executor no `switch`, não tem
credencial, não tem chave nova no `.env`.

```javascript
{ type: 'web_search_20260209', name: 'web_search' },
{ type: 'web_fetch_20260209',  name: 'web_fetch'  },
```

O `web_fetch` complementa: lê uma URL específica que apareceu na conversa.

- **Construção:** cinco linhas
- **Custo de operação:** ~US$ 0,01 por busca, mais os tokens do resultado
- **Depende de:** nada
- **Cuidado:** os resultados entram no contexto e são a maior fonte de token
  desta lista. A versão `_20260209` filtra antes de entregar, o que ajuda.

### 2. Agenda (#1) — ✅ feito

Maior buraco funcional hoje. Não se administra o dia de alguém sem ver a
agenda dela.

- **Construção:** Google Calendar API, mesmo padrão OAuth que a planilha já
  usa — dá para reaproveitar o refresh token adicionando o escopo
- **Custo:** desprezível
- **Depende de:** nada
- **Destrava:** lembretes (#3), planejamento (#15), reuniões

### 3. Memória de fatos (#10) — ✅ feito

O v2 lembra da **conversa**, não lembra **de você**. "A internet vence dia
10", "o João é o fornecedor de peças" — isso é fato, não histórico.

- **Construção:** tabela `fatos` ou coluna JSONB em `usuarios`, duas
  ferramentas (`lembrar_fato`, `esquecer_fato`), fatos injetados no system
  prompt
- **Custo:** ~200 tokens por chamada — fração do que um histórico longo custaria
- **Depende de:** nada
- **Destrava:** planejamento pessoal (#15), e é o que faz o agente parecer
  pessoal em vez de genérico

### 4. Lembretes ativos (#3) — ✅ feito (workflow Resumo do Dia)

Hoje existe prazo no card do Trello, mas ninguém cobra. Falta a cobrança.

- **Construção:** cron que varre prazos e manda mensagem
- **Depende de:** agenda (#2 desta lista) para não avisar em cima de
  compromisso

### 5. Contatos (#6) — baixa

- **Construção:** tabela no Postgres, duas ferramentas
- **Depende de:** nada
- **Destrava:** follow-up (#14)

### 6. Follow-up (#14) — média

"Você mandou proposta pro João há 5 dias e ele não respondeu."

- **Construção:** cron mais estado de "aguardando resposta"
- **Depende de:** contatos, e de alguma disciplina de registro

### 7. Compras e listas (#13) — trivial

É tarefa com outro nome. Reaproveita o Trello, talvez uma lista dedicada.

### 8. Projetos (#11) — baixa

Estrutura de listas e labels no Trello, mais prompt. Pouco código novo.

### 9. Planejamento pessoal (#15) — média

Transformar objetivo em plano e cobrar execução.

- **Construção:** majoritariamente prompt sobre dado que já existe
- **Depende de:** fatos e agenda — sem eles vira conselho genérico

### 10. Documentos (#7) — média

Atas, relatórios, propostas.

- **Construção:** Google Docs/Drive API — superfície nova, mas direta
- **Nota:** é aqui que RAG passa a fazer sentido (ver abaixo)

### 11. Comunicação (#5) — média, com risco

Preparar mensagem adaptando o tom ao destinatário.

- **Risco:** rascunho é útil; enviar sozinho manda mensagem errada pra
  pessoa errada. Manter no rascunho.

### 12. E-mail (#4) — alta

A API do Gmail é tranquila. O problema é volume e risco.

- **Custo de operação:** alto — caixa real gera muito token
- **Risco:** classificar e responder por cima de e-mail de verdade é
  superfície grande, e o erro é caro
- **Se for fazer:** começa só lendo e resumindo, nunca respondendo

### 13. Viagens (#12) — alta

- **Construção:** muitas integrações (voo, hotel, transporte)
- **Frequência de uso:** baixa
- **Pior relação esforço/uso da lista.** Deixaria por último ou fora.

---

## Sobre RAG

Viável tecnicamente — o Postgres já está de pé e `pgvector` é uma extensão.
Mas hoje seria a ferramenta errada em dois dos três casos.

| Dado | RAG serve? | Por quê |
|---|---|---|
| Planilha, Trello, contas | **Não** | É consulta exata, não busca aproximada. "Quanto gastei em julho" é uma soma de linhas. |
| Histórico de conversa | **Não** | O que se quer de um ano de conversa é o *fato* que ficou nela. Fato guardado está sempre lá; recuperado por similaridade vem com ruído e às vezes não vem. |
| Documentos (#7) | **Sim** | Texto corrido, acervo que não cabe no contexto, sem estrutura consultável. |

A camada de fatos é uma recuperação curada — a curadoria acontece na
**escrita**, quando o modelo aprende a coisa, em vez de na leitura por
similaridade. Para escala de assistente pessoal isso ganha de RAG quase
sempre, e custa uma fração.

Reavaliar quando existir acervo de documentos.

---

## Fora das 15, mas é o que separa assistente de chatbot

**Proatividade.** Hoje o agente é reativo: só existe quando chega mensagem.
Proativo é um cron que acorda, varre o estado e **decide se vale
interromper**.

Três partes:

1. O gatilho — cron algumas vezes ao dia
2. O varredor — o que mudou: contas vencendo, cards atrasados, orçamento
   estourando, follow-up vencido
3. O juízo — se aquilo merece uma mensagem *agora*

A parte 3 é onde esse tipo de projeto morre. Assistente proativo mal
calibrado vira notificação, e notificação vira silenciado. A régua tem que
ser alta: só fala quando a pessoa teria ficado pior sem a mensagem.

O briefing das 8h já é proatividade primitiva — horário fixo, conteúdo fixo.
A versão boa é condicional, e só vale depois que houver estado suficiente
para valer a pena varrer (itens 2 a 6 desta ordem).

---

## O que não fazer

**Não especificar 100 funções antes de construir a primeira.** O v2 chegou
onde chegou uma ferramenta por vez, testada antes da seguinte — e boa parte
das descobertas só apareceu no teste: a aba chamada `Untitled`, o `fetch`
que não existe no task runner, o refresh token de 7 dias. Especificação
grande não sobrevive à terceira ferramenta.

**Não começar por e-mail.** É o que mais parece produtivo no papel e mais
consome tempo na prática.

**Não construir onboarding enquanto houver um usuário.** Um `UPDATE` na
tabela resolve o mesmo em dez segundos.
