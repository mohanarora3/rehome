# Rehome

**A returns-routing agent that finds the city where a returned product will actually sell.**

Qloo's taste graph tells the agent where each product's audience is strongest. The agent then decides whether to restock it, relocate it, resell it online, bundle it, liquidate it or donate it, and explains why, item by item.

Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com).

## What it does

1. **Upload returns.** A CSV, or one click on the 50-item sample (real brands, sitting in Chennai, Delhi and Mumbai).
2. **Match to Qloo.** The agent maps messy rows to Qloo brand entities and flags anything odd.
3. **Score 10 cities.** Qloo affinity per city becomes a sell-through probability, weighed against freight, condition and the liquidator's offer.
4. **Clear the returns truck.** The batch is grouped into shipments (e.g. "Send 7 items from Chennai to Bengaluru"), with recovery compared against liquidating everything and against restocking where each item came back.
5. **Where should this return go?** For each item: a demand map from Qloo's heatmap, ranked options with the money for each, the agent's reason, and what-if controls (distance limit, shipping budget, condition) that update instantly.
6. **Resale listing.** For items sold online, a listing written for the audience Qloo links to the brand.

## How Qloo is used

| Step | Qloo call |
| --- | --- |
| Brand matching | `GET /search?query=<brand>&types=urn:entity:brand` |
| City affinity (one call per city for the whole batch) | `GET /v2/insights?filter.type=urn:entity:brand&signal.location.query=<city>&filter.results.entities=<ids>` |
| Demand map | `GET /v2/insights?filter.type=urn:heatmap&signal.interests.entities=<id>&filter.location.query=India` |
| Listing audience | `GET /v2/insights?filter.type=urn:demographics&signal.interests.entities=<id>` |

Every Qloo response is cached, so changing a what-if never calls Qloo again: the scoring runs in plain code in the browser. The LLM does what a formula can't: matching products to Qloo, flagging oddities, naming shipments, and writing reasons and listings.

## Run it

Needs Node 18 or later. There are no npm dependencies.

```bash
cp .env.example .env      # add QLOO_API_KEY, and optionally GEMINI_API_KEY
node server.js            # http://localhost:3000
```

Without keys the app still runs end to end: it uses clearly labelled **sample signals** instead of Qloo data, and template text instead of the LLM. The two badges in the top bar always show which mode you are in.

### Day-one check

```bash
node scripts/qloo-test.js
```

Queries 5 brands across Delhi, Bengaluru and Chennai and prints the affinity table. If scores differ meaningfully by city, Rehome's core signal is real.

### Tests

```bash
node test/score.test.js
```

## Deploy to Vercel

```bash
npx vercel            # framework: Other; the included vercel.json serves public/ and api/
npx vercel env add QLOO_API_KEY
npx vercel env add GEMINI_API_KEY
npx vercel --prod
```

## Project layout

```
api/            Serverless handlers: analyze, explain, plan, listing, heatmap, status
lib/agent.js    The agent: plan matches, call Qloo, explain, group shipments, write listings
lib/qloo.js     Qloo client with caching and the sample-signal fallback
lib/llm.js      Google Gemini API client (optional)
public/js/      Browser app; score.js is the pure routing engine shared with the server
scripts/        Sample CSV generator and the Qloo go/no-go test
server.js       Zero-dependency local server
```

## Assumptions

Freight, handling, marketplace fees and liquidation rates are a sample rate table in `public/js/score.js` (`ASSUMPTIONS`). Qloo affinity is a demand signal, not a sales forecast: Rehome turns it into a sell-through probability and combines it with those costs. Replace the table with your own numbers and the logic stays the same. "Kept from landfill" counts every item not sent to a bulk liquidator.

## License

MIT
