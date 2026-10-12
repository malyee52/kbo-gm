// 판타지 모드 Vertex AI 연결 (서비스 계정 JSON → JWT 서명 → 토큰 → generateContent·rawPredict)
import { describe, expect, it } from 'vitest';
import { complete } from '../src/fantasy/llm';
import { parseServiceAccount, signJwt, vertexUrl, type ServiceAccount } from '../src/fantasy/vertex';

async function testAccount(): Promise<{ sa: ServiceAccount; pub: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`;
  return { sa: { type: 'service_account', project_id: 'proj-1', private_key: pem, client_email: 'bot@proj-1.iam.gserviceaccount.com' }, pub: pair.publicKey };
}

const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

describe('Vertex AI', () => {
  it('서비스 계정 JSON 검사', () => {
    expect(() => parseServiceAccount('{"type":"authorized_user"}')).toThrow(/서비스 계정/);
    expect(() => parseServiceAccount('not json')).toThrow(/읽지 못했습니다/);
  });

  it('JWT: RS256 서명이 공개 키로 검증되고, 범위·대상·만료가 맞다', async () => {
    const { sa, pub } = await testAccount();
    const jwt = await signJwt(sa, 1_000_000);
    const [h, c, sig] = jwt.split('.');
    expect(JSON.parse(fromB64url(h).toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = JSON.parse(fromB64url(c).toString());
    expect(claims).toMatchObject({ iss: sa.client_email, aud: 'https://oauth2.googleapis.com/token', iat: 1_000_000, exp: 1_003_600 });
    expect(claims.scope).toContain('cloud-platform');
    expect(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pub, fromB64url(sig), new TextEncoder().encode(`${h}.${c}`))).toBe(true);
  });

  it('주소: global은 지역 없는 호스트, Claude 모델은 anthropic rawPredict', async () => {
    const { sa } = await testAccount();
    expect(vertexUrl(sa, 'global', 'gemini-3.6-flash')).toBe('https://aiplatform.googleapis.com/v1/projects/proj-1/locations/global/publishers/google/models/gemini-3.6-flash:generateContent');
    expect(vertexUrl(sa, 'us-east5', 'claude-sonnet-5-5')).toBe('https://us-east5-aiplatform.googleapis.com/v1/projects/proj-1/locations/us-east5/publishers/anthropic/models/claude-sonnet-5-5:rawPredict');
  });

  it('호출: 토큰을 받아 Bearer로 부르고, Claude는 본문에 anthropic_version', async () => {
    const { sa } = await testAccount();
    const calls: { url: string; init?: RequestInit }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'tok-1', expires_in: 3600 }));
      if (url.includes('rawPredict')) return new Response(JSON.stringify({ content: [{ type: 'text', text: '클로드' }] }));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '제미나이' }] } }] }));
    }) as unknown as typeof fetch;
    const key = JSON.stringify({ ...sa, client_email: 'bot2@proj-1.iam.gserviceaccount.com' });
    const req = { system: 's', messages: [{ role: 'user' as const, content: 'q' }] };
    expect(await complete({ provider: 'vertex', model: 'gemini-3.6-flash', key, region: 'global' }, req, f)).toBe('제미나이');
    expect(String(calls[0].init!.body)).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer');
    expect((calls[1].init!.headers as Record<string, string>).authorization).toBe('Bearer tok-1');
    expect(await complete({ provider: 'vertex', model: 'claude-sonnet-5-5', key, region: 'us-east5' }, req, f)).toBe('클로드');
    // 토큰은 다시 받지 않는다 (메모리)
    expect(calls.filter((c) => c.url.includes('oauth2')).length).toBe(1);
    expect(JSON.parse(String(calls.at(-1)!.init!.body))).toMatchObject({ anthropic_version: 'vertex-2023-10-16', system: 's' });
  });
});
