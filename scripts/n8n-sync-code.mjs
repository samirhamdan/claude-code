#!/usr/bin/env node
/**
 * Injeta os arquivos .js do repo dentro do `jsCode` dos nós Code nos exports
 * de workflow do n8n.
 *
 * Por que existe: o n8n não tem import. O código de um nó Code mora dentro do
 * JSON do workflow. Quando o mesmo nó aparece em dois workflows — o `Agente`
 * está no `Agente Pessoal v2` e no `Resumo do Dia` — manter as duas cópias na
 * mão garante que uma vai ficar para trás, e foi o que aconteceu: a cópia do
 * `Resumo do Dia` passou semanas sem `concluir_tarefa` e `arquivar_tarefa`.
 *
 * Aqui o .js é a fonte e o JSON é gerado.
 *
 *   node scripts/n8n-sync-code.mjs           # grava
 *   node scripts/n8n-sync-code.mjs --check   # só acusa divergência, sai 1
 *
 * Depois de gravar, suba para a VPS pela API REST do n8n. Nunca por import
 * manual — ver a seção Convenções do CLAUDE.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Cada linha é: este arquivo .js é o conteúdo deste nó neste workflow.
// O mapeamento é explícito de propósito — há nós com o mesmo nome e código
// diferente. O `Monta Entrada` do `Resumo do Dia` não é o mesmo do v2: aquele
// vem de cron e não tem histórico nem ramo de áudio.
const MAPA = [
  {
    js: 'agente-pessoal/no_agente.js',
    workflow: 'agente-pessoal/resumo-do-dia.json',
    no: 'Agente',
  },
  // Quando o `Agente Pessoal v2` for exportado com o scripts/n8n-pull.sh,
  // acrescente aqui as duas linhas dele:
  //   { js: 'agente-pessoal/no_agente.js',     workflow: '...v2.json', no: 'Agente' },
  //   { js: 'agente-pessoal/monta_entrada.js', workflow: '...v2.json', no: 'Monta Entrada' },
];

const conferir = process.argv.includes('--check');

// O export do n8n é exatamente JSON.stringify(wf, null, 2), sem newline no
// fim. Manter o mesmo formato é o que faz o diff mostrar só o código que
// mudou, em vez do arquivo inteiro.
function serializa(wf) {
  return JSON.stringify(wf, null, 2);
}

// Um workflow pode receber mais de um nó, então os arquivos são carregados,
// alterados e gravados uma vez só no fim.
const workflows = new Map();

function carrega(rel) {
  if (!workflows.has(rel)) {
    const abs = path.join(RAIZ, rel);
    const texto = fs.readFileSync(abs, 'utf8');
    workflows.set(rel, { abs, original: texto, wf: JSON.parse(texto) });
  }
  return workflows.get(rel);
}

const divergentes = [];

for (const item of MAPA) {
  const codigo = fs.readFileSync(path.join(RAIZ, item.js), 'utf8');
  const { wf } = carrega(item.workflow);

  const no = wf.nodes.find((n) => n.name === item.no);
  if (!no) {
    console.error(
      `Nó "${item.no}" não existe em ${item.workflow}.\n`
      + `Nós disponíveis: ${wf.nodes.map((n) => n.name).join(', ')}`
    );
    process.exit(1);
  }
  if (no.type !== 'n8n-nodes-base.code') {
    console.error(`Nó "${item.no}" em ${item.workflow} não é um Code node (${no.type}).`);
    process.exit(1);
  }

  if (no.parameters.jsCode === codigo) continue;

  divergentes.push(`${item.workflow} → ${item.no} (de ${item.js})`);
  no.parameters.jsCode = codigo;
}

if (conferir) {
  if (divergentes.length) {
    console.error('Código divergente entre o .js e o JSON do workflow:');
    for (const d of divergentes) console.error(`  - ${d}`);
    console.error('\nRode: node scripts/n8n-sync-code.mjs');
    process.exit(1);
  }
  console.log(`Tudo sincronizado (${MAPA.length} nó(s) conferido(s)).`);
  process.exit(0);
}

if (!divergentes.length) {
  console.log(`Nada a fazer (${MAPA.length} nó(s) já sincronizado(s)).`);
  process.exit(0);
}

for (const { abs, original, wf } of workflows.values()) {
  const novo = serializa(wf);
  if (novo !== original) fs.writeFileSync(abs, novo);
}

console.log('Sincronizado:');
for (const d of divergentes) console.log(`  - ${d}`);
console.log('\nFalta subir para o n8n pela API REST — o arquivo aqui é só a fonte.');
