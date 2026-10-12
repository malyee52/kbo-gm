// 판타지 모드의 AI 호출 (docs/fantasy-mode.md). 제공자 3종과 시험용 가짜 제공자.
// 서버가 없는 게임이라 플레이어 본인 키로 브라우저에서 바로 부른다. 키는 settings.ts가 브라우저에만 둔다.
// 이 파일은 fetch만 쓰고 게임 상태를 건드리지 않는다. 답은 부른 쪽이 조작 기록에 남긴다 (재현).

import { accessToken, parseServiceAccount, vertexUrl } from './vertex';

export type Provider = 'anthropic' | 'openai' | 'gemini' | 'vertex' | 'mock';

export const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: 'Claude (Anthropic)', openai: 'OpenAI', gemini: 'Gemini (Google AI Studio 키)', vertex: 'Vertex AI (Google Cloud 서비스 계정 JSON)', mock: '시험용 (AI 없이 정해진 글)',
};

/** 기본 모델 (2026-10-12. 바뀌면 설정에서 고치거나 모델 목록을 불러 고른다) */
export const DEFAULT_MODEL: Record<Provider, string> = {
  anthropic: 'claude-sonnet-5-5', openai: 'gpt-5.5', gemini: 'gemini-3.6-flash', vertex: 'gemini-3.6-flash', mock: 'mock',
};

export interface LlmSettings {
  provider: Provider;
  model: string;
  /** API 키. Vertex AI는 서비스 계정 JSON 글 전체 */
  key: string;
  /** Vertex AI 지역 (없으면 global) */
  region?: string;
}

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  maxTokens?: number;
  /** 시험용 제공자가 돌려줄 글 (없으면 기본 글) */
  mockReply?: string;
}

export class LlmError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

type Fetch = typeof fetch;

/** "Failed to fetch" 같은 연결 실패를 어디서 났는지와 함께 (브라우저는 이유를 알려 주지 않는다) */
export function failedFetch(url: string, e: unknown): string {
  let host = url;
  try { host = new URL(url).host; } catch { /* 그대로 */ }
  return `${host}에 연결하지 못했습니다 (${(e as Error).message}). 광고 차단·보안 확장 프로그램이 이 주소를 막는지, 인터넷 연결을 확인하고 잠시 뒤 다시 해 보세요. 서버가 잠깐 오류를 내도 브라우저에는 이렇게 보입니다.`;
}

async function postJson(f: Fetch, url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await f(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  } catch (e) {
    throw new LlmError(failedFetch(url, e));
  }
  const text = await res.text();
  let data: unknown = null;
  try { data = JSON.parse(text); } catch { /* 아래에서 원문으로 알린다 */ }
  if (!res.ok) {
    const msg = (data as { error?: { message?: string } } | null)?.error?.message ?? text.slice(0, 200);
    const hint = res.status === 401 || res.status === 403 ? ' (키를 확인하세요)' : res.status === 404 ? ' (모델 이름을 확인하세요)' : res.status === 429 ? ' (요청 한도 초과, 잠시 뒤에)' : '';
    throw new LlmError(`AI 응답 오류 ${res.status}${hint}: ${msg}`, res.status);
  }
  return data;
}

async function getJson(f: Fetch, url: string, headers: Record<string, string>): Promise<unknown> {
  let res: Response;
  try { res = await f(url, { headers }); } catch (e) { throw new LlmError(failedFetch(url, e)); }
  if (!res.ok) throw new LlmError(`모델 목록을 받지 못했습니다 (${res.status})`, res.status);
  return res.json();
}

/**
 * 출력 한도는 제공자별 최대로 (2026-10-13 사용자 "한도 그냥 각 모델별 최대 토큰으로 늘려").
 * 생각하는 모델(Gemini 2.5·3, GPT-5·o 계열 등)은 생각한 토큰도 이 한도에 들어가 답이 잘리거나 비었다.
 * 모델이 이보다 적게 허용하면 서버 오류(400)에 적힌 허용값으로 줄여 다시 보내고, 그 모델은 그 값을 기억한다 (withMaxTokens)
 */
export const MAX_OUTPUT = { anthropic: 64_000, openai: 128_000, gemini: 65_536, vertexClaude: 64_000, vertexGemini: 65_536 } as const;
const learnedMax = new Map<string, number>();

