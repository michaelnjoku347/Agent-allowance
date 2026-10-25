/** Playback frames for the rogue-agent cards. The decisions stay on the server. */

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

export function rogueSummaryLine(summary) {
  if (!summary || summary.lost !== '0') return '';
  return `${summary.attempts} attempts, ${summary.blocked} blocked, ${summary.lost} RLUSD lost`;
}
