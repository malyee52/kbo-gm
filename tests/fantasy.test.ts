// 판타지 모드 1단계 (docs/fantasy-mode.md): 제공자 호출 형식, JSON 꺼내기, 이야기 기록의 재현·저장
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { complete, extractJson, listModels, type LlmSettings } from '../src/fantasy/llm';
import { splitArticle } from '../src/fantasy/prompts';
import { gameContext } from '../src/fantasy/context';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
beforeAll(() => { store = loadDataStore(); }, 120_000);

/** 부른 요청을 남기고 정해 둔 답을 주는 가짜 fetch */
function fakeFetch(reply: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(reply), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('AI 제공자 호출', () => {
  const sys = '시스템';
  const msgs = [{ role: 'user' as const, content: '안녕' }];
  it('Anthropic: 메시지 API, 키·버전·브라우저 직접 호출 헤더, 글 조각을 이어 붙인다', async () => {
    const { f, calls } = fakeFetch({ content: [{ type: 'text', text: '가' }, { type: 'text', text: '나' }] });
    const s: LlmSettings = { provider: 'anthropic', model: 'claude-sonnet-5-5', key: 'k1' };
    expect(await complete(s, { system: sys, messages: msgs }, f)).toBe('가나');
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    const h = calls[0].init!.headers as Record<string, string>;
    expect(h['x-api-key']).toBe('k1');
    expect(h['anthropic-dangerous-direct-browser-access']).toBe('true');
    const body = JSON.parse(calls[0].init!.body as string);
    expect(body).toMatchObject({ model: 'claude-sonnet-5-5', system: sys, messages: msgs });
  });
  it('OpenAI: 지시문을 system 메시지로', async () => {
    const { f, calls } = fakeFetch({ choices: [{ message: { content: '답' } }] });
    expect(await complete({ provider: 'openai', model: 'gpt-5.5', key: 'k2' }, { system: sys, messages: msgs }, f)).toBe('답');
    expect((calls[0].init!.headers as Record<string, string>).authorization).toBe('Bearer k2');
    expect(JSON.parse(calls[0].init!.body as string).messages[0]).toEqual({ role: 'system', content: sys });
  });
  it('Gemini: systemInstruction과 contents, 모델 이름은 주소에', async () => {
    const { f, calls } = fakeFetch({ candidates: [{ content: { parts: [{ text: '답' }] } }] });
    expect(await complete({ provider: 'gemini', model: 'gemini-3.6-flash', key: 'k3' }, { system: sys, messages: msgs }, f)).toBe('답');
    expect(calls[0].url).toContain('/models/gemini-3.6-flash:generateContent');
    expect(JSON.parse(calls[0].init!.body as string).contents[0]).toEqual({ role: 'user', parts: [{ text: '안녕' }] });
  });
  it('키가 없거나 401이면 알기 쉬운 오류', async () => {
    await expect(complete({ provider: 'openai', model: 'x', key: '' }, { system: sys, messages: msgs })).rejects.toThrow(/API 키/);
    const { f } = fakeFetch({ error: { message: 'bad key' } }, 401);
    await expect(complete({ provider: 'openai', model: 'x', key: 'k' }, { system: sys, messages: msgs }, f)).rejects.toThrow(/키를 확인/);
  });
  it('모델 목록', async () => {
    const { f } = fakeFetch({ models: [{ name: 'models/gemini-a', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embed', supportedGenerationMethods: ['embedContent'] }] });
    expect(await listModels({ provider: 'gemini', model: '', key: 'k' }, f)).toEqual(['gemini-a']);
  });
});

describe('답 다듬기', () => {
  it('JSON 꺼내기: 코드 블록, 앞뒤 설명, 문자열 안 괄호', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('결과는 {"t":"괄호 } 포함", "n":[1,2]} 입니다')).toEqual({ t: '괄호 } 포함', n: [1, 2] });
    expect(extractJson('없음')).toBeNull();
  });
  it('기사: 첫 줄 제목, 나머지 본문', () => {
    expect(splitArticle('# 제목: "LG, 5연승"\n\n본문 한 줄.\n둘째 줄.')).toEqual({ title: 'LG, 5연승', body: '본문 한 줄.\n둘째 줄.' });
  });
});

describe('판타지 게임', () => {
  const lgOf = () => store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
  it('AI 글은 조작 기록에 남아 저장·불러오기와 재현에서 같은 이야기가 된다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'fan-1', fantasy: {} }, FAST);
    expect(g.fantasy).not.toBeNull();
    g.advance(5);
    expect(g.addFantasy({ kind: 'article', title: '제목', text: '본문', who: 'AI 기자' }).ok).toBe(true);
    g.advance(3);
    const h = GameSession.load(store, roundTrip(g.toSave()), FAST);
    expect(h.fantasy!.log).toEqual(g.fantasy!.log);
    const info = g.reproInfo();
    expect(info.opts.fantasy).toEqual({});
    const r = GameSession.replay(store, info.opts, info.actions, info.at, FAST);
    expect(r.fantasy!.log).toEqual(g.fantasy!.log);
    expect(r.fantasy!.log[0]).toMatchObject({ year: 2026, day: 5, kind: 'article', title: '제목' });
  }, 300_000);

  it('보통 게임에는 넣지 않는다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'fan-2' }, FAST);
    expect(g.fantasy).toBeNull();
    expect(g.addFantasy({ kind: 'article', title: 't', text: 'x' }).ok).toBe(false);
  }, 120_000);

  it('게임 상황 요약: 실존·가상 표시, 숨겨진 특수능력 없음', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'fan-3', fantasy: {} }, FAST);
    g.advance(20);
    const ctx = gameContext(g);
    expect(ctx).toContain('[우리 구단] LG');
    expect(ctx).toMatch(/\(실존\)/);
    expect(ctx).not.toMatch(/특수능력|trait/i);
  }, 120_000);
});
