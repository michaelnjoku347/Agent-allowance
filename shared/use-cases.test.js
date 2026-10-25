import assert from 'node:assert/strict';
import test from 'node:test';
import { USE_CASES, presentUseCase, useCaseById } from './use-cases.js';

test('the dashboard can select travel, procurement, and supplies without inventing rules', () => {
  assert.deepEqual(USE_CASES.map((item) => item.id), ['research', 'travel', 'saas', 'supplies']);
  for (const item of USE_CASES) {
    const shown = presentUseCase(item.id);
    assert.equal(shown.id, item.id);
    assert.equal(shown.jobs.length, 3);
    assert.equal(JSON.stringify(shown).includes('0x'), false);
  }
  assert.equal(useCaseById('nope'), null);
  assert.equal(presentUseCase('nope').id, 'research');
});
