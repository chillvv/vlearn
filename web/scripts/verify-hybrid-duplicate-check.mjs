import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(currentFilePath), '..');
const tempDir = path.join(projectRoot, '.tmp-hybrid-check');
const duplicateCheckSource = path.join(projectRoot, 'src', 'app', 'lib', 'duplicateCheck.ts');
const duplicateCheckBuildPath = path.join(tempDir, 'duplicateCheck.js');
const draftReviewPath = path.join(projectRoot, 'src', 'app', 'pages', 'DraftReviewPage.tsx');
const apiPath = path.join(projectRoot, 'src', 'app', 'lib', 'api.ts');

fs.rmSync(tempDir, { recursive: true, force: true });
fs.mkdirSync(tempDir, { recursive: true });

const duplicateCheckTs = fs.readFileSync(duplicateCheckSource, 'utf8');
const transpiled = ts.transpileModule(duplicateCheckTs, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ES2020,
  },
});
fs.writeFileSync(duplicateCheckBuildPath, transpiled.outputText, 'utf8');

const duplicateModule = await import(pathToFileURL(duplicateCheckBuildPath).href);
const { analyzeDuplicatePair, analyzeDuplicateAgainstCandidates, normalizeTextForDuplicateCheck } = duplicateModule;

const scenarioExact = analyzeDuplicatePair(
  normalizeTextForDuplicateCheck('解方程：x^2 - 5x + 6 = 0'),
  normalizeTextForDuplicateCheck('解方程：x^2 - 5x + 6 = 0'),
);
assert.equal(scenarioExact.decision, 'definite_duplicate');

const scenarioUnique = analyzeDuplicatePair(
  normalizeTextForDuplicateCheck('阅读短文后回答问题，作者态度是什么？'),
  normalizeTextForDuplicateCheck('写出 C 语言指针与数组的三个区别'),
);
assert.equal(scenarioUnique.decision, 'definite_unique');

const scenarioSemantic = analyzeDuplicateAgainstCandidates(
  normalizeTextForDuplicateCheck('求方程x^2-5x+6=0的两个根'),
  [normalizeTextForDuplicateCheck('解一元二次方程x^2-5x+6=0，求两个根')],
);
assert.ok(['uncertain', 'definite_duplicate'].includes(scenarioSemantic.decision));

const draftReviewContent = fs.readFileSync(draftReviewPath, 'utf8');
assert.ok(draftReviewContent.includes('正在进行AI深度查重...'));
assert.ok(draftReviewContent.includes('AI 判定依据：'));
assert.ok(draftReviewContent.includes("confirmText: '跳过相似并继续'"));
assert.ok(draftReviewContent.includes("cancelText: '取消'"));

const apiContent = fs.readFileSync(apiPath, 'utf8');
assert.ok(apiContent.includes('checkSemanticDuplicate: async'));
assert.ok(apiContent.includes('"is_duplicate": boolean'));
assert.ok(apiContent.includes('只输出合法 JSON 数组'));

console.log(
  [
    'Hybrid duplicate check verification passed.',
    `Exact scenario: ${scenarioExact.decision}`,
    `Unique scenario: ${scenarioUnique.decision}`,
    `Semantic scenario: ${scenarioSemantic.decision}`,
    `Node: ${process.version}`,
    `Platform: ${os.platform()}`,
  ].join('\n'),
);

fs.rmSync(tempDir, { recursive: true, force: true });
