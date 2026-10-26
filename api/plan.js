import { handle } from '../lib/http.js';
import { planShipments } from '../lib/agent.js';

// POST {shipments, items} -> a title and note per shipment, plus a summary.
export default handle(async ({ shipments = [], items = [] }) => planShipments({ shipments, items }));
