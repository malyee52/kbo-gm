// 판타지 모드 화면 (docs/fantasy-mode.md): 이야기(AI 기사·대화·사건 기록)와 AI 설정.
import { useState } from 'react';
import { complete, DEFAULT_MODEL, listModels, LlmError, PROVIDER_LABEL, type LlmSettings, type Provider } from '../../fantasy/llm';
import { forgetAiKey, loadAiSettings, saveAiSettings } from '../../fantasy/settings';
import { gameContext } from '../../fantasy/context';
import { ARTICLE_SYSTEM, splitArticle } from '../../fantasy/prompts';
import { formatDate } from '../../game/calendar';
import { useGame } from '../context';

type Tab = 'story' | 'settings';

export function Fantasy() {
  const { session } = useGame();
  const f = session.fantasy;
  const [tab, setTab] = useState<Tab>(() => (loadAiSettings().key || loadAiSettings().provider === 'mock' ? 'story' : 'settings'));
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
          <h1>판타지 <span className="muted small">AI 이야기{f.regressor ? ' · 회귀자' : ''}</span></h1>
          <p className="muted small">AI가 지금 게임 상황을 읽고 기사·대화·사건을 만듭니다. 실존 선수에게는 지어낸 말·사생활·물의를 붙이지 않습니다.</p>
        </div>
        <div className="seg" role="tablist" aria-label="판타지 화면">
          <button type="button" role="tab" aria-selected={tab === 'story'} className={tab === 'story' ? 'on' : ''} onClick={() => setTab('story')}>이야기</button>
          <button type="button" role="tab" aria-selected={tab === 'settings'} className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>AI 설정</button>
        </div>
      </section>
      {tab === 'story' ? <Story /> : <AiSettings />}
    </div>
  );
}

function Story() {
  const { session, changed } = useGame();
  const f = session.fantasy!;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
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
          <button type="button" onClick={() => void write()} disabled={busy}>{busy ? '쓰는 중…' : '지금 상황으로 기사 쓰기'}</button>
        </div>
        {msg && <p className={msg.error ? 'note error-box' : 'muted small'} role="status">{msg.text}</p>}
        <p className="muted small">AI가 쓴 글은 저장 파일과 조작 기록에 남아, 불러오거나 재현해도 같은 이야기가 나옵니다 (AI를 다시 부르지 않습니다).</p>
      </div>
      {entries.length === 0 ? <p className="muted">아직 이야기가 없습니다.</p> : entries.map((e, i) => (
        <article key={i} className="panel">
          <p className="muted small">{e.day < 0 ? `${e.year} 오프시즌` : formatDate(e.year, e.day)}{e.who ? ` · ${e.who}` : ''}</p>
          <h3>{e.title}</h3>
          {e.text.split('\n').filter(Boolean).map((line, k) => <p key={k}>{line}</p>)}
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
      {s.provider !== 'mock' && (
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
        <button type="button" className="ghost" onClick={() => void run('models')} disabled={busy || s.provider === 'mock'}>모델 목록 불러오기</button>
        <button type="button" className="ghost danger" onClick={() => { forgetAiKey(); setS(loadAiSettings()); setMsg({ text: '키를 지웠습니다.' }); }}>키 지우기</button>
      </div>
      {msg && <p className={msg.error ? 'note error-box' : 'note'} role="status">{msg.text}</p>}
    </section>
  );
}
