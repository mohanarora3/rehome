import { handle } from '../lib/http.js';
import { heatmap } from '../lib/qloo.js';

// GET ?id=<qloo entity id>&brand=<name>&category=<cat> -> heatmap points across India.
export default handle(async ({ id, brand, category }) => ({ points: await heatmap({ id, query: brand, category }) }), { method: 'GET' });
