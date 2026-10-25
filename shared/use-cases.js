/**
 * Jobs the same allowance can run.
 * Selecting one names the work. It does not change the budget, the cap,
 * the expiry, or the merchant list.
 */

export const USE_CASES = [
  {
    id: 'research',
    title: 'Research desk',
    summary: 'The agent buys briefs from desks you listed. The live demo uses this job.',
    jobs: [
      'A 1 RLUSD morning brief from a listed desk is inside the cap, so the agent pays.',
      'An 8 RLUSD history pack is over the cap, so it waits for a Ledger.',
      'The unlisted research desk is decline-only. A signature cannot pay it.',
    ],
  },
  {
    id: 'travel',
    title: 'Travel booking',
    summary: 'A travel agent books listed airlines and hotels inside the same allowance.',
    jobs: [
      'A listed airline fare at or under the cap is paid by the agent.',
      'A hotel quote over the cap waits for a person on a Ledger.',
      'An unlisted booking site is decline-only.',
    ],
  },
  {
    id: 'saas',
    title: 'SaaS and API procurement',
    summary: 'A procurement agent pays listed software and API vendors inside the same allowance.',
    jobs: [
      'A listed API seat at or under the cap is paid by the agent.',
      'An annual invoice over the cap waits for a person on a Ledger.',
      'An unknown software vendor is decline-only.',
    ],
  },
  {
    id: 'supplies',
    title: 'Small-business supplies',
    summary: 'A supplies agent reorders from listed vendors inside the same allowance.',
    jobs: [
      'A listed office or inventory order at or under the cap is paid by the agent.',
      'A bulk order over the cap waits for a person on a Ledger.',
      'An off-list marketplace is decline-only.',
    ],
  },
];

export function useCaseById(id) {
  return USE_CASES.find((item) => item.id === id) || null;
}

/** The research desk is the live demo. An unknown id falls back to it. */
export function presentUseCase(id) {
  const found = useCaseById(id) || USE_CASES[0];
  return {
    id: found.id,
    title: found.title,
    summary: found.summary,
    jobs: [...found.jobs],
  };
}
