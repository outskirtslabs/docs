import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import yaml from 'js-yaml';

const workflow = yaml.load(readFileSync(new URL('../.github/workflows/update-docs.yml', import.meta.url), 'utf8'));
const script = workflow.jobs['update-projects-nix'].steps.find((step) => step.name?.startsWith('Commit and open PR')).run;

test('workflow shell parses', () => {
  execFileSync('bash', ['-n'], { input: script });
});

test('project bullets describe the complete diff, sorted without duplicates', () => {
  const filter = script.match(/jq -nr[^\n]*'([\s\S]*?)'/)[1];
  const base = { zebra: { rev: 'old' }, same: { rev: 'same' }, removed: {} };
  const updated = { zebra: { rev: 'new' }, alpha: {}, same: { rev: 'same' } };
  const bullets = (value) => execFileSync('jq', ['-nr', '--argjson', 'base', JSON.stringify(base), '--argjson', 'updated', JSON.stringify(value), filter], { encoding: 'utf8' });
  assert.equal(bullets(updated), '- alpha\n- removed\n- zebra\n');
  assert.equal(bullets(base), '');
});

test('selects oldest same-repository update PR, including legacy branches', () => {
  const filter = script.match(/--jq '([\s\S]*?)'/)[1];
  const select = (prs) => execFileSync('jq', ['-c', filter], { input: JSON.stringify(prs), encoding: 'utf8' });
  const pr = (number, headRefName, createdAt, isCrossRepository = false) => ({ number, headRefName, createdAt, isCrossRepository });
  const oldest = pr(2, 'auto-update/projects-nix-2026-01-01', '2026-01-01');
  assert.deepEqual(JSON.parse(select([
    pr(4, 'auto-update/projects-nix', '2026-02-01'),
    pr(1, 'unrelated', '2025-01-01'),
    pr(3, 'auto-update/projects-nix', '2025-01-01', true),
    oldest,
  ])), oldest);
  assert.equal(select([]), '');
});
