# Rehome: Devpost submission text

## Tagline
The returns-routing agent that finds the city where a returned product will actually sell.

## Inspiration
Retailers route returns by geography, not demand. A returned item goes back to the nearest warehouse, gets sold to a liquidator for about a quarter of its price, or is thrown away. But demand isn't the same everywhere: a jacket nobody wanted in Chennai can sell at full price in Bengaluru. Nobody routes returns by taste, because nobody had the taste data. Qloo does.

## What it does
Upload a returns file (or try our 50-item sample). Rehome matches every item to a Qloo brand entity, pulls that brand's affinity across 10 Indian cities, and decides for each item whether to restock it, relocate it, resell it online, bundle it, liquidate it or donate it. It then groups the whole batch into shipments and shows how much more it recovers than liquidating everything or restocking where each item came back.

For any item you can open "Where should this return go?": a demand map from Qloo's heatmap, every option ranked with its expected recovery, the agent's reason, and what-if controls. Cap shipping at ₹150 or limit moves to 500 km, and the route, map and money update instantly.

## How we built it
- **Qloo:** `/search` for brand entities, `/v2/insights` with `signal.location.query` and `filter.results.entities` for per-city brand affinity (one call per city for the whole batch), `urn:heatmap` for the demand map, and `urn:demographics` for the resale listing's audience. All responses are cached.
- **Agent:** plan → act → review. An LLM maps messy product rows to Qloo brand names and flags oddities; the agent calls Qloo; a pure scoring tool turns affinity into sell-through probability and weighs it against freight, condition and liquidation; the LLM then names shipments and writes a reason per item and resale listings.
- **App:** a zero-dependency Node server and Vercel functions, with a plain JavaScript front end. The scoring engine runs in the browser so what-ifs are instant.

## What makes it Qloo-powered
Without Qloo, every city looks the same and Rehome collapses to "restock where it was returned". Qloo's city-level affinity is the only reason any item moves, and every routing decision cites it.

## Challenges
Turning affinity into money without overclaiming. Affinity is interest, not sales, so we treat it as a demand signal: it sets a sell-through probability that is then weighed against real costs, and the assumptions are in one editable table.

## What's next
Plug in a retailer's real freight rates and store stock levels, learn sell-through from outcomes, and add neighbourhood-level routing for marketplaces.

## Built with
Qloo API, Google Gemini, Node.js, Vercel, JavaScript
