import assert from 'node:assert/strict';
import test from 'node:test';
import { AGENTIC_LINE, SPONSORS } from './sponsors.js';

test('each sponsor has one job, and the story names a hardware-guarded allowance', () => {
  assert.match(AGENTIC_LINE, /economic actors/);
  assert.match(AGENTIC_LINE, /Ledger/);
  assert.deepEqual(SPONSORS.map((item) => item.id), ['ledger', 'ap4m', 'aws', 'xrpl']);
  for (const sponsor of SPONSORS) {
    assert.ok(sponsor.name);
    assert.ok(sponsor.job.length > 40);
  }
  assert.match(SPONSORS.find((item) => item.id === 'ledger').job, /agent mandate/);
  assert.match(SPONSORS.find((item) => item.id === 'ap4m').job, /channel id/);
  assert.match(SPONSORS.find((item) => item.id === 'aws').job, /Bedrock/);
  assert.match(SPONSORS.find((item) => item.id === 'xrpl').job, /RLUSD/);
});
