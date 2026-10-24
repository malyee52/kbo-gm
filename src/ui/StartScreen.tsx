// 시작 화면: 새 게임(연도, 구단, 시드)과 불러오기.
import { useEffect, useState } from 'react';
import { DIFFICULTY_LABEL, DIFFICULTY_NOTE, type Difficulty } from '../league/owner';
import { PRESETS, type DifficultySettings } from '../league/difficulty';
import { DifficultyEditor } from './DifficultyEditor';
import type { BrowserStore } from '../data/loadBrowser';
import { CHALLENGES, challengeById, planTeam } from '../league/challenges';
import { condText, PLAN_TIERS, type PlanKind, type Tier } from '../league/campaigns';
import { GameSession, type GameSave } from '../game/session';
import { deleteSave, isAutoSlot, listSaves, OUTDATED_NOTICE, purgeOutdatedSaves, readSaveFile, type SaveRecord } from '../game/storage';
import { isSeasonDone, whenText } from './saving';
import { ConfirmButton } from './ConfirmButton';
import { teamColor } from './teams';
import { PLAN_SYNOPSIS, SEASON_SYNOPSIS } from '../league/synopses';
import { AboutContent } from './screens/About';

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
  // 능력치 기준 (2026-10-12): 역사 재현이 기본
  const [basis, setBasis] = useState<'season' | 'prior'>('season');
  // 판타지 모드 (AI 이야기, docs/fantasy-mode.md)
  // 모드: 기본 / 판타지(AI 보조) / 자유(AI 진행)
  const [mode, setMode] = useState<'base' | 'fantasy' | 'free'>('base');
  const fantasy = mode !== 'base';
  const [regressor, setRegressor] = useState(false);
  const extra = { ...(custom ? { settings: custom } : {}), ratingBasis: basis,
    ...(fantasy ? { fantasy: { ...(regressor ? { regressor: true } : {}), ...(mode === 'free' ? { free: true } : {}) } } : {}) };
  const [loadedYear, setLoadedYear] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saves, setSaves] = useState<SaveRecord[] | null>(null);
  const [tier, setTier] = useState<Tier>('쉬움');
  const [kind, setKind] = useState<PlanKind>('season');
  const [startTab, setStartTab] = useState<'menu' | 'new' | 'challenge' | 'load'>('menu');

  useEffect(() => {
    let alive = true;
    setTeamIdx(null);
    store.ensureYear(year).then(() => alive && setLoadedYear(year), (e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [store, year]);

  const refreshSaves = () => listSaves().then(setSaves, () => setSaves([]));
  // 불러올 수 없는 예전 형식 저장은 지우고 한 번 알린다 (지운 뒤에는 남은 칸이 없어 다시 뜨지 않는다)
  const [purged, setPurged] = useState(false);
  // 가장 최근에 저장한 게임 (이어 하기)
  const latest = saves?.length ? [...saves].sort((x, y) => y.savedAt.localeCompare(x.savedAt))[0] : null;
  useEffect(() => {
    void purgeOutdatedSaves().then((n) => { if (n) setPurged(true); }, () => undefined).finally(() => void refreshSaves());
  }, []);

  const current = loadedYear === year ? store.season(year) : undefined;
  const prev = store.season(year - 1);
  // 시즌 자료의 league 칸이 두 가지인 해 = 드림·매직 양대 리그 (1999·2000, 일정 개편 기획안 10.6)
  const twoLeagues = (d: typeof prev) => !!d && d.teams.every((t) => t.league) && new Set(d.teams.map((t) => t.league)).size === 2;
  const prevSplit = twoLeagues(prev);

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
    <main className={`start${startTab === 'menu' ? ' title' : ''}`}>
      <header className="start-hero">
        <span className="eyebrow">단장 시뮬레이션 · 비영리 팬 프로젝트</span>
        <h1>KBO 단장 게임</h1>
        <p>실제 선수와 구단으로 하는 단장 시뮬레이션. 선수단을 꾸리면 경기는 AI 감독이 치릅니다.</p>
      </header>

      {error && <p className="error" role="alert">{error}</p>}
      {busy && <p className="note" role="status">{busy}</p>}
      {purged && <p className="note" role="status">{OUTDATED_NOTICE}</p>}

      {/* 2026-10-12 UI 개편: 타이틀 화면처럼 큰 메뉴에서 시작한다 (이어 하기 · 새 게임 · 도전 시나리오 · 불러오기). 고르면 그 화면, '처음으로'로 돌아온다 */}
      {startTab === 'menu' ? (
        <nav className="title-menu" aria-label="시작 메뉴">
          {latest && (
            <button type="button" className="title-btn primary" onClick={() => void load(latest.data)} disabled={!!busy}>
              <strong>이어 하기</strong>
              <span>{latest.year} {latest.teamName} · {whenText(latest, isSeasonDone(latest))}</span>
              <small>{latest.summary}</small>
            </button>
          )}
          <button type="button" className={`title-btn${latest ? '' : ' primary'}`} onClick={() => setStartTab('new')} disabled={!!busy}>
            <strong>새 게임</strong>
            <span>1982~2026, 원하는 해와 구단으로 단장 부임</span>
          </button>
          <button type="button" className="title-btn" onClick={() => setStartTab('challenge')} disabled={!!busy}>
            <strong>도전 시나리오</strong>
            <span>실제 구단의 그 시즌에서 시작하는 96가지 이야기</span>
          </button>
          <button type="button" className="title-btn" onClick={() => setStartTab('load')} disabled={!!busy}>
            <strong>불러오기</strong>
            <span>{saves?.length ? `저장 ${saves.length}개 · 파일에서 불러오기` : '파일에서 불러오기'}</span>
          </button>
        </nav>
      ) : (
        <button type="button" className="ghost back-btn" onClick={() => setStartTab('menu')} disabled={!!busy}>← 처음으로</button>
      )}

      <div className="start-body">
      {startTab === 'new' && (
      <section className="panel start-new">
        <div className="new-left">
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
        {SEASON_SYNOPSIS[year] && (
          <div className="season-syn" key={year}>
            <span className="small muted">{year} 시즌</span>
            <h3>{SEASON_SYNOPSIS[year].title}</h3>
            <p className="synopsis">{SEASON_SYNOPSIS[year].text}</p>
          </div>
        )}
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
        <div className="form-row">
          <label>
            능력치 기준
            <select value={basis} disabled={!!busy} onChange={(e) => setBasis(e.target.value as 'season' | 'prior')}>
              <option value="season">역사 재현 (그 시즌 성적 중심)</option>
              <option value="prior">예측 (직전 3시즌 성적)</option>
            </select>
          </label>
          <span className="muted small">{basis === 'season'
            ? '그 시즌 실제 성적을 중심으로 직전 두 시즌을 조금 섞습니다. 그해 강했던 팀이 강하게 시작합니다.'
            : '개막 전까지의 성적(직전 3시즌)만 봅니다. 그해 누가 터질지는 알 수 없습니다.'} 잠재력은 어느 쪽이든 선수가 실제로 보여 준 고점입니다.</span>
        </div>
        <div className="form-row">
          <label>
            게임 모드
            <select value={mode} disabled={!!busy} onChange={(e) => setMode(e.target.value as 'base' | 'fantasy' | 'free')}>
              <option value="base">기본</option>
              <option value="fantasy">판타지 (AI 보조: 기사·대화·사건·설득)</option>
              <option value="free">자유 모드 (AI 진행: 무엇이든 하면 AI가 판정)</option>
            </select>
          </label>
          <span className="muted small">{mode === 'base' ? '실제 기록과 규칙대로 운영합니다.'
            : mode === 'fantasy' ? '본인의 AI API 키로 AI가 기사·대화·사건을 만들고, 설득이 트레이드·계약 판단에 들어갑니다.'
              : '"행동" 칸에 무엇이든 쓰면 AI 게임 마스터가 판정해 트레이드·영입·선수 능력·자금까지 바로 바꿉니다. 기존 화면도 함께 씁니다.'} 게임 안 "오늘 → 판타지"에서 키를 넣습니다.</span>
        </div>
        {fantasy && (
          <div className="form-row">
            <label className="inline">
              <input type="checkbox" checked={regressor} disabled={!!busy} onChange={(e) => setRegressor(e.target.checked)} />
              회귀자 (원래 역사를 기억하는 단장)
            </label>
            <span className="muted small">판타지 → 기억 노트에 시작 뒤 실제 시즌의 순위·우승·타이틀, 앞으로 터질 선수, 다가올 드래프트의 대어가 보입니다 (자료가 있는 2026년까지). 게임이 원래 역사와 갈라지면 표시합니다.</span>
          </div>
        )}
        <p className="muted small">같은 연도·구단·시드·난이도에서 같은 조작을 하면 결과가 똑같이 나옵니다. 버그를 보고할 때 시드를 함께 적어 주세요.</p>
        {twoLeagues(current) && <p className="note small">{year}년은 드림·매직 양대 리그입니다. 각 리그 1·2위가 가을야구에 나가고, 한 리그 3위 승률이 다른 리그 2위보다 높으면 둘이 준플레이오프를 치릅니다.</p>}
        {year < 2001 && <p className="note small">과거 시대: 외국인(1998년)·FA(1999년 시즌 뒤) 제도는 도입 연도부터 생기고, 창단·명칭 변경·승계는 실제 연도에 일어납니다. 생년이 없는 선수의 나이는 추정값("약 N세")이고, 1980년대 득점은 실제보다 조금 높습니다.</p>}
        {store.meta.inProgress.includes(year) && (
          <p className="note small">{year}년 선수단은 시즌 중 자료(정규시즌 종료 전 스냅샷)로 만듭니다. 능력은 직전 3시즌 기록에서 뽑습니다.</p>
        )}

        </div>
        <div className="new-right">
        <h3>구단 선택</h3>
        {!current ? (
          <p className="muted">구단 목록을 불러오는 중입니다.</p>
        ) : (
          // 구단 수에 맞춰 두 줄로 고르게 (6팀 3×2, 8팀 4×2, 10팀 5×2; 7·9팀은 위 줄이 하나 더). 2026-10-12 사용자: 3·3·3·1 배치가 보기 좋지 않다
          <div className="team-grid start-teams" role="radiogroup" aria-label="구단" style={{ ['--cols' as string]: String(Math.ceil(current.teams.length / 2)) }}>
            {current.teams.map((t, i) => {
              const last = prev?.teams.find((x) => x.franchise === t.franchise);
              // 지난해가 양대 리그 해(1999·2000)면 리그 안 승률 순 ("1999년 드림 2위"). 자료 rank는 가을야구를 반영한 리그별 최종 순위라 쓰지 않는다
              const lastText = !last ? `${year}년 첫 시즌` : prevSplit && last.league
                ? `${year - 1}년 ${last.league} ${prev!.teams.filter((x) => x.league === last.league).sort((a, b) => b.pct - a.pct || b.w - a.w).indexOf(last) + 1}위`
                : `${year - 1}년 ${last.rank}위`;
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
                  <span className="muted small">{lastText}</span>
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
        </div>
      </section>

      )}
      {startTab === 'challenge' && (<>
      <section className="panel">
        <h2>도전 시나리오 <span className="muted small">실제 구단의 그 시즌 개막에서 시작</span></h2>
        <details className="help small">
          <summary>규칙</summary>
          시즌 도전 36개와 장기 캠페인 60개를 실제 난이도로 나눴습니다. 쉬움은 실제로 압도적으로 우승한 팀, 중간은 강팀이었지만 우승에 닿지 못한 팀, 어려움은 최하위권이나 암흑기의 팀입니다. 위의 난이도·시드를 그대로 씁니다. 시놉시스와 실제 시즌 배경은 실제 역사에서 착안한 소개이고, 목표·기한은 게임용 설정입니다.
          여러 단계가 있으면 마지막 단계가 클리어 조건이고, 모든 단계를 기한 안에 이루면 완전 클리어입니다. 자체 육성 주전은 시작 때 만 23세 이하이거나 그 뒤 직접 지명한 선수 가운데 그 시즌 300타석·80이닝·구원 40경기를 넘긴 선수입니다.
        </details>
        <div className="seg" role="tablist" aria-label="종류">
          {(['season', 'long'] as PlanKind[]).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k === 'season' ? '시즌 도전' : '장기 캠페인'}</button>
          ))}
        </div>
        <div className="seg" role="tablist" aria-label="난이도">
          {PLAN_TIERS.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tier === k} className={tier === k ? 'on' : ''} onClick={() => setTier(k)}>{k} <span className="muted small">{CHALLENGES.filter((c) => c.plan && !c.plan.legacy && c.plan.kind === kind && c.plan.tier === k).length}</span></button>
          ))}
        </div>
        <div className="scenario-grid">
          {CHALLENGES.filter((c) => c.plan && !c.plan.legacy && c.plan.kind === kind && c.plan.tier === tier).map((ch) => {
            const p = ch.plan!;
            const syn = PLAN_SYNOPSIS[p.no];
            return (
              <div key={ch.id} className="scenario-card">
                <div className="row-between"><strong>{p.no} · {p.year} {nameIn(p.franchise, p.year)}</strong><span className="muted small">{ch.years > 1 ? `${p.year}~${p.year + ch.years - 1} · ` : ''}{ch.years}시즌</span></div>
                <h3>{p.title}</h3>
                {syn && <p className="synopsis">{syn.text}</p>}
                {syn?.figures && <p className="small muted">상징 인물: {syn.figures}</p>}
                {p.stages.length === 1
                  ? <p className="small" title={p.stages[0].conds.map(condText).join(', ')}>목표: <strong>{p.stages[0].label}</strong></p>
                  : (
                    <ol className="small plain-ol">
                      {p.stages.map((st, i) => <li key={i} title={st.conds.map(condText).join(', ')}>{i === p.stages.length - 1 ? <strong>최종: {st.label}</strong> : st.label}</li>)}
                    </ol>
                  )}
                <p className="small muted">{p.kind === 'long' ? '실제 그 시대' : '실제'}: {p.background}{p.fun ? ` · ${p.fun}` : ''}{p.budget ? ` · 연봉 상한: 리그 평균의 ${Math.round(p.budget * 100)}%` : ''}</p>
                <button type="button" onClick={() => void startPlan(ch.id)} disabled={!!busy}>이 도전으로 시작</button>
              </div>
            );
          })}
        </div>
      </section>


      </>)}
      {startTab === 'load' && (
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
                  <span className="muted small">{isAutoSlot(s.slot) ? '자동 저장' : s.slot}{s.label ? ` "${s.label}"` : ''} · {new Date(s.savedAt).toLocaleString('ko-KR')}</span>
                  <br />
                  <strong>{s.year} {s.teamName}</strong> <span className="muted">· {whenText(s, isSeasonDone(s))}</span>
                </div>
                <div className="r-actions">
                  <button type="button" onClick={() => void load(s.data)} disabled={!!busy}>불러오기</button>
                  <ConfirmButton label="지우기" confirmLabel="정말 지우기" disabled={!!busy}
                    onConfirm={() => void deleteSave(s.slot).then(refreshSaves)} />
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
      )}
      </div>

      <footer className="small">
        <p>
          KBO 및 각 구단과 관련 없는 비영리 팬 프로젝트입니다. 구단 로고와 선수 사진은 쓰지 않습니다.
          {import.meta.env.DEV && <> · <a href="?lab">엔진 시험 화면</a></>}
        </p>
        <details>
          <summary>정보·출처 (자료 출처, 라이선스, 규정 요약, AI 기능)</summary>
          <AboutContent />
        </details>
      </footer>
    </main>
  );
}

