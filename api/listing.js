import { handle } from '../lib/http.js';
import { writeListing } from '../lib/agent.js';
import { audience } from '../lib/qloo.js';

// POST {item} -> resale listing aimed at the brand's Qloo audience.
export default handle(async ({ item }) => {
  if (!item) throw new Error('Send an item');
  const entity = { id: item.match?.id, query: item.brand, category: item.category };
  const aud = entity.id && !String(entity.id).startsWith('demo:') ? await audience(entity) : await audience({ ...entity });
  return writeListing({ item, audience: aud });
});