/** 출력 한도를 최대로 보내고, 너무 크다는 400이면 허용값으로 줄여 다시 (최대 3번) */
export async function withMaxTokens<T>(key: string, start: number, call: (max: number) => Promise<T>): Promise<T> {
  let n = learnedMax.get(key) ?? start;
  for (let tries = 0; ; tries++) {
    try {
      return await call(n);
    } catch (e) {
      if (!(e instanceof LlmError) || e.status !== 400 || tries >= 3 || !/token|max|limit|stream|output/i.test(e.message)) throw e;
      const nums = (e.message.match(/\d[\d,]*/g) ?? []).map((x) => Number(x.replace(/,/g, ''))).filter((x) => x >= 1000 && x < n);
      const next = nums.length ? Math.max(...nums) : n > 32_000 ? 32_000 : n > 16_384 ? 16_384 : 8_192;
      if (next >= n) throw e;
      n = next;
      learnedMax.set(key, n);
    }
  }
}

/** 답이 JSON이어야 하는 요청인가 (지시문에 "JSON"이 있으면) */
const wantsJson = (req: LlmRequest) => /JSON/.test(req.system);

/** AI에게 묻는다. 답의 글을 돌려준다 */
export async function complete(s: LlmSettings, req: LlmRequest, f: Fetch = fetch): Promise<string> {
  const json = wantsJson(req);
  const key = `${s.provider}/${s.model}`;
  if (s.provider === 'mock') return req.mockReply ?? '(시험용 답) 이번 주 경기는 계획대로 흘러갔다.';
  if (!s.key.trim()) throw new LlmError('API 키가 없습니다. 판타지 → AI 설정에서 넣으세요.');
  if (s.provider === 'vertex') {
    const sa = parseServiceAccount(s.key);
    const token = await accessToken(sa, f);
    const url = vertexUrl(sa, s.region ?? 'global', s.model);
    const auth = { authorization: `Bearer ${token}` };
    if (/^claude/i.test(s.model)) {
      const d = await withMaxTokens(key, MAX_OUTPUT.vertexClaude, (max) => postJson(f, url, auth, { anthropic_version: 'vertex-2023-10-16', max_tokens: max, system: req.system, messages: req.messages })) as { content?: { type: string; text?: string }[]; stop_reason?: string };
      return checkCut((d.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join(''), d.stop_reason === 'max_tokens');
    }
    const d = await withMaxTokens(key, MAX_OUTPUT.vertexGemini, (max) => postJson(f, url, auth, geminiBody(req, max, json))) as GeminiReply;
    return geminiText(d);
  }
  if (s.provider === 'anthropic') {
    const d = await withMaxTokens(key, MAX_OUTPUT.anthropic, (max) => postJson(f, 'https://api.anthropic.com/v1/messages', {
      'x-api-key': s.key.trim(), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true',
    }, { model: s.model, max_tokens: max, system: req.system, messages: req.messages })) as { content?: { type: string; text?: string }[]; stop_reason?: string };
    return checkCut((d.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join(''), d.stop_reason === 'max_tokens');
  }
  if (s.provider === 'openai') {
    const d = await withMaxTokens(key, MAX_OUTPUT.openai, (max) => postJson(f, 'https://api.openai.com/v1/chat/completions', { authorization: `Bearer ${s.key.trim()}` }, {
      model: s.model, max_completion_tokens: max,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
    })) as { choices?: { message?: { content?: string }; finish_reason?: string }[] };
    return checkCut(d.choices?.[0]?.message?.content ?? '', d.choices?.[0]?.finish_reason === 'length');
  }
  const d = await withMaxTokens(key, MAX_OUTPUT.gemini, (max) => postJson(f, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.model)}:generateContent`, { 'x-goog-api-key': s.key.trim() }, geminiBody(req, max, json))) as GeminiReply;
  return geminiText(d);
}

type GeminiReply = { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[] };

/** Gemini 답 글 (생각 부분은 뺀다) */
function geminiText(d: GeminiReply): string {
  const c = d.candidates?.[0];
  const text = (c?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
  return checkCut(text, c?.finishReason === 'MAX_TOKENS');
}

/** 한도에 걸려 답이 비었으면 알기 쉬운 오류로 (조금이라도 있으면 그대로 넘겨 고쳐 읽기·다시 묻기에 맡긴다) */
function checkCut(text: string, cut: boolean): string {
  if (cut && !text.trim()) throw new LlmError('AI가 최대 토큰을 다 쓰고도 답을 쓰지 못했습니다 (생각이 너무 길었습니다). 다시 시도하거나 다른 모델을 고르세요.');
  return text;
}

function geminiBody(req: LlmRequest, max: number, json = false) {
  return {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: req.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    // 생각하는 Gemini는 생각 토큰도 maxOutputTokens에 든다. JSON 답이면 JSON 모드로 (줄바꿈·따옴표 깨짐을 막는다)
    generationConfig: { maxOutputTokens: max, ...(json ? { responseMimeType: 'application/json' } : {}) },
  };
}

/** Vertex AI 모델 이름 예 (목록 API는 프로젝트 권한이 더 필요해 고정 목록. 직접 고쳐 쓸 수 있다) */
export const VERTEX_MODEL_HINTS = ['gemini-3.6-flash', 'gemini-3.1-pro', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'];

/** 그 제공자가 쓸 수 있는 모델 이름 */
export async function listModels(s: LlmSettings, f: Fetch = fetch): Promise<string[]> {
  if (s.provider === 'mock') return ['mock'];
  if (s.provider === 'vertex') return VERTEX_MODEL_HINTS;
  if (!s.key.trim()) throw new LlmError('API 키가 없습니다.');
  if (s.provider === 'anthropic') {
    const d = await getJson(f, 'https://api.anthropic.com/v1/models?limit=100', {
      'x-api-key': s.key.trim(), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true',
    }) as { data?: { id: string }[] };
    return (d.data ?? []).map((m) => m.id);
  }
  if (s.provider === 'openai') {
    const d = await getJson(f, 'https://api.openai.com/v1/models', { authorization: `Bearer ${s.key.trim()}` }) as { data?: { id: string }[] };
    return (d.data ?? []).map((m) => m.id).filter((id) => /^(gpt|o\d|chatgpt)/.test(id)).sort().reverse();
  }
  const d = await getJson(f, 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { 'x-goog-api-key': s.key.trim() }) as
    { models?: { name: string; supportedGenerationMethods?: string[] }[] };
  return (d.models ?? []).filter((m) => m.supportedGenerationMethods?.includes('generateContent')).map((m) => m.name.replace(/^models\//, ''));
}

/**
 * 답에서 JSON 하나를 꺼낸다 (코드 블록·앞뒤 설명이 붙어도). 흔한 깨짐을 고쳐 읽는다 (2026-10-13):
 * 문자열 안의 날 줄바꿈·탭, 끝에 붙은 쉼표, 한도에 걸려 잘린 답(열린 문자열·괄호를 닫는다). 그래도 안 되면 null
 */
export function extractJson<T = unknown>(text: string): T | null {
  const fenced = /```[a-zA-Z]*\s*([\s\S]*?)(?:```|$)/.exec(text);
  const body = fenced && /[[{]/.test(fenced[1]) ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) return null;
  let out = '';
  const stack: string[] = [];
  let inStr = false;
  let end = -1;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (c === '\\') { out += c + (body[i + 1] ?? ''); i++; continue; }
      if (c === '"') { inStr = false; out += c; continue; }
      if (c === '\n') { out += '\\n'; continue; }
      if (c === '\r') continue;
      if (c === '\t') { out += '\\t'; continue; }
      out += c;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') {
      if (stack.pop() !== c) return null;
      out += c;
      if (!stack.length) { end = i; break; }
      continue;
    }
    out += c;
  }
  if (end < 0) {
    // 잘린 답: 열린 문자열·괄호를 닫는다 (마지막 미완성 키·값은 버린다)
    if (inStr) out += '"';
    out = out.replace(/,\s*"[^"]*"\s*:?\s*"?$/, '').replace(/[,:]\s*$/, '');
    while (stack.length) out += stack.pop();
  }
  const clean = out.replace(/,(\s*[}\]])/g, '$1');
  try { return JSON.parse(clean) as T; } catch { return null; }
}

/** 답 앞부분 (오류 안내용) */
export const preview = (raw: string) => raw.replace(/\s+/g, ' ').trim().slice(0, 80) || '(빈 답)';

/**
 * JSON 답을 받는다: 읽지 못하면 한 번 더 "형식에 맞게 다시" 묻는다 (2026-10-13). 그래도 안 되면 json null
 */
export async function completeJson<T>(s: LlmSettings, req: LlmRequest, ok: (j: T | null) => boolean = (j) => !!j, f: Fetch = fetch): Promise<{ json: T | null; raw: string }> {
  const raw = await complete(s, req, f);
  const j = extractJson<T>(raw);
  if (ok(j) || s.provider === 'mock') return { json: j, raw };
  const raw2 = await complete(s, {
    ...req,
    messages: [...req.messages, { role: 'assistant', content: raw.slice(0, 6000) || '(빈 답)' },
      { role: 'user', content: '방금 답이 형식에 맞지 않았다 (JSON이 깨졌거나 잘렸다). 같은 내용을 [답 형식]의 JSON 하나로만 다시 보내라. 설명·코드 블록 없이, 이야기는 조금 짧게, 문자열 안 줄바꿈은 \\n으로.' }],
  }, f);
  return { json: extractJson<T>(raw2), raw: raw2 };
}

/** completeJson의 답 글만 (부르는 쪽이 extractJson으로 다시 읽는다) */
export async function completeJsonText(s: LlmSettings, req: LlmRequest, f: Fetch = fetch): Promise<string> {
  return (await completeJson(s, req, undefined, f)).raw;
}
