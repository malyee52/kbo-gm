// 시작 화면: 새 게임(연도, 구단, 시드)과 불러오기.
import { useEffect, useState } from 'react';
import { DIFFICULTY_LABEL, DIFFICULTY_NOTE, type Difficulty } from '../league/owner';
import type { BrowserStore } from '../data/loadBrowser';
import { GameSession, type GameSave } from '../game/session';
import { deleteSave, listSaves, readSaveFile, type SaveRecord } from '../game/storage';
import { whenText } from './saving';
import { teamColor } from './teams';

const DEFAULT_YEAR = 2026;

function randomSeed(): string {
  // 시드 입력칸의 기본값만 무작위로 채운다. 엔진은 이 문자열만 받는다
  return Math.floor(Math.random() * 1e8).toString(36);
}

/** 오래 걸리는 계산 전에 "준비 중" 표시가 먼저 그려지게 한 프레임 쉰다 */
const nextFrame = () => new Promise((r) => setTimeout(r, 30));

export function StartScreen({ store, onStart }: { store: BrowserStore; onStart: (s: GameSession) => void }) {
  const years = [...store.meta.years].reverse();
  const [year, setYear] = useState(years.includes(DEFAULT_YEAR) ? DEFAULT_YEAR : years[0]);
  const [teamIdx, setTeamIdx] = useState<number | null>(null);
  const [seed, setSeed] = useState(randomSeed);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [loadedYear, setLoadedYear] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saves, setSaves] = useState<SaveRecord[] | null>(null);

  useEffect(() => {
    let alive = true;
    setTeamIdx(null);
    store.ensureYear(year).then(() => alive && setLoadedYear(year), (e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [store, year]);

  const refreshSaves = () => listSaves().then(setSaves, () => setSaves([]));
  useEffect(() => { void refreshSaves(); }, []);

  const current = loadedYear === year ? store.season(year) : undefined;
  const prev = store.season(year - 1);

  const start = async () => {
    if (teamIdx === null || !seed.trim()) return;
    setBusy('선수 기록과 계약 자료를 불러오는 중입니다');
    setError(null);
    try {
      await store.ensureAll();
      setBusy('리그를 만들고 시즌을 준비하는 중입니다 (잠재력 산출, 리그 환경 맞춤)');
      await nextFrame();
      onStart(GameSession.create(store, { year, teamIdx, seed: seed.trim(), difficulty }));
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  const load = async (save: GameSave) => {
    setBusy('저장한 게임을 불러오는 중입니다');
    setError(null);
    await nextFrame();
    try {
      await store.ensureAll();
      onStart(GameSession.load(store, save));
    } catch (e) {
      setError(`불러오지 못했습니다: ${(e as Error).message}`);
      setBusy(null);
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      await load(await readSaveFile(file));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <main className="start">
      <header>
        <h1>KBO 단장 게임</h1>
        <p className="muted">실제 선수와 구단으로 하는 단장 시뮬레이션. 선수단을 꾸리면 경기는 AI 감독이 치릅니다.</p>
      </header>

      {error && <p className="error" role="alert">{error}</p>}
      {busy && <p className="note" role="status">{busy}</p>}

      <section className="panel">
        <h2>새 게임</h2>
        <div className="form-row">
          <label>
            시작 연도
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} disabled={!!busy}>
              {years.map((y) => <option key={y} value={y}>{y}{store.meta.inProgress.includes(y) ? ' (시즌 중 자료)' : ''}</option>)}
            </select>
          </label>
          <label>
            시드
            <span className="inline">
              <input value={seed} onChange={(e) => setSeed(e.target.value)} size={12} disabled={!!busy} spellCheck={false} />
              <button type="button" className="ghost" onClick={() => setSeed(randomSeed())} disabled={!!busy}>바꾸기</button>
            </span>
          </label>
        </div>
        <div className="form-row">
          <label>
            난이도
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)} disabled={!!busy}>
              {(Object.keys(DIFFICULTY_LABEL) as Difficulty[]).map((d) => <option key={d} value={d}>{DIFFICULTY_LABEL[d]}</option>)}
            </select>
          </label>
          <span className="muted small">{DIFFICULTY_NOTE[difficulty]}</span>
        </div>
        <p className="muted small">같은 연도·구단·시드·난이도에서 같은 조작을 하면 결과가 똑같이 나옵니다. 버그를 보고할 때 시드를 함께 적어 주세요.</p>
        {year < 2001 && <p className="note small">2000년 이전은 선발 투수 기용 방식이 지금과 달라 득점이 실제보다 높게 나옵니다 (M8에서 보정 예정).</p>}
        {store.meta.inProgress.includes(year) && (
          <p className="note small">{year}년 선수단은 시즌 중 자료(정규시즌 종료 전 스냅샷)로 만듭니다. 능력은 직전 3시즌 기록에서 뽑습니다.</p>
        )}

        <h3>구단 선택</h3>
        {!current ? (
          <p className="muted">구단 목록을 불러오는 중입니다.</p>
        ) : (
          <div className="team-grid" role="radiogroup" aria-label="구단">
            {current.teams.map((t, i) => {
              const last = prev?.teams.find((x) => x.franchise === t.franchise);
              return (
                <button
                  key={t.name}
                  type="button"
                  role="radio"
                  aria-checked={teamIdx === i}
                  className={`team-card${teamIdx === i ? ' on' : ''}`}
                  style={{ borderLeftColor: teamColor(t.franchise) }}
                  onClick={() => setTeamIdx(i)}
                  disabled={!!busy}
                >
                  <strong>{t.name}</strong>
                  <span className="muted small">{last ? `${year - 1}년 ${last.rank}위` : `${year}년 첫 시즌`}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="actions">
          <button type="button" onClick={() => void start()} disabled={teamIdx === null || !seed.trim() || !!busy}>
            {teamIdx === null ? '구단을 고르세요' : `${current?.teams[teamIdx]?.name ?? ''} 단장으로 시작`}
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>불러오기</h2>
        {saves === null ? (
          <p className="muted">저장 목록을 읽는 중입니다.</p>
        ) : saves.length === 0 ? (
          <p className="muted">브라우저에 저장한 게임이 없습니다.</p>
        ) : (
          <div className="scroll">
            <table>
              <thead><tr><th className="l">칸</th><th className="l">구단</th><th className="l">진행</th><th className="l">성적</th><th className="l">저장 시각</th><th /></tr></thead>
              <tbody>
                {saves.map((s) => (
                  <tr key={s.slot}>
                    <td className="l">{s.slot === 'auto' ? '자동 저장' : s.slot}</td>
                    <td className="l">{s.year} {s.teamName}</td>
                    <td className="l">{whenText(s, isSeasonDone(s))}</td>
                    <td className="l">{s.summary}</td>
                    <td className="l muted">{new Date(s.savedAt).toLocaleString('ko-KR')}</td>
                    <td className="r-actions">
                      <button type="button" onClick={() => void load(s.data)} disabled={!!busy}>불러오기</button>
                      <button type="button" className="ghost danger" disabled={!!busy}
                        onClick={() => void deleteSave(s.slot).then(refreshSaves)}>지우기</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="actions">
          <label className="file-btn">
            파일에서 불러오기
            <input type="file" accept="application/json,.json" onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ''; }} disabled={!!busy} />
          </label>
        </div>
      </section>

      <footer className="muted small">
        KBO 및 각 구단과 관련 없는 팬 프로젝트입니다. 구단 로고와 선수 사진은 쓰지 않습니다. · <a href="?lab">엔진 시험 화면</a>
      </footer>
    </main>
  );
}

/** 저장 기록이 시즌 종료(또는 오프시즌) 상태인지 */
function isSeasonDone(s: SaveRecord): boolean {
  if (s.data.format === 2 && s.data.phase === 'offseason') return true;
  return s.data.news.some((n) => (n.year ?? s.year) === s.year && n.kind === 'season' && n.text.startsWith('정규시즌 종료'));
}
