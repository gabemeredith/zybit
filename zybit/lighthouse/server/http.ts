/**
 * Shared HTTP helpers for Lighthouse route handlers.
 */

import type { IncomingMessage } from 'node:http';

/**
 * Read and parse a JSON body off the incoming request. Bounded by
 * `maxBytes` so a runaway client can't exhaust memory. Resolves to `{}`
 * for an empty body so callers don't have to special-case it.
 */
export async function readJsonBody(
  req: IncomingMessage,
  maxBytes = 16 * 1024,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new Error('body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}
