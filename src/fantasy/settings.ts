// 판타지 모드 AI 설정 (제공자·모델·키). 이 브라우저(localStorage)에만 둔다: 저장 파일·내보내기·재현 정보에 들어가지 않는다.
import { DEFAULT_MODEL, type LlmSettings, type Provider } from './llm';

const KEY = 'kbo-fantasy-ai';

export function loadAiSettings(): LlmSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<LlmSettings>;
      const provider = (s.provider ?? 'anthropic') as Provider;
      return { provider, model: s.model || DEFAULT_MODEL[provider], key: s.key ?? '', ...(s.region ? { region: s.region } : {}) };
    }
  } catch { /* 저장소를 못 쓰면 기본값 */ }
  return { provider: 'anthropic', model: DEFAULT_MODEL.anthropic, key: '' };
}

export function saveAiSettings(s: LlmSettings): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

/** 키를 지운다 (제공자·모델은 남긴다) */
export function forgetAiKey(): void {
  const s = loadAiSettings();
  saveAiSettings({ ...s, key: '' });
}
