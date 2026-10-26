// LLM client (Google Gemini API). Optional: without GEMINI_API_KEY,
// every caller falls back to a deterministic template and the UI says so.

const KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const llmMode = () => (KEY ? 'live' : 'template');

export async function complete({ system, prompt, maxTokens = 800 }) {
  if (!KEY) return null;
  try {
    const res = await fetch(`${BASE}/models/${encodeURIComponent(MODEL)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        // Newer Gemini models spend part of the output budget on thinking,
        // so leave headroom or short replies can come back empty.
        generationConfig: { maxOutputTokens: maxTokens + 4096 },
      }),
      signal: AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS) || 45000),
    });
    if (!res.ok) {
      console.warn('[llm]', res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const json = await res.json();
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    return parts.filter((p) => !p.thought).map((p) => p.text ?? '').join('').trim() || null;
  } catch (err) {
    console.warn('[llm] failed', err.message);
    return null;
  }
}

/** Ask for JSON and parse the first JSON value in the reply. */
export async function completeJson(opts) {
  const text = await complete(opts);
  if (!text) return null;
  const start = text.search(/[[{]/);
  if (start < 0) return null;
  const open = text[start], close = open === '[' ? ']' : '}';
  const end = text.lastIndexOf(close);
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}
