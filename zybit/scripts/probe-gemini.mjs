// Raw Gemini probe — bypasses our wrappers to see the actual API response.
import { captureAboveFoldBuffer } from '../src/lib/audit/captureAboveFoldBuffer.ts';

const TARGET = process.argv[2] || 'https://stripe.com';
const MODEL = process.argv[3] || 'gemini-3.5-flash';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) { console.error('GEMINI_API_KEY missing'); process.exit(1); }

console.log('Capturing screenshot…');
const buf = await captureAboveFoldBuffer(TARGET);
console.log('  →', buf?.length, 'bytes');

console.log(`Calling Gemini model: ${MODEL}`);
const resp = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
  {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [
        { inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') } },
        { text: 'Return JSON: {"hello": "world"}. No prose.' },
      ] }],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 64,
        temperature: 0,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  },
);
console.log('HTTP:', resp.status, resp.statusText);
const text = await resp.text();
console.log('Body (first 2000):');
console.log(text.slice(0, 2000));
