// 화면에서 쓰는 저장 도우미: 세션 → 저장 기록, 파일 이름.
import { formatDate } from '../game/calendar';
import type { GameSession, ReproInfo } from '../game/session';
import { rankText } from '../game/rank';
import { autoSlotOf, exportFile, getSaveInfo, pruneAutoSaves, putSave, type SaveInfo, type SaveRecord } from '../game/storage';

export function summaryOf(s: GameSession): string {
  if (s.phase === 'offseason') {
    const rank = rankText(s, s.teamIdx);
    return `오프시즌${rank ? ` · 지난 시즌 ${rank}` : ''}`;
  }
  const t = s.season.teams[s.teamIdx];
  return t.g === 0 ? '개막 전' : `${t.w}승 ${t.l}패 ${t.t}무 · ${rankText(s, s.teamIdx)}`;
}

export function recordOf(s: GameSession, slot: string): SaveRecord {
  return {
    slot,
    savedAt: new Date().toISOString(),
    year: s.world.year,
    teamName: s.league.teams[s.teamIdx].name,
    day: s.day,
    summary: summaryOf(s),
    data: s.toSave(),
  };
}

/** 칸에 저장한다. 붙여 둔 이름은 그대로 둔다 */
export async function saveSession(s: GameSession, slot: string): Promise<unknown> {
  const label = (await getSaveInfo(slot))?.label;
  return putSave({ ...recordOf(s, slot), ...(label ? { label } : {}) });
}

/** 이 게임의 자동 저장 칸 */
export function autoSlotFor(s: GameSession): string {
  return autoSlotOf(s.league.startYear, s.league.seed);
}

/** 자동 저장: 이 게임의 칸에 덮어쓰고, 다른 게임의 자동 저장은 최근 AUTO_KEEP개만 남긴다 (예전 'auto' 칸은 건드리지 않는다).
 *  정리는 요약 store만 읽는다 (2026-11-11 편의 P1: 예전에는 진행마다 모든 칸을 데이터째 읽었다) */
export async function autosaveSession(s: GameSession): Promise<void> {
  const slot = autoSlotFor(s);
  await putSave(recordOf(s, slot));
  await pruneAutoSaves(slot);
}

export function exportSession(s: GameSession): void {
  exportFile(s.toSave(), `kbo-gm_${s.world.year}_${s.teamInfo(s.teamIdx).name}_${s.day}일차.json`);
}

/** 버그 보고용 재현 정보: 새 게임 조건 + 조작 기록 + 데이터 지문. opts·actions·at을 `GameSession.replay`에 넣으면 된다 */
export interface ReproReport extends ReproInfo {
  app: 'kbo-gm';
  /** 처음 맡은 구단 이름 (지금 이름. 명칭 변경이 있었으면 그 뒤 이름) */
  team: string;
  /** 데이터 지문. 다르면 같은 시드로도 재현되지 않는다 */
  data: string;
}

export function reproOf(s: GameSession): ReproReport {
  const info = s.reproInfo();
  return { app: 'kbo-gm', ...info, team: s.league.teams[info.opts.teamIdx]?.name ?? '', data: s.season.baseRoster };
}

/** 저장 목록에 보여줄 진행 시점 (요약만으로) */
export function whenText(rec: Pick<SaveInfo, 'year' | 'day' | 'offseason' | 'done'>): string {
  if (rec.offseason) return `${rec.year} 오프시즌`;
  if (rec.done) return `${rec.year} 시즌 종료`;
  return formatDate(rec.year, rec.day, true);
}
