// 판타지 모드의 AI 호출 (docs/fantasy-mode.md). 제공자 3종과 시험용 가짜 제공자.
// 서버가 없는 게임이라 플레이어 본인 키로 브라우저에서 바로 부른다. 키는 settings.ts가 브라우저에만 둔다.
// 이 파일은 fetch만 쓰고 게임 상태를 건드리지 않는다. 답은 부른 쪽이 조작 기록에 남긴다 (재현).

export type Provider = 'anthropic' | 'openai' | 'gemini' | 'mock';

export const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: 'Claude (Anthropic)', openai: 'OpenAI', gemini: 'Gemini (Google)', mock: '시험용 (AI 없이 정해진 글)',
};

/** 기본 모델 (2026-10-12. 바뀌면 설정에서 고치거나 모델 목록을 불러 고른다) */
export const DEFAULT_MODEL: Record<Provider, string> = {
  anthropic: 'claude-sonnet-5-5', openai: 'gpt-5.5', gemini: 'gemini-3.6-flash', mock: 'mock',
};

export interface LlmSettings {
  provider: Provider;
  model: string;
  key: string;
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

async function postJson(f: Fetch, url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await f(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  } catch (e) {
    throw new LlmError(`연결하지 못했습니다 (${(e as Error).message}). 인터넷 연결이나 제공자 주소 차단을 확인하세요.`);
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
  const res = await f(url, { headers });
  if (!res.ok) throw new LlmError(`모델 목록을 받지 못했습니다 (${res.status})`, res.status);
  return res.json();
}

/** AI에게 묻는다. 답의 글을 돌려준다 */
export async function complete(s: LlmSettings, req: LlmRequest, f: Fetch = fetch): Promise<string> {
  const max = req.maxTokens ?? 1200;
  if (s.provider === 'mock') return req.mockReply ?? '(시험용 답) 이번 주 경기는 계획대로 흘러갔다.';
  if (!s.key.trim()) throw new LlmError('API 키가 없습니다. 판타지 → AI 설정에서 넣으세요.');
  if (s.provider === 'anthropic') {
    const d = await postJson(f, 'https://api.anthropic.com/v1/messages', {
      'x-api-key': s.key.trim(), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true',
    }, { model: s.model, max_tokens: max, system: req.system, messages: req.messages }) as { content?: { type: string; text?: string }[] };
    return (d.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
  }
  if (s.provider === 'openai') {
    const d = await postJson(f, 'https://api.openai.com/v1/chat/completions', { authorization: `Bearer ${s.key.trim()}` }, {
      model: s.model, max_completion_tokens: max,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
    }) as { choices?: { message?: { content?: string } }[] };
    return d.choices?.[0]?.message?.content ?? '';
  }
  const d = await postJson(f, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.model)}:generateContent`, { 'x-goog-api-key': s.key.trim() }, {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: req.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    generationConfig: { maxOutputTokens: max },
  }) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return (d.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
}

/** 그 제공자가 쓸 수 있는 모델 이름 */
export async function listModels(s: LlmSettings, f: Fetch = fetch): Promise<string[]> {
  if (s.provider === 'mock') return ['mock'];
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

/** 답에서 JSON 하나를 꺼낸다 (코드 블록·앞뒤 설명이 붙어도). 없거나 깨졌으면 null */
export function extractJson<T = unknown>(text: string): T | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) return null;
  const open = body[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) {
      try { return JSON.parse(body.slice(start, i + 1)) as T; } catch { return null; }
    }
  }
  return null;
}
