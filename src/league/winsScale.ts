// 엔진 단위(경기력 %p·런)를 화면에서 승수로 (2026-11-25 사용자 Q65: "약 +0.8승"처럼).
// 눈금: reports/nominal-content.md 0절 (2026 월드 300시즌, 구단마다 경기력 edge를 무작위로 걸고 득실 기대 승수를 회귀):
// 구단 전체 edge +0.01을 시즌 내내 = 2.87승 (타자 쪽 1.51·투수 쪽 1.36), 득실 1승 = 11.0점.
// 표시만 한다. 엔진·저장·AI 판단은 이 값을 쓰지 않는다.

/** 득실 1승 = 11점 (위 측정, 근사) */
export const RUNS_PER_WIN_SHOWN = 11;
/** edge 1.0을 시즌 내내 걸었을 때 승수 (위 측정 ÷ 0.01) */
const WINS_PER_EDGE = { all: 287, bat: 151, pit: 136 } as const;
/** 선수 하나 = 타자 쪽의 1/9 몫 (근사, nominal-content.md 1절과 같은 가정) */
const PLAYER_SHARE = 1 / 9;
/** 하루에 치르는 경기 수 (임시값: 144경기 ÷ 개막부터 약 180일) */
const GAMES_PER_DAY = 0.8;
const SEASON_GAMES = 144;

export type FormSide = 'all' | 'bat' | 'pit' | 'player';

/** 경기력 edge를 days일 동안 걸었을 때 기대 승수 (근사) */
export function formWins(edge: number, days: number, side: FormSide = 'all'): number {
  const per = side === 'player' ? WINS_PER_EDGE.bat * PLAYER_SHARE : WINS_PER_EDGE[side];
  return edge * per * Math.min(1, (days * GAMES_PER_DAY) / SEASON_GAMES);
}

/** "약 +0.3승" (0.1승 아래는 소수 둘째 자리) */
export function winsText(w: number): string {
  const a = Math.abs(w);
  const sign = w > 0 ? '+' : w < 0 ? '−' : '±';
  return `약 ${sign}${a >= 0.1 || a === 0 ? a.toFixed(1) : a.toFixed(2)}승`;
}

/** 트레이드 평가 같은 런 값을 승수 글로 */
export const runsWinsText = (runs: number) => winsText(runs / RUNS_PER_WIN_SHOWN);

const WHO_SIDE: Record<string, FormSide> = {
  '팀': 'all', '선수단': 'all', '타자': 'bat', '타자진': 'bat', '투수': 'pit', '투수진': 'pit', '그 선수': 'player', '외국인 선수': 'player',
};
const NUM = String.raw`[+−-]\d+(?:\.\d+)?(?![\d.]*%)`;
const FORM_RE = new RegExp(String.raw`(\d+)일 동안 (?:((?:그 선수|외국인 선수|선수단|타자진|투수진|타자|투수|팀) )?경기력 )?(${NUM})(\s*/\s*(${NUM}))?`, 'g');
const num = (s: string) => Number(s.replace('−', '-')) / 100;

/**
 * 이벤트 선택지 글의 "7일 동안 팀 경기력 +3.0" (단위: 타석당 %p)을 "7일 동안 팀 경기력 약 +0.3승"으로.
 * 경기력 말이 없는 "그 뒤 10일 동안 +3.0"은 앞에 나온 쪽(팀·타자·투수·선수)을 따른다. 관중률 %p 같은 다른 값은 그대로 둔다
 */
export function withWins(text: string): string {
  let side: FormSide = 'all';
  return text.replace(FORM_RE, (_m, days: string, whoRaw: string | undefined, a: string, _rest: string | undefined, b: string | undefined) => {
    const who = whoRaw?.trim();
    if (who) side = WHO_SIDE[who] ?? 'all';
    const d = Number(days);
    const head = `${days}일 동안 ${who ? `${who} ` : ''}${who || _m.includes('경기력') ? '경기력 ' : ''}`;
    return head + winsText(formWins(num(a), d, side)) + (b ? ` / ${winsText(formWins(num(b), d, side))}` : '');
  });
}
