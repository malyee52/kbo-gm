// 이야기 글 하나에 삽화를 그린다: 글 → (글 AI가) 영어 그림 태그 → 다듬기(이름·로고 제거) + 구단 색 유니폼 → NovelAI → 이 브라우저에 저장.
// 글 AI가 없으면(키 없음) 정해 둔 장면 태그를 쓴다.
import type { GameSession } from '../game/session';
import { complete } from './llm';
import { loadAiSettings } from './settings';
import { colorWord, generateImage, loadNaiSettings, NAI_BASE_TAGS, sanitizeTags, seedOf } from './nai';
import { ILLUSTRATION_SYSTEM } from './prompts';
import { artKey, compactImage, putArt } from './images';
import type { FantasyEntry } from './types';

const FALLBACK: Record<FantasyEntry['kind'], string> = {
  article: 'wide shot, baseball stadium at night, stadium lights, cheering crowd, dynamic angle',
  chat: 'front office, desk, documents, two people talking, window view of a baseball field, warm light',
  event: 'dugout, players huddle, dramatic lighting, tension',
  memory: 'nostalgic, faded colors, empty baseball stadium at dusk, sunset',
};

/** 그림 지시문 (태그). 구단 색 유니폼과 기본·금지 태그를 붙인다 */
export async function illustrationPrompt(g: GameSession, e: FantasyEntry, colors: { primary: string; second: string }): Promise<string> {
  const s = loadAiSettings();
  let tags = FALLBACK[e.kind];
  const canText = s.provider === 'mock' ? false : !!s.key.trim();
  if (canText) {
    try {
      const raw = await complete(s, { system: ILLUSTRATION_SYSTEM, messages: [{ role: 'user', content: `${e.title}\n${e.text}` }], maxTokens: 200 });
      const banned = g.league.players.map((p) => p.name);
      const clean = sanitizeTags(raw, banned);
      if (clean.split(',').length >= 4) tags = clean;
    } catch { /* 태그를 못 받으면 정해 둔 장면 */ }
  }
  const uniform = `${colorWord(colors.primary)} and ${colorWord(colors.second)} baseball uniforms`;
  return `${tags}, ${uniform}, ${NAI_BASE_TAGS}`;
}

/** 삽화를 그려 저장하고 Blob을 돌려준다 */
export async function illustrate(g: GameSession, e: FantasyEntry, colors: { primary: string; second: string }): Promise<Blob> {
  const nai = loadNaiSettings();
  const key = artKey(g.league, e);
  const prompt = await illustrationPrompt(g, e, colors);
  const png = await generateImage(nai, prompt, seedOf(key));
  const blob = await compactImage(png);
  await putArt(key, blob);
  return blob;
}
