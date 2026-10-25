import assert from 'node:assert/strict';
import test from 'node:test';
import { ethers } from 'ethers';
import { loadRules } from '../agent/rules.js';
import { ethersApprovalTypes } from './approval.js';
import {
  buildMandateMessage,
  buildMandateTypedData,
  decodeMandateHeader,
  encodeMandateHeader,
  judgeMandate,
} from './mandate.js';

const rules = loadRules();
const approver = ethers.Wallet.createRandom();
const agent = ethers.Wallet.createRandom();
const validUntil = Math.floor(Date.now() / 1000) + 600;

async function signedMandate(wallet = approver) {
  const message = buildMandateMessage({ agent: agent.address, rules, validUntil });
  const typed = buildMandateTypedData(message);
  const signature = await wallet.signTypedData(typed.domain, ethersApprovalTypes(typed.types), typed.message);
  return { message, signature };
}

test('a Ledger-style signature matches the allowance, and a wrong signer does not', async () => {
  const { message, signature } = await signedMandate();
  const ok = judgeMandate({ message, signature, approver: approver.address, rules });
  assert.equal(ok.ok, true);
  assert.equal(ok.signer, approver.address);

  const other = await signedMandate(ethers.Wallet.createRandom());
  const rejected = judgeMandate({ message: other.message, signature: other.signature, approver: approver.address, rules });
  assert.equal(rejected.ok, false);
  assert.match(rejected.reason, /Ledger approver/);
});

test('a changed budget or a payout outside the mandate does not pass', async () => {
  const { message, signature } = await signedMandate();
  const tampered = { ...message, budget: '21 RLUSD' };
  const budget = judgeMandate({ message: tampered, signature, approver: approver.address, rules });
  assert.equal(budget.ok, false);

  const outside = judgeMandate({
    message,
    signature,
    approver: approver.address,
    rules,
    payTo: '0x0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad',
  });
  assert.equal(outside.ok, false);
  assert.match(outside.reason, /not on the agent mandate/);
});

test('the header round-trips and an expired mandate fails', async () => {
  const { message, signature } = await signedMandate();
  const header = encodeMandateHeader(message, signature);
  const decoded = decodeMandateHeader(header);
  assert.equal(decoded.signature, signature);
  assert.equal(decoded.message.agent, message.agent);

  const expired = judgeMandate({
    message,
    signature,
    approver: approver.address,
    rules,
    nowMs: (validUntil + 5) * 1000,
  });
  assert.equal(expired.ok, false);
  assert.match(expired.reason, /expired/);
});
