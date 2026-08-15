# Agente Pessoal v3 — leitura do escopo

Avaliação das 20 competências propostas, ordenadas por custo de construção
sobre a arquitetura que o v2 já tem.

---

## O que o v2 mudou no cálculo

O laço de tool use significa que **adicionar competência é adicionar
ferramenta**. Não precisa mexer no fluxo, no roteamento, nem no prompt de
classificação — não existe mais roteamento nem classificação. Escreve o
schema, escreve o executor, e o modelo passa a usar quando fizer sentido.

Isso barateia radicalmente as competências que são *integração*. Não
barateia em nada as que são *julgamento* ou *iniciativa*.

Por isso a lista abaixo separa por natureza, não por ordem de importância.

---

## Já existe

| # | Competência | Onde está |
|---|---|---|
| 2 | Gestão de tarefas | `criar_tarefa`, `listar_tarefas` (Trello) |
| 9 | Organização financeira | `registrar_gasto`, `registrar_conta`, `listar_contas`, `consultar_orcamento`, `definir_orcamento` |
| 3 | Lembretes | parcial — prazo no card do Trello, sem cobrança ativa |
| 10 | Memória pessoal | parcial — histórico de conversa no Redis, sem camada de fatos |

---

## Barato — uma ferramenta cada, padrão já provado

| # | Competência | Nota |
|---|---|---|
| 1 | **Agenda** | Google Calendar. É o maior buraco funcional hoje: não dá para administrar o dia de alguém sem ver a agenda. API limpa, escopo bem definido. |
| 6 | Contatos | Tabela no Postgres + duas ferramentas. Vira base para follow-up e para a competência 14. |
| 8 | Pesquisa | Web search. Uma ferramenta. |
| 13 | Compras e listas | É tarefa com outro nome — reaproveita o Trello. |
| 11 | Projetos | Estrutura de listas no Trello, não código novo. |

## Médio — precisa de dado que ainda não existe

| # | Competência | O que falta antes |
|---|---|---|
| 7 | Documentos | Google Docs/Drive API. Direto, mas é superfície nova. |
| 16 | Prioridades | Precisa da agenda (1) para saber o que cabe no dia. Depois é prompt sobre dado que já existe. |
| 18 | Reuniões | Depende de agenda (1) e documentos (7). |
| 15 | Planejamento pessoal | Depende da camada de fatos (ver abaixo). |
| 17 | Decisão assistida | Pesquisa (8) mais prompt. Pouco código, muito ajuste de prompt. |

## Caro ou arriscado

| # | Competência | Por quê |
|---|---|---|
| 4 | **E-mail** | Tecnicamente a API do Gmail é tranquila. O problema é o volume e o risco: classificar e responder por cima de uma caixa real é superfície grande, e um erro manda mensagem errada para pessoa errada. Se for fazer, começa só lendo e resumindo — nunca respondendo. |
| 5 | Comunicação em nome do usuário | Mesmo risco do 4, sem a compensação. Preparar rascunho é útil; enviar sozinho, não. |
| 12 | Viagens | Muitas integrações, uso raro. Pior relação esforço/frequência da lista. |
| 19 | Rotina / padrões | Precisa de meses de histórico acumulado antes de ter o que detectar. Não dá para construir agora — dá para começar a *guardar* agora. |
| 20 | **Proatividade** | A mais valiosa e a mais difícil. Ver seção própria. |

---

## As duas coisas que a arquitetura atual não resolve

Adicionar ferramenta é barato. Estas duas não são ferramenta.

### Camada de fatos

O v2 lembra da **conversa** (20 mensagens no Redis), não lembra **de você**.
"Samir prefere ser chamado assim", "a internet vence dia 10", "o João é o
fornecedor de peças" — isso não é histórico, é fato, e precisa entrar em
todo turno por um caminho barato.

Concretamente: uma tabela `fatos` (ou uma coluna JSONB em `usuarios`), duas
ferramentas (`lembrar_fato`, `esquecer_fato`), e os fatos injetados no
system prompt. Custa ~200 tokens por chamada em vez dos milhares que um
histórico longo custaria.

É pré-requisito das competências 10, 15 e 19, e é o que faz o agente
parecer pessoal em vez de genérico.

### Proatividade

Hoje o agente é **reativo**: só existe quando chega mensagem. Proatividade
é um formato diferente — um cron que acorda, olha o estado do mundo, e
decide se vale interromper.

Três partes, nenhuma delas é ferramenta:

1. **O gatilho** — cron que roda algumas vezes ao dia
2. **O varredor** — junta o que mudou: contas vencendo, cards atrasados, orçamento estourando, follow-up vencido
3. **O juízo** — decidir se aquilo merece uma mensagem *agora*

A parte 3 é a difícil, e é onde esse tipo de projeto costuma morrer. Um
assistente proativo mal calibrado vira notificação, e notificação vira
silenciado. A régua tem que ser alta: só fala quando a pessoa teria ficado
pior sem a mensagem.

O briefing das 8h já é uma proatividade primitiva — horário fixo, conteúdo
fixo. A versão boa é condicional.

---

## Ordem sugerida

1. **Agenda (1)** — maior buraco funcional, integração limpa, destrava 16 e 18
2. **Camada de fatos** — barata, e é o que torna o agente pessoal
3. **Contatos (6) + follow-up (14)** — a dupla que fecha o lado relacionamento
4. **Proatividade (20)** — só depois que houver estado suficiente para valer a pena varrer

Cada uma dessas é entregável sozinha. Nenhuma exige refazer o que existe.

---

## Sobre RAG

Viável tecnicamente — o Postgres já está de pé e `pgvector` é uma extensão.
Mas hoje seria a ferramenta errada em dois dos três casos.

| Dado | RAG serve? | Por quê |
|---|---|---|
| Planilha, Trello, contas | **Não** | É consulta exata, não busca aproximada. "Quanto gastei em julho" é uma soma de linhas. Recuperar por similaridade daria resposta pior que a ferramenta atual. |
| Histórico de conversa | **Não** | O que se quer de um ano de conversa é o *fato* que ficou nela, não a conversa. Fato guardado está sempre lá; fato recuperado por similaridade vem com ruído e às vezes não vem. |
| Documentos (competência 7) | **Sim** | Texto corrido, acervo que não cabe no contexto, sem estrutura consultável. É o problema que RAG resolve bem. |

A camada de fatos é uma recuperação curada — a curadoria acontece na
**escrita**, feita pelo modelo quando aprende a coisa, em vez de na leitura
por similaridade. Para escala de assistente pessoal isso ganha de RAG quase
sempre, e custa uma fração.

Conclusão: não agora. Reavaliar quando existir acervo de documentos.

---

## O que não fazer

**Não construir a matriz de 100 funções antes de construir a primeira.**
O v2 chegou onde chegou por uma ferramenta de cada vez, testada antes da
seguinte. Uma especificação de 100 funções não sobrevive ao contato com a
terceira.

**Não começar por e-mail.** É a competência que mais parece produtiva no
papel e mais consome tempo na prática.

**Não construir onboarding enquanto houver um usuário.** Continua valendo.
