/**
 * The three resources the agent can ask for.
 * Prices stay in this process. The model only sees id and description.
 */

export function merchantPort(env = process.env) {
  const port = Number(env.MERCHANT_PORT || 4308);
  return Number.isInteger(port) ? port : 4308;
}

/** Not 4309: that port is the other local demo's merchant, and not MERCHANT_PORT. */
export const HISTORY_PORT_DEFAULT = 4318;

export function historyPort(env = process.env) {
  if (String(env.HISTORY_PORT ?? '').trim()) return Number(env.HISTORY_PORT);
  return HISTORY_PORT_DEFAULT;
}

export function merchantOrigin(env = process.env) {
  return `http://127.0.0.1:${merchantPort(env)}`;
}

/** Real 8 RLUSD x402 sale. Pathname stays /resource because the kit requires it. */
export function historyResourceUrl(env = process.env) {
  const explicit = String(env.HISTORY_RESOURCE_URL ?? '').trim();
  if (explicit) return explicit;
  return `http://127.0.0.1:${historyPort(env)}/resource`;
}

export function liveCatalog(env = process.env) {
  const origin = merchantOrigin(env);
  return [
    {
      id: 'brief',
      description: 'Morning market brief',
      price: '1',
      url: `${origin}/resource`,
    },
    {
      id: 'history',
      description: 'Extended market history',
      price: '8',
      url: historyResourceUrl(env),
    },
    {
      id: 'outside',
      description: 'Quote from a desk outside the allowance',
      price: '1',
      url: `${origin}/demo/unlisted`,
    },
  ];
}
