import { handle } from '../lib/http.js';
import { qlooMode } from '../lib/qloo.js';
import { llmMode } from '../lib/llm.js';

export default handle(async () => ({ qloo: qlooMode(), llm: llmMode() }), { method: 'GET' });
