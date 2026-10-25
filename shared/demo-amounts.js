/**
 * Demo prices, in RLUSD, sized like real micropayments. Every quote the demo
 * makes reads these, so the allowed / over-cap / blocked story stays intact
 * against the default allowance in agent/rules.json:
 *
 *   budget 0.20 · per-purchase cap 0.05
 *   0.01 brief (GET /resource)      inside the cap → paid
 *   0.06 over-cap quote             over the cap → waits for a person
 *   0.08 history (second merchant)  over the cap → Ledger can approve it
 *   0.01 unlisted desk              not on the list → decline-only
 *   0.50 heist pack                 unlisted and over the budget → blocked
 *
 * PRICE_RLUSD overrides the brief price for a live merchant.
 */

export const DEMO_AMOUNTS = Object.freeze({
  budget: '0.20',
  cap: '0.05',
  brief: '0.01',
  overCap: '0.06',
  history: '0.08',
  unlisted: '0.01',
  heist: '0.50',
  // One cent, the step the rogue demo adds to the cap when it needs a price just over it.
  step: '0.01',
  // Hourly spend-rate brake, the same size as the per-purchase cap.
  hourly: '0.05',
});
