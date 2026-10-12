// 판타지 삽화 (NovelAI): 태그 다듬기(이름·로고 제거), 구단 색, 요청 본문, zip에서 그림 꺼내기
import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { colorWord, firstPngFromZip, generateImage, naiBody, sanitizeTags } from '../src/fantasy/nai';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5]);

/** 파일 하나짜리 zip (method 0 저장, 8 deflate) */
function zipOf(name: string, data: Uint8Array, method: 0 | 8): ArrayBuffer {
  const body = method === 8 ? new Uint8Array(deflateRawSync(data)) : data;
  const nameBytes = new TextEncoder().encode(name);
  const head = new Uint8Array(30 + nameBytes.length);
  const v = new DataView(head.buffer);
  v.setUint32(0, 0x04034b50, true);
  v.setUint16(8, method, true);
  v.setUint32(18, body.length, true);
  v.setUint32(22, data.length, true);
  v.setUint16(26, nameBytes.length, true);
  v.setUint16(28, 0, true);
  head.set(nameBytes, 30);
  const out = new Uint8Array(head.length + body.length);
  out.set(head);
  out.set(body, head.length);
  return out.buffer;
}

describe('NovelAI 삽화', () => {
  it('태그 다듬기: 한글·이름·로고·글자 태그를 지운다', () => {
    const t = sanitizeTags('김도영, young pitcher, team logo, Lee Jung-hoo smiling, stadium lights\nnight game; letters on jersey', ['Lee Jung-hoo']);
    expect(t).toBe('young pitcher, stadium lights, night game');
  });
  it('구단 색 이름', () => {
    expect(colorWord('#c30037')).toMatch(/red|crimson/);
    expect(colorWord('#000000')).toBe('black');
    expect(colorWord('#1d3c8f')).toMatch(/navy|blue/);
  });
  it('요청 본문: v4_prompt·v4_negative_prompt 필수, 같은 지시문 세 군데', () => {
    const b = naiBody('nai-diffusion-4-5-full', 'a, b', 7, { width: 1216, height: 832 });
    expect(b.input).toBe('a, b');
    expect(b.parameters.prompt).toBe('a, b');
    expect(b.parameters.v4_prompt.caption.base_caption).toBe('a, b');
    expect(b.parameters.v4_negative_prompt.caption.base_caption).toContain('logo');
    expect(b.parameters).toMatchObject({ width: 1216, height: 832, seed: 7, n_samples: 1 });
  });
  it('zip에서 PNG 꺼내기 (저장·deflate), PNG 그대로도', async () => {
    expect(Array.from(await firstPngFromZip(zipOf('image_0.png', PNG, 0)))).toEqual(Array.from(PNG));
    expect(Array.from(await firstPngFromZip(zipOf('image_0.png', PNG, 8)))).toEqual(Array.from(PNG));
    expect(Array.from(await firstPngFromZip(PNG.slice().buffer))).toEqual(Array.from(PNG));
  });
  it('호출: Bearer 토큰, 오류 안내', async () => {
    const calls: RequestInit[] = [];
    const ok = (async (_u: string, init?: RequestInit) => { calls.push(init!); return new Response(zipOf('image_0.png', PNG, 8)); }) as unknown as typeof fetch;
    const out = await generateImage({ token: 'pst-1', model: 'nai-diffusion-4-5-full', auto: true }, 'x', 1, undefined, ok);
    expect(out.length).toBe(PNG.length);
    expect((calls[0].headers as Record<string, string>).authorization).toBe('Bearer pst-1');
    const bad = (async () => new Response('no', { status: 401 })) as unknown as typeof fetch;
    await expect(generateImage({ token: 'pst-1', model: 'm', auto: true }, 'x', 1, undefined, bad)).rejects.toThrow(/토큰을 확인/);
    await expect(generateImage({ token: '', model: 'm', auto: true }, 'x', 1)).rejects.toThrow(/토큰이 없습니다/);
  });
});
