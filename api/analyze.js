import { handle } from '../lib/http.js';
import { analyze } from '../lib/agent.js';

// POST {items:[...]} -> items matched to Qloo with per-city affinity and flags.
export default handle(async ({ items }) => {
  if (!Array.isArray(items) || !items.length) throw new Error('Send a non-empty items array');
  if (items.length > 60) throw new Error('Send at most 60 items per call');
  return analyze(items);
});
