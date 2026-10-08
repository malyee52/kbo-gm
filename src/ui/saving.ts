// 화면에서 쓰는 저장 도우미: 세션 → 저장 기록, 파일 이름.
import { formatDate } from '../game/calendar';
import type { GameSession } from '../game/session';
import { exportFile, putSave, type SaveRecord } from '../game/storage';

export function summaryOf(s: GameSession): string {
  const t = s.season.teams[s.teamIdx];
  const rank = s.season.standings().indexOf(s.teamIdx) + 1;
  return t.g === 0 ? '개막 전' : `${t.w}승 ${t.l}패 ${t.t}무 · ${rank}위`;
}

export function recordOf(s: GameSession, slot: string): SaveRecord {
  return {
    slot,
    savedAt: new Date().toISOString(),
    year: s.world.year,
    teamName: s.team.name,
    day: s.day,
    summary: summaryOf(s),
    data: s.toSave(),
  };
}

export function saveSession(s: GameSession, slot: string): Promise<unknown> {
  return putSave(recordOf(s, slot));
}

export function exportSession(s: GameSession): void {
  exportFile(s.toSave(), `kbo-gm_${s.world.year}_${s.team.name}_${s.day}일차.json`);
}

/** 저장 목록에 보여줄 진행 시점 */
export function whenText(rec: Pick<SaveRecord, 'year' | 'day'>, done: boolean): string {
  if (done) return `${rec.year} 시즌 종료`;
  return formatDate(rec.year, rec.day, true);
}
