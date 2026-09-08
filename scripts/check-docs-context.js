#!/usr/bin/env node
// scripts/check-docs-context.js
// Verificador documental de DOCS-CONTEXT-1 — sin dependencias externas.
// Comprueba, sobre el árbol de documentación (nunca sobre el juego):
//   1. Que cada referencia a un documento .md citado en el texto (entre
//      backticks o como enlace Markdown) apunta a un fichero que existe.
//   2. Que todo documento bajo docs/ es alcanzable desde al menos un
//      índice raíz (CLAUDE.md, DESIGN.md, docs/STATUS.md,
//      docs/EPIC_CONTEXT.md, docs/ROADMAP.md, docs/CODE_MAP.md,
//      docs/epics/README.md), siguiendo referencias de forma transitiva.
//   3. Que docs/reference/LEGACY_MAP.md señala siempre un destino real
//      (o un marcador explícito de "sin rango"/"pendiente").
// No ejecuta nada del motor del juego ni requiere red ni npm install.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function listMarkdownFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      listMarkdownFiles(full, acc);
    } else if (entry.name.endsWith('.md')) {
      acc.push(full);
    }
  }
  return acc;
}

const rootDocs = ['CLAUDE.md', 'DESIGN.md', 'CHANGELOG.md', 'README.md']
  .map((f) => path.join(ROOT, f))
  .filter((f) => fs.existsSync(f));
const docsDir = path.join(ROOT, 'docs');
const allDocs = [...rootDocs, ...(fs.existsSync(docsDir) ? listMarkdownFiles(docsDir) : [])];

// --- 1. References resolve to real files -----------------------------
const REF_RE = /(?:`|\()((?:docs\/|CLAUDE\.md|DESIGN\.md|CHANGELOG\.md|README\.md)[A-Za-z0-9_\-./]*\.md)(?:`|\))/g;

let brokenRefs = 0;
let totalRefs = 0;
const referencedBy = new Map(); // absolute path -> Set of referrer paths

for (const file of allDocs) {
  const content = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = REF_RE.exec(content))) {
    totalRefs += 1;
    const refPath = m[1];
    const abs = path.join(ROOT, refPath);
    if (!fs.existsSync(abs)) {
      brokenRefs += 1;
      console.error(`[ROTO] ${path.relative(ROOT, file)} referencia "${refPath}" que no existe`);
      continue;
    }
    if (!referencedBy.has(abs)) referencedBy.set(abs, new Set());
    referencedBy.get(abs).add(file);
  }
}

// --- 2. Reachability from index roots ---------------------------------
const indexRoots = [
  // Documentos que una sesión abre directamente (puntos de entrada reales),
  // no solo los alcanzables por enlace desde otro documento.
  'CLAUDE.md', 'DESIGN.md', 'CHANGELOG.md', 'README.md',
  'docs/STATUS.md', 'docs/EPIC_CONTEXT.md', 'docs/ROADMAP.md',
  'docs/CODE_MAP.md', 'docs/epics/README.md',
].map((f) => path.join(ROOT, f));

const reachable = new Set();
const queue = [...indexRoots];
while (queue.length) {
  const cur = queue.shift();
  const key = path.resolve(cur);
  if (reachable.has(key)) continue;
  if (!fs.existsSync(key)) continue;
  reachable.add(key);
  const content = fs.readFileSync(key, 'utf8');
  let m;
  const re = new RegExp(REF_RE);
  while ((m = re.exec(content))) {
    const abs = path.resolve(ROOT, m[1]);
    if (!reachable.has(abs)) queue.push(abs);
  }
}

const unreachable = allDocs.filter((f) => {
  const rel = path.relative(ROOT, f);
  // docs/history and docs/epics entries are intentionally reached only via
  // their own README/index, which IS in indexRoots, so this is still valid.
  return !reachable.has(path.resolve(f)) && rel !== 'README.md';
});

if (unreachable.length) {
  console.error('\n[NO ALCANZABLE desde ningún índice raíz]');
  for (const f of unreachable) console.error(' - ' + path.relative(ROOT, f));
}

// --- 3. LEGACY_MAP destinations sanity check ---------------------------
const legacyMapPath = path.join(ROOT, 'docs/reference/LEGACY_MAP.md');
let legacyIssues = 0;
if (fs.existsSync(legacyMapPath)) {
  const content = fs.readFileSync(legacyMapPath, 'utf8');
  const rowRe = /\|\s*\d+\s*\|[^|]*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/g;
  let m;
  while ((m = rowRe.exec(content))) {
    const dest = m[1].trim();
    const treatment = m[2].trim();
    if (dest === '—' || dest.startsWith('(sin rango')) continue;
    if (treatment.includes('consolidado') || treatment.includes('pendiente de aclaración')) continue;
    // dest may be "path.md" or "path.md (§n)"
    const destPath = dest.split(' ')[0];
    if (!destPath.endsWith('.md')) continue;
    const abs = path.join(ROOT, destPath);
    if (!fs.existsSync(abs)) {
      legacyIssues += 1;
      console.error(`[LEGACY_MAP] destino inexistente: "${destPath}"`);
    }
  }
}

// --- Summary -------------------------------------------------------------
console.log('\n=== check-docs-context.js ===');
console.log(`Documentos escaneados: ${allDocs.length}`);
console.log(`Referencias .md encontradas: ${totalRefs}, rotas: ${brokenRefs}`);
console.log(`No alcanzables desde índices raíz: ${unreachable.length}`);
console.log(`Problemas en LEGACY_MAP.md: ${legacyIssues}`);

const failed = brokenRefs > 0 || unreachable.length > 0 || legacyIssues > 0;
if (failed) {
  console.error('\nFALLÓ — ver detalle arriba.');
  process.exit(1);
} else {
  console.log('\nOK — sin referencias rotas, todo alcanzable, LEGACY_MAP consistente.');
}
