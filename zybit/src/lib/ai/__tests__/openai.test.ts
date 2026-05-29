import { describe, it, expect } from 'vitest';
import {
  callOpenAIChat,
  extractChatText,
  resolveOpenAIKey,
  OPENAI_CHAT_ENDPOINT,
} from '../openai';

describe('resolveOpenAIKey', () => {
  it('returns null when explicitly disabled', () => {
    expect(resolveOpenAIKey(null)).toBeNull();
  });
  it('returns the override when provided', () => {
    expect(resolveOpenAIKey('sk-test')).toBe('sk-test');
  });
});

describe('callOpenAIChat', () => {
  it('parses text + token usage from a chat-completions body', async () => {
    const result = await callOpenAIChat({
      prompt: 'hi',
      apiKey: 'sk-test',
      json: true,
      fetcher: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 12, completion_tokens: 8 },
        }),
      }),
    });
    expect(result.text).toBe('{"ok":true}');
    expect(result.promptTokens).toBe(12);
    expect(result.responseTokens).toBe(8);
  });

  it('hits the chat endpoint with a Bearer auth header', async () => {
    let seenUrl = '';
    let seenAuth = '';
    await callOpenAIChat({
      prompt: 'hi',
      apiKey: 'sk-test',
      fetcher: async (url, init) => {
        seenUrl = url;
        seenAuth = init.headers.authorization;
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'x' } }] }) };
      },
    });
    expect(seenUrl).toBe(OPENAI_CHAT_ENDPOINT);
    expect(seenAuth).toBe('Bearer sk-test');
  });

  it('sends a vision content array when an image is provided', async () => {
    let body: Record<string, unknown> = {};
    await callOpenAIChat({
      prompt: 'describe',
      apiKey: 'sk-test',
      image: { base64: 'AAAA', mimeType: 'image/png' },
      fetcher: async (_url, init) => {
        body = JSON.parse(init.body);
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'x' } }] }) };
      },
    });
    const msg = (body.messages as Array<{ content: unknown }>)[0];
    expect(Array.isArray(msg.content)).toBe(true);
    const parts = msg.content as Array<{ type: string; image_url?: { url: string } }>;
    expect(parts[0].type).toBe('text');
    expect(parts[1].type).toBe('image_url');
    expect(parts[1].image_url?.url).toBe('data:image/png;base64,AAAA');
  });

  it('omits temperature unless provided', async () => {
    let body: Record<string, unknown> = {};
    await callOpenAIChat({
      prompt: 'hi',
      apiKey: 'sk-test',
      fetcher: async (_url, init) => {
        body = JSON.parse(init.body);
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'x' } }] }) };
      },
    });
    expect('temperature' in body).toBe(false);
  });

  it('throws on non-2xx', async () => {
    await expect(
      callOpenAIChat({
        prompt: 'hi',
        apiKey: 'sk-test',
        fetcher: async () => ({ ok: false, status: 429, json: async () => ({}) }),
      }),
    ).rejects.toThrow('HTTP 429');
  });

  it('handles missing usage gracefully', async () => {
    const result = await callOpenAIChat({
      prompt: 'hi',
      apiKey: 'sk-test',
      fetcher: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{}' } }] }) }),
    });
    expect(result.promptTokens).toBeNull();
    expect(result.responseTokens).toBeNull();
  });
});

describe('extractChatText', () => {
  it('returns trimmed content', () => {
    expect(extractChatText({ choices: [{ message: { content: '  hello  ' } }] })).toBe('hello');
  });
  it('returns null for malformed body', () => {
    expect(extractChatText(null)).toBeNull();
    expect(extractChatText({})).toBeNull();
  });
});
