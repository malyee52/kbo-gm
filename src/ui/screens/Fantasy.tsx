// 판타지 모드 화면 (docs/fantasy-mode.md): 이야기(AI 기사·대화·사건 기록)와 AI 설정.
import { useEffect, useState } from 'react';
import { complete, DEFAULT_MODEL, listModels, LlmError, PROVIDER_LABEL, type LlmSettings, type Provider } from '../../fantasy/llm';
import { forgetAiKey, loadAiSettings, saveAiSettings } from '../../fantasy/settings';
import { parseServiceAccount } from '../../fantasy/vertex';
import { generateImage, loadNaiSettings, NAI_DEFAULT_MODEL, NAI_MODEL_HINTS, saveNaiSettings, type NaiSettings } from '../../fantasy/nai';
import { illustrate } from '../../fantasy/illustrate';
import { artKey, getArt } from '../../fantasy/images';
import type { FantasyEntry } from '../../fantasy/types';
import { teamPalette } from '../teams';
import { FantasyMemory } from './FantasyMemory';
import { FantasyChat } from './FantasyChat';
import { FantasyFree } from './FantasyFree';
import { ChoiceButtons } from './FantasyChoices';
import { AUTO_EVENT_EVERY, makeEvent } from '../../fantasy/ai';
import { gameContext } from '../../fantasy/context';
import { ARTICLE_SYSTEM, splitArticle } from '../../fantasy/prompts';
import { formatDate } from '../../game/calendar';
import { useGame } from '../context';

type Tab = 'free' | 'story' | 'chat' | 'memory' | 'settings';

export function Fantasy() {
  const { session } = useGame();
  const f = session.fantasy;
  const [tab, setTab] = useState<Tab>(() => (loadAiSettings().key || loadAiSettings().provider === 'mock' ? (session.fantasy?.free ? 'free' : 'story') : 'settings'));
  if (!f) {
    return (
      <div className="stack">
        <h1>판타지 모드</h1>
        <p className="muted">이 게임은 판타지 모드가 아닙니다. 새 게임을 만들 때 "판타지 모드 (AI 이야기)"를 켜세요.</p>
        <AiSettings />
      </div>
    );
  }
  return (
    <div className="stack">
      <section className="row-between wrap">
        <div>
          <h1>{f.free ? '자유 모드' : '판타지'} <span className="muted small">{f.free ? 'AI 게임 마스터 진행' : 'AI 이야기'}{f.regressor ? ' · 회귀자' : ''}</span></h1>
          <p className="muted small">AI가 지금 게임 상황을 읽고 기사·대화·사건을 만듭니다. 실존 선수에게는 지어낸 말·사생활·물의를 붙이지 않습니다.</p>
        </div>
        <div className="seg" role="tablist" aria-label="판타지 화면">
          {f.free && <button type="button" role="tab" aria-selected={tab === 'free'} className={tab === 'free' ? 'on' : ''} onClick={() => setTab('free')}>행동</button>}
          <button type="button" role="tab" aria-selected={tab === 'story'} className={tab === 'story' ? 'on' : ''} onClick={() => setTab('story')}>이야기</button>
          <button type="button" role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>대화</button>
          {f.regressor && <button type="button" role="tab" aria-selected={tab === 'memory'} className={tab === 'memory' ? 'on' : ''} onClick={() => setTab('memory')}>기억 노트</button>}
          <button type="button" role="tab" aria-selected={tab === 'settings'} className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>AI 설정</button>
        </div>
      </section>
      {tab === 'free' ? <FantasyFree /> : tab === 'story' ? <Story /> : tab === 'chat' ? <FantasyChat /> : tab === 'memory' ? <FantasyMemory onWrote={() => setTab('story')} /> : <><AiSettings /><NaiSettingsPanel /></>}
    </div>
  );
}

