import { handle } from '../lib/http.js';
import { explain } from '../lib/agent.js';

// POST {item, best, second, constraints} -> one-line reason for the routing decision.
export default handle(async (b) => explain(b));
