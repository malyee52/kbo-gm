// 시작 화면: 새 게임(연도, 구단, 시드)과 불러오기.
import { useEffect, useState } from 'react';
import { DIFFICULTY_LABEL, DIFFICULTY_NOTE, type Difficulty } from '../league/owner';
import { PRESETS, type DifficultySettings } from '../league/difficulty';
import { DifficultyEditor } from './DifficultyEditor';
import type { BrowserStore } from '../data/loadBrowser';
import { CHALLENGES, challengeById, lastPlaceTeam, planTeam } from '../league/challenges';
import { condText, type Tier } from '../league/campaigns';
import { GameSession, type GameSave } from '../game/session';
import { deleteSave, isAutoSlot, listSaves, readSaveFile, type SaveRecord } from '../game/storage';
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
  // 사용자 설정 (세부 난이도). null이면 difficulty 묶음
  const [custom, setCustom] = useState<DifficultySettings | null>(null);
  const extra = custom ? { settings: custom } : {};
  const [loadedYear, setLoadedYear] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saves, setSaves] = useState<SaveRecord[] | null>(null);
  const [tier, setTier] = useState<Tier>('하');

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
      onStart(GameSession.create(store, { year, teamIdx, seed: seed.trim(), difficulty, ...extra }));
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  /** 기획안 도전으로 시작: 정해진 시즌·구단 (league/campaigns.ts). 난이도·시드는 위에서 고른 값 */
  const startPlan = async (id: string) => {
    const ch = challengeById(id)!;
    const plan = ch.plan!;
    setBusy(`「${ch.title}」을 준비하는 중입니다`);
    setError(null);
    try {
      await store.ensureAll();
      const t = planTeam(store, ch);
      if (t === null) throw new Error(`${plan.year}년 자료에서 구단을 찾을 수 없습니다`);
      await nextFrame();
      onStart(GameSession.create(store, { year: plan.year, teamIdx: t, seed: seed.trim() || randomSeed(), difficulty, challenge: ch.id, ...extra }));
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };
  /** 그 해 계보의 구단 이름 (시즌 자료를 불러오기 전에도 meta로) */
  const nameIn = (franchise: string, y: number) => store.meta.franchises[franchise]?.find((x) => x.from <= y && y <= x.to)?.name ?? franchise;

  /** 도전 모드로 시작: 위에서 고른 연도·구단 (꼴찌 조건이면 직전 시즌 최하위 구단) */
  const challengeTeam = (id: string): number | null => {
    const ch = challengeById(id)!;
    if (ch.team === 'last') return current ? lastPlaceTeam(store, year) : null;
    return teamIdx;
  };
  const startChallenge = async (id: string) => {
    const ch = challengeById(id)!;
    const t = challengeTeam(id);
    if (t === null || !seed.trim()) return;
    setBusy(`도전 「${ch.title}」을 준비하는 중입니다`);
    setError(null);
    try {
      await store.ensureAll();
      await nextFrame();
      onStart(GameSession.create(store, { year, teamIdx: t, seed: seed.trim(), difficulty, challenge: ch.id, ...extra }));
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
      <header className="start-hero">
        <span className="eyebrow">단장 시뮬레이션 · 비영리 팬 프로젝트</span>
        <h1>KBO 단장 게임</h1>
        <p>실제 선수와 구단으로 하는 단장 시뮬레이션. 선수단을 꾸리면 경기는 AI 감독이 치릅니다.</p>
      </header>

      {error && <p className="error" role="alert">{error}</p>}
      {busy && <p className="note" role="status">{busy}</p>}

      <div className="start-grid">
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
            <select value={custom ? 'custom' : difficulty} disabled={!!busy} onChange={(e) => {
              const v = e.target.value;
              if (v === 'custom') setCustom({ ...PRESETS[difficulty] });
              else { setCustom(null); setDifficulty(v as Difficulty); }
            }}>
              {(Object.keys(DIFFICULTY_LABEL) as Difficulty[]).map((d) => <option key={d} value={d}>{DIFFICULTY_LABEL[d]}</option>)}
              <option value="custom">사용자 설정</option>
            </select>
          </label>
          <span className="muted small">{custom ? '항목마다 고릅니다. 게임 중에도 저장·설정 화면에서 바꿀 수 있습니다.' : `${DIFFICULTY_NOTE[difficulty]} 등. 게임 중에도 저장·설정 화면에서 바꿀 수 있습니다.`}</span>
        </div>
        {custom && <DifficultyEditor value={custom} onChange={setCustom} disabled={!!busy} />}
        <p className="muted small">같은 연도·구단·시드·난이도에서 같은 조작을 하면 결과가 똑같이 나옵니다. 버그를 보고할 때 시드를 함께 적어 주세요.</p>
        {year < 2001 && <p className="note small">과거 시대: 외국인(1998년)·FA(1999년 시즌 뒤) 제도는 도입 연도부터 생기고, 창단·명칭 변경·승계는 실제 연도에 일어납니다. 생년이 없는 선수의 나이는 추정값("약 N세")이고, 1980년대 득점은 실제보다 조금 높습니다.</p>}
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
                  style={{ ['--c' as string]: teamColor(t.franchise, t.name) }}
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
        <h2>도전 모드 <span className="muted small">{year}년 시작</span></h2>
        <p className="muted small">위에서 고른 시작 연도·구단·난이도·시드로 시작합니다. "직전 시즌 최하위" 도전은 구단이 정해집니다. 결산 때마다 판정하고, 끝난 뒤에도 그대로 이어서 할 수 있습니다.</p>
        <div className="scenario-grid">
          {CHALLENGES.filter((c) => !c.plan).map((ch) => {
            const t = challengeTeam(ch.id);
            const name = t !== null ? current?.teams[t]?.name : undefined;
            return (
              <div key={ch.id} className="scenario-card">
                <div className="row-between"><strong>{ch.title}</strong><span className="muted small">{ch.years}시즌</span></div>
                <p className="small">{ch.intro}</p>
                <p className="muted small">{ch.team === 'last' ? (name ? `구단: ${name} (${year - 1} 최하위)` : `${year - 1}년 자료가 없어 고를 수 없습니다`) : name ? `구단: ${name}` : '위에서 구단을 고르세요'}</p>
                <button type="button" onClick={() => void startChallenge(ch.id)} disabled={!!busy || t === null || !seed.trim()}>이 도전으로 시작</button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <h2>도전 시나리오 <span className="muted small">실제 구단의 그 시즌 개막에서 시작</span></h2>
        <p className="muted small">
          시즌 도전 30개(난이도 하·중·상)와 장기 캠페인 10개입니다. 위의 난이도·시드를 그대로 씁니다. 실제 시즌 배경은 참고 문구이고 목표·기한은 게임용 설정입니다.
          여러 단계가 있으면 마지막 단계가 클리어 조건이고, 모든 단계를 기한 안에 이루면 완전 클리어입니다. 자체 육성 주전은 시작 때 만 23세 이하이거나 그 뒤 직접 지명한 선수 가운데 그 시즌 300타석·80이닝·구원 40경기를 넘긴 선수입니다.
        </p>
        <div className="seg" role="tablist" aria-label="난이도">
          {(['하', '중', '상', '장기'] as Tier[]).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tier === k} className={tier === k ? 'on' : ''} onClick={() => setTier(k)}>{k === '장기' ? '장기 캠페인' : `난이도 ${k}`}</button>
          ))}
        </div>
        <div className="scenario-grid">
          {CHALLENGES.filter((c) => c.plan?.tier === tier).map((ch) => {
            const p = ch.plan!;
            return (
              <div key={ch.id} className="scenario-card">
                <div className="row-between"><strong>{p.no} · {p.year} {nameIn(p.franchise, p.year)}</strong><span className="muted small">{ch.years}시즌</span></div>
                <h3>{p.title}</h3>
                <p className="small muted">{p.tier === '장기' ? '기간' : '실제'}: {p.background}</p>
                {p.stages.length === 1
                  ? <p className="small" title={p.stages[0].conds.map(condText).join(', ')}>목표: {p.stages[0].label}</p>
                  : (
                    <ol className="small plain-ol">
                      {p.stages.map((st, i) => <li key={i} title={st.conds.map(condText).join(', ')}>{i === p.stages.length - 1 ? <strong>최종: {st.label}</strong> : st.label}</li>)}
                    </ol>
                  )}
                <p className="small muted">{p.fun}{p.budget ? ` · 연봉 상한: 리그 평균의 ${Math.round(p.budget * 100)}%` : ''}</p>
                <button type="button" onClick={() => void startPlan(ch.id)} disabled={!!busy}>이 도전으로 시작</button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <h2>불러오기</h2>
        {saves === null ? (
          <p className="muted">저장 목록을 읽는 중입니다.</p>
        ) : saves.length === 0 ? (
          <p className="muted">브라우저에 저장한 게임이 없습니다.</p>
        ) : (
          <div className="save-list">
            {saves.map((s) => (
              <div key={s.slot} className="save-item">
                <div>
                  <span className="muted small">{isAutoSlot(s.slot) ? '자동 저장' : s.slot} · {new Date(s.savedAt).toLocaleString('ko-KR')}</span>
                  <br />
                  <strong>{s.year} {s.teamName}</strong> <span className="muted">· {whenText(s, isSeasonDone(s))}</span>
                </div>
                <div className="r-actions">
                  <button type="button" onClick={() => void load(s.data)} disabled={!!busy}>불러오기</button>
                  <button type="button" className="ghost danger" disabled={!!busy}
                    onClick={() => void deleteSave(s.slot).then(refreshSaves)}>지우기</button>
                </div>
                <span className="small">{s.summary}</span>
              </div>
            ))}
          </div>
        )}
        <div className="actions">
          <label className="file-btn">
            파일에서 불러오기
            <input type="file" accept="application/json,.json" onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ''; }} disabled={!!busy} />
          </label>
        </div>
      </section>
      </div>

      <footer className="small">
        <p>
          KBO 및 각 구단과 관련 없는 비영리 팬 프로젝트입니다. 구단 로고와 선수 사진은 쓰지 않습니다.
          {import.meta.env.DEV && <> · <a href="?lab">엔진 시험 화면</a></>}
        </p>
        <details>
          <summary>데이터 출처</summary>
          <ul>
            <li>선수·시즌 기록: 공개된 KBO 기록을 정리한 자료집 (원자료는 제3자 수집본으로 라이선스를 확인하지 못했습니다).</li>
            <li>
              신인 지명 1982~2027: <a href="https://baseballchart.kr/draft" target="_blank" rel="noreferrer">baseballchart.kr</a>
              {' '}(나무위키 「(연도) KBO 신인 드래프트」 문서 정리), CC BY-NC-SA 2.0 KR. 게임 안에서 지명은 다시 하고 능력은 추정값입니다.
            </li>
            <li>
              병역: 2026 선수 프로필 경력의 상무·경찰 복무와 국제대회 금메달 대표팀 명단(위키백과 메달리스트 표, 2026 아시안게임은 언론 보도의 면제자 명단).
              자료에 없는 현역·사회복무는 나이와 1군 기록 공백으로 짐작합니다.
            </li>
            <li>2026 외국인 개막 명단·아시아쿼터, 수비 능력은 기록에서 추정한 값입니다.</li>
          </ul>
        </details>
      </footer>
    </main>
  );
}

/** 저장 기록이 시즌 종료(또는 오프시즌) 상태인지 */
function isSeasonDone(s: SaveRecord): boolean {
  if (s.data.format === 2 && s.data.phase === 'offseason') return true;
  return s.data.news.some((n) => (n.year ?? s.year) === s.year && n.kind === 'season' && n.text.startsWith('정규시즌 종료'));
}
