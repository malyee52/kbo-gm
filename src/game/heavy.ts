// 오래 걸리는 진행 (2026-11-25 사용자 결정 Q55): 새 게임 만들기·시즌 결산·다음 시즌 개막·개막 미리 보기.
// 환경 맞춤(예비 시즌) 때문에 몇 초씩 걸려, 화면은 이것을 Web Worker(game/heavy.worker.ts)에서 돌리고
// 결과 저장을 받아 불러온다(GameSession.load·adopt). Worker를 못 쓰면 같은 함수를 본 스레드에서 부른다 (ui/heavy.ts).
// 순수 함수라 Node 시험에서 그대로 부른다. 같은 저장·같은 조건이면 어디서 돌려도 결과가 같다 (Rng만 쓴다).
import { DEFAULT_PARAMS, type EngineParams } from '../engine';
import { GameSession, type GameSave, type NewGameOptions } from './session';

export type HeavyJob =
  | { kind: 'create'; opts: NewGameOptions }
  /** 정규시즌이 끝난 저장 → 결산(beginOffseason) 뒤 저장 */
  | { kind: 'begin-off'; save: GameSave }
  /** 개막 준비 단계 저장 → 다음 시즌 개막(openNextSeason) 뒤 저장 */
  | { kind: 'open'; save: GameSave }
  /** 개막 준비 단계 저장 → 개막 미리 보기 세션(previewOpening)의 저장 */
  | { kind: 'preview'; save: GameSave };

export type HeavyResult = { ok: true; save: GameSave; message?: string } | { ok: false; message: string };

type Store = Parameters<typeof GameSession.create>[0];

export function runHeavyJob(store: Store, job: HeavyJob, params: EngineParams = DEFAULT_PARAMS): HeavyResult {
  if (job.kind === 'create') return { ok: true, save: GameSession.create(store, job.opts, params).toSave() };
  const g = GameSession.load(store, job.save, params);
  if (job.kind === 'begin-off') {
    g.beginOffseason();
    return { ok: true, save: g.toSave() };
  }
  if (job.kind === 'open') {
    const r = g.openNextSeason();
    return r.ok ? { ok: true, save: g.toSave(), message: r.message } : { ok: false, message: r.message };
  }
  const p = g.previewOpening();
  return p ? { ok: true, save: p.toSave() } : { ok: false, message: '개막 미리 보기를 만들 수 없습니다' };
}