function Story() {
  const { session, store, changed } = useGame();
  const f = session.fantasy!;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  // 자동으로 그릴 글 (방금 쓴 글). 다른 탭(기억 노트)에서 막 쓴 글도 이 화면에 오면 그린다
  const [autoArt, setAutoArt] = useState<FantasyEntry | null>(() => {
    const nai = loadNaiSettings();
    const lastEntry = f.log[f.log.length - 1];
    return nai.auto && nai.token.trim() && lastEntry && lastEntry.kind === 'memory' ? lastEntry : null;
  });
  const write = async () => {
    const s = loadAiSettings();
    setBusy(true);
    setMsg({ text: 'AI가 기사를 쓰는 중입니다…' });
    try {
      const ctx = gameContext(session);
      const text = await complete(s, {
        system: ARTICLE_SYSTEM,
        messages: [{ role: 'user', content: `[게임 상황]\n${ctx}\n\n이 상황으로 기사 한 편을 써 줘.` }],
        maxTokens: 900,
        mockReply: `${session.league.teams[session.teamIdx].name}, 이번 주도 순위 싸움 이어 가\n\n${session.league.teams[session.teamIdx].name}이 이번 주 일정을 마쳤다. (시험용 글)`,
      });
      const { title, body } = splitArticle(text);
      if (!body) throw new LlmError('AI 답이 비어 있습니다. 다시 시도하세요.');
      session.addFantasy({ kind: 'article', title, text: body, who: 'AI 기자' });
      setMsg({ text: '기사를 남겼습니다.' });
      // 삽화 자동 (NovelAI 토큰이 있고 자동이 켜져 있으면): 방금 남긴 글
      const nai = loadNaiSettings();
      if (nai.auto && nai.token.trim()) setAutoArt(f.log[f.log.length - 1]);
      changed();
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const event = async () => {
    setBusy(true);
    setMsg({ text: 'AI가 사건을 만드는 중입니다…' });
    try {
      const e = await makeEvent(session, store, loadAiSettings());
      session.addFantasy(e);
      setMsg({ text: '사건이 생겼습니다. 아래에서 고르세요.' });
      const nai = loadNaiSettings();
      if (nai.auto && nai.token.trim()) setAutoArt(f.log[f.log.length - 1]);
      changed();
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const entries = [...f.log].reverse();
  return (
    <section className="stack">
      <div className="panel">
        <div className="row-between wrap">
          <h2>이야기</h2>
          <span className="inline">
            <button type="button" onClick={() => void event()} disabled={busy}>{busy ? 'AI가 쓰는 중…' : '사건 만들기'}</button>
            <button type="button" className="ghost" onClick={() => void write()} disabled={busy}>기사 쓰기</button>
          </span>
        </div>
        {f.arc && <p className="small fantasy-arc">이야기 줄기 <strong>{f.arc.title}</strong>{f.arc.climax ? ' (절정)' : ''} · {f.arc.beats}번째 사건 · {f.arc.summary}</p>}
        {(f.pastArcs?.length ?? 0) > 0 && <p className="muted small">끝난 이야기: {f.pastArcs!.slice(-5).map((a) => a.title).join(' · ')}</p>}
        <p className="muted small">정규시즌에는 {AUTO_EVENT_EVERY}일쯤마다 AI가 사건을 저절로 만듭니다 (AI 키가 있을 때). 이야기가 몇 번 이어져 절정에 이르면 구단주 교체·큰 투자·전설적인 유망주 같은 큰 변화가 생길 수 있습니다.</p>
        {msg && <p className={msg.error ? 'note error-box' : 'muted small'} role="status">{msg.text}</p>}
        <p className="muted small">AI가 쓴 글은 저장 파일과 조작 기록에 남아, 불러오거나 재현해도 같은 이야기가 나옵니다 (AI를 다시 부르지 않습니다).</p>
      </div>
      {entries.length === 0 ? <p className="muted">아직 이야기가 없습니다.</p> : entries.map((e, i) => (
        <article key={i} className="panel">
          <p className="muted small">{e.day < 0 ? `${e.year} 오프시즌` : formatDate(e.year, e.day)}{e.who ? ` · ${e.who}` : ''}</p>
          <h3>{e.title}</h3>
          <ArtFrame entry={e} auto={autoArt === e} />
          {e.ask && <p className="small chat-me"><span className="muted">단장</span> {e.ask}</p>}
          {e.text.split('\n').filter(Boolean).map((line, k) => <p key={k}>{line}</p>)}
          <ChoiceButtons entry={e} />
        </article>
      ))}
    </section>
  );
}

function AiSettings() {
  const [s, setS] = useState<LlmSettings>(loadAiSettings);
  const [models, setModels] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const update = (next: LlmSettings) => { setS(next); if (!saveAiSettings(next)) setMsg({ text: '이 브라우저에 설정을 저장하지 못했습니다 (사생활 보호 모드 등).', error: true }); };
  const setProvider = (p: Provider) => { setModels([]); update({ ...s, provider: p, model: DEFAULT_MODEL[p] }); };
  const run = async (what: 'test' | 'models') => {
    setBusy(true);
    setMsg(null);
    try {
      if (what === 'models') {
        const list = await listModels(s);
        setModels(list);
        setMsg({ text: `모델 ${list.length}개를 불러왔습니다.` });
      } else {
        const t = await complete(s, { system: '짧게 답한다.', messages: [{ role: 'user', content: '연결 시험이다. "연결됨" 한 단어로만 답해.' }], maxTokens: 20, mockReply: '연결됨' });
        setMsg({ text: `연결됨: ${t.trim().slice(0, 40)}` });
      }
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel stack">
      <h2>AI 설정</h2>
      <p className="muted small">
        플레이어 본인의 API 키로 이 브라우저에서 바로 AI를 부릅니다. 키는 <strong>이 브라우저에만</strong> 저장되고 저장 파일·내보내기·버그 보고용 재현 정보에는 들어가지 않습니다.
        요금은 키 주인에게 나갑니다. 다른 사람과 같이 쓰는 컴퓨터라면 다 쓴 뒤 키를 지우세요.
      </p>
      <div className="form-row">
        <label>
          제공자
          <select value={s.provider} onChange={(e) => setProvider(e.target.value as Provider)}>
            {(Object.keys(PROVIDER_LABEL) as Provider[]).map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}
          </select>
        </label>
      </div>
      {s.provider === 'vertex' ? <VertexFields s={s} update={update} setMsg={setMsg} /> : s.provider !== 'mock' && (
        <div className="form-row">
          <label>
            API 키
            <input type="password" value={s.key} autoComplete="off" spellCheck={false} placeholder="키를 붙여 넣으세요" onChange={(e) => update({ ...s, key: e.target.value })} />
          </label>
        </div>
      )}
      <div className="form-row">
        <label>
          모델
          <input type="text" value={s.model} list="fantasy-models" spellCheck={false} onChange={(e) => update({ ...s, model: e.target.value })} />
          <datalist id="fantasy-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
        </label>
        <span className="muted small">기본값 {DEFAULT_MODEL[s.provider]}. 모델 이름은 자주 바뀌니 안 되면 "모델 목록 불러오기"로 고르세요.</span>
      </div>
      <div className="actions">
        <button type="button" onClick={() => void run('test')} disabled={busy}>연결 시험</button>
        <button type="button" className="ghost" onClick={() => void run('models')} disabled={busy || s.provider === 'mock'}>{s.provider === 'vertex' ? '모델 이름 예' : '모델 목록 불러오기'}</button>
        <button type="button" className="ghost danger" onClick={() => { forgetAiKey(); setS(loadAiSettings()); setMsg({ text: '키를 지웠습니다.' }); }}>키 지우기</button>
      </div>
      {msg && <p className={msg.error ? 'note error-box' : 'note'} role="status">{msg.text}</p>}
    </section>
  );
}

/** Vertex AI: 서비스 계정 JSON 파일과 지역 */
function VertexFields({ s, update, setMsg }: { s: LlmSettings; update: (s: LlmSettings) => void; setMsg: (m: { text: string; error?: boolean } | null) => void }) {
  let info: string | null = null;
  try { if (s.key) { const sa = parseServiceAccount(s.key); info = `프로젝트 ${sa.project_id} · ${sa.client_email}`; } } catch { info = null; }
  const load = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      parseServiceAccount(text);
      update({ ...s, key: text });
      setMsg({ text: '서비스 계정 JSON을 넣었습니다. "연결 시험"을 눌러 보세요.' });
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    }
  };
  return (
    <>
      <div className="form-row">
        <label>
          서비스 계정 JSON 파일
          <input type="file" accept=".json,application/json" onChange={(e) => void load(e.target.files?.[0])} />
        </label>
        <span className="muted small">{info ?? '아직 없습니다.'} Google Cloud 콘솔 → IAM → 서비스 계정 → 키 만들기(JSON). 권한은 "Vertex AI 사용자"만 주는 계정을 권합니다. 파일 안의 비밀 키가 이 브라우저에 저장됩니다.</span>
      </div>
      <div className="form-row">
        <label>
          지역
          <input type="text" value={s.region ?? 'global'} spellCheck={false} onChange={(e) => update({ ...s, region: e.target.value })} />
        </label>
        <span className="muted small">기본 global. Claude 모델은 us-east5·europe-west1 같은 지역이 필요할 수 있습니다. 모델 이름이 claude로 시작하면 Claude(Anthropic), 아니면 Gemini로 부릅니다.</span>
      </div>
    </>
  );
}

/** 이야기 글의 삽화 (이 브라우저에 저장된 것). 없으면 그리기 버튼, auto면 바로 그린다 */
function ArtFrame({ entry, auto }: { entry: FantasyEntry; auto: boolean }) {
  const { session } = useGame();
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'drawing' | 'error'>('idle');
  const [err, setErr] = useState('');
  const key = artKey(session.league, entry);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    void getArt(key).then((b) => { if (alive && b) { made = URL.createObjectURL(b); setUrl(made); } });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [key]);
  const t = session.league.teams[session.teamIdx];
  const pal = teamPalette(t.franchise, t.name);
  const draw = async () => {
    setState('drawing');
    try {
      const b = await illustrate(session, entry, { primary: pal.primary, second: pal.second });
      setUrl(URL.createObjectURL(b));
      setState('idle');
    } catch (e) {
      setErr((e as Error).message);
      setState('error');
    }
  };
  // 자동: 저장된 그림이 없을 때만 그린다 (불러오기가 끝나기 전에 다시 그려 Anlas를 쓰지 않게 저장소를 먼저 본다)
  useEffect(() => {
    if (!auto || state !== 'idle') return;
    void getArt(key).then((b) => { if (!b) void draw(); });
  }, [auto]); // eslint-disable-line react-hooks/exhaustive-deps
  const nai = loadNaiSettings();
  if (url) return (
    <figure className="fantasy-art">
      <img src={url} alt={`삽화: ${entry.title}`} loading="lazy" />
      <figcaption className="muted small">AI 삽화 (가상 인물·장면) <button type="button" className="link small" onClick={() => void draw()} disabled={state === 'drawing'}>{state === 'drawing' ? '그리는 중…' : '다시 그리기'}</button></figcaption>
    </figure>
  );
  if (!nai.token.trim()) return null;
  return (
    <p className="small">
      {state === 'drawing' ? <span className="muted">삽화를 그리는 중입니다…</span>
        : <button type="button" className="ghost small-btn" onClick={() => void draw()}>삽화 그리기</button>}
      {state === 'error' && <span className="note error-box"> {err}</span>}
    </p>
  );
}

/** 삽화 (NovelAI) 설정 */
function NaiSettingsPanel() {
  const [s, setS] = useState<NaiSettings>(loadNaiSettings);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [sample, setSample] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const update = (next: NaiSettings) => { setS(next); saveNaiSettings(next); };
  const test = async () => {
    setBusy(true);
    setMsg({ text: '시험 그림을 그리는 중입니다…' });
    try {
      const png = await generateImage(s, 'baseball stadium at night, stadium lights, empty field, anime illustration, original, no text, no logo', 12345, { width: 640, height: 640 });
      setSample(URL.createObjectURL(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' })));
      setMsg({ text: '연결됨: 시험 그림을 받았습니다.' });
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel stack">
      <h2>삽화 (NovelAI)</h2>
      <p className="muted small">
        AI 글마다 NovelAI로 삽화를 그립니다. <strong>가상 인물과 장면만</strong> 그리고, 유니폼은 구단 색만 빌립니다 (로고·엠블럼·글자 없음, 실존 선수는 그리지 않음).
        그림은 이 브라우저에만 저장되고 저장 파일·내보내기에는 들어가지 않습니다. Anlas(크레딧) 사용은 NovelAI 구독 조건을 따릅니다.
      </p>
      <div className="form-row">
        <label>
          영구 API 토큰
          <input type="password" value={s.token} autoComplete="off" spellCheck={false} placeholder="pst-…" onChange={(e) => update({ ...s, token: e.target.value })} />
        </label>
        <span className="muted small">NovelAI 사이트 → 사용자 설정 → 계정 → Get Persistent API Token.</span>
      </div>
      <div className="form-row">
        <label>
          모델
          <input type="text" value={s.model} list="nai-models" spellCheck={false} onChange={(e) => update({ ...s, model: e.target.value })} />
          <datalist id="nai-models">{NAI_MODEL_HINTS.map((m) => <option key={m} value={m} />)}</datalist>
        </label>
        <span className="muted small">기본 {NAI_DEFAULT_MODEL}.</span>
      </div>
      <label className="inline"><input type="checkbox" checked={s.auto} onChange={(e) => update({ ...s, auto: e.target.checked })} /> AI 글이 생길 때마다 자동으로 그리기</label>
      <div className="actions">
        <button type="button" onClick={() => void test()} disabled={busy || !s.token.trim()}>시험 그림 (640×640)</button>
        <button type="button" className="ghost danger" onClick={() => update({ ...s, token: '' })}>토큰 지우기</button>
      </div>
      {msg && <p className={msg.error ? 'note error-box' : 'note'} role="status">{msg.text}</p>}
      {sample && <img className="fantasy-art-sample" src={sample} alt="NovelAI 시험 그림" />}
    </section>
  );
}

