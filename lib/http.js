// Shared helpers so the same handlers run on Vercel and on the local server.
export async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

export function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

export function handle(fn, { method = 'POST' } = {}) {
  return async (req, res) => {
    if (req.method !== method) return send(res, 405, { error: `Use ${method}` });
    try {
      send(res, 200, await fn(method === 'POST' ? await body(req) : Object.fromEntries(new URL(req.url, 'http://x').searchParams)));
    } catch (err) {
      console.error(err);
      send(res, 500, { error: err.message || 'Something went wrong' });
    }
  };
}
