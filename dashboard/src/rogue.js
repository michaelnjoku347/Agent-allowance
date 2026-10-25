/** Playback frames for the rogue-agent cards. The decisions stay on the server. */

import { plainReason } from '../../shared/words.js';

export const ROGUE_PHASES = ['attempt', 'rule', 'blocked'];

export function rogueFrames(attempts = []) {
  const frames = [];
  attempts.forEach((attempt, index) => {
    for (const phase of ROGUE_PHASES) {
      const shown = attempts.slice(0, index).map((done) => ({ ...done, phase: 'blocked' }));
      shown.push({ ...attempt, phase });
      frames.push({ phase, shown, summary: false });
    }
  });
  frames.push({
    phase: 'summary',
    shown: attempts.map((attempt) => ({ ...attempt, phase: 'blocked' })),
    summary: true,
  });
  return frames;
}

/** Final frames when the server does not answer. Not a live rules run. */
export function scriptedRogueReport() {
  const attempts = [
    {
      id: 'over-cap',
      title: 'Over the cap',
      attempt: 'The agent tries to buy 8 RLUSD. The cap is 5 RLUSD.',
      rule: 'over per-purchase cap',
      ruleText: plainReason('over per-purchase cap'),
      outcome: 'Blocked',
      route: 'ledger',
      note: 'Scripted preview. The server did not answer. Nothing was signed.',
      paid: false,
    },
    {
      id: 'unlisted',
      title: 'Off the allowlist',
      attempt: 'The agent tries to pay a merchant that is not on the allowlist.',
      rule: 'merchant not allowed',
      ruleText: plainReason('merchant not allowed'),
      outcome: 'Blocked',
      route: 'hard',
      note: 'Scripted preview. A Ledger signature cannot pay this merchant.',
      paid: false,
    },
    {
      id: 'raise',
      title: 'Raise its own allowance',
      attempt: 'The agent asks to raise its own cap.',
      rule: 'needs_ledger',
      ruleText: 'Raising the allowance needs a Ledger SetAllowance signature.',
      outcome: 'Blocked',
      route: 'allowance',
      note: 'Scripted preview. Nothing was changed.',
      paid: false,
    },
  ];
  return {
    ok: true,
    paid: false,
    signed: false,
    scripted: true,
    attempts,
    summary: {
      attempts: 3,
      blocked: 3,
      lost: '0',
      line: '3 attempts, 3 blocked, 0 RLUSD lost',
    },
  };
}

export function rogueSummaryLine(summary) {
  if (!summary || summary.lost !== '0') return '';
  return `${summary.attempts} attempts, ${summary.blocked} blocked, ${summary.lost} RLUSD lost`;
}
