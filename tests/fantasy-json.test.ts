// AI 답 읽기 (2026-10-13 사용자 "자꾸 AI가 형식에 맞지 않게 대답했습니다"): 깨진 JSON 고쳐 읽기, 한 번 다시 묻기, 생각하는 모델 토큰 몫
import { describe, expect, it } from 'vitest';
import { complete, completeJson, extractJson, THINKING_ALLOWANCE } from '../src/fantasy/llm';

const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('AI 답 읽기', () => {
  it('깨진 JSON을 고쳐 읽는다', () => {
    expect(extractJson('{"title":"a","narration":"첫 줄\n둘째 줄"}')).toEqual({ title: 'a', narration: '첫 줄\n둘째 줄' });
    expect(extractJson('```json\n{"a":1,"b":[1,2,],}\n```')).toEqual({ a: 1, b: [1, 2] });
    expect(extractJson('판정합니다.\n```json\n{"title":"x","narration":"잘린 이야')).toEqual({ title: 'x', narration: '잘린 이야' });
    expect(extractJson('{"title":"x","ops":[{"op":"move","player":"김')).toEqual({ title: 'x', ops: [{ op: 'move', player: '김' }] });
    expect(extractJson('{"title":"x","narration":')).toEqual({ title: 'x' });
    expect(extractJson('그냥 이야기만')).toBeNull();
  });

  it('읽지 못하면 한 번 더 묻는다', async () => {
    const bodies: { messages: { role: string; content: string }[] }[] = [];
    let n = 0;
    const f = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      n++;
      return reply({ content: [{ type: 'text', text: n === 1 ? '형식 없는 답' : '{"narration":"좋다"}' }] });
    }) as typeof fetch;
    const r = await completeJson<{ narration: string }>({ provider: 'anthropic', model: 'm', key: 'k' }, { system: 'JSON 하나만', messages: [{ role: 'user', content: '행동' }] }, undefined, f);
    expect(r.json).toEqual({ narration: '좋다' });
    expect(n).toBe(2);
    expect(bodies[1].messages.at(-1)!.content).toContain('형식에 맞지 않았다');
  });

  it('생각하는 모델: 한도를 넉넉히 주고 JSON 모드, 생각만 하다 끝나면 알기 쉬운 오류', async () => {
    let sent: { generationConfig: { maxOutputTokens: number; responseMimeType?: string } } | null = null;
    const ok = (async (_u: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return reply({ candidates: [{ content: { parts: [{ text: '생각', thought: true }, { text: '{"a":1}' }] }, finishReason: 'STOP' }] });
    }) as typeof fetch;
    expect(await complete({ provider: 'gemini', model: 'g', key: 'k' }, { system: 'JSON으로', messages: [{ role: 'user', content: 'x' }], maxTokens: 1500 }, ok)).toBe('{"a":1}');
    expect(sent!.generationConfig).toEqual({ maxOutputTokens: 1500 + THINKING_ALLOWANCE, responseMimeType: 'application/json' });
    const cut = (async () => reply({ candidates: [{ content: { parts: [{ text: '...', thought: true }] }, finishReason: 'MAX_TOKENS' }] })) as typeof fetch;
    await expect(complete({ provider: 'gemini', model: 'g', key: 'k' }, { system: 'JSON', messages: [{ role: 'user', content: 'x' }] }, cut)).rejects.toThrow('토큰');
  });
});
