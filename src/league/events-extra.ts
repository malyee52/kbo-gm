// 무작위 이벤트 확장 (2026-10-12 사용자: "이벤트 100종 이상 추가해, 처음 이야기했던 것과 달리 부정적인 이벤트도 넣어").
// 종류: 컨디션 · 부상·건강 · 재정 · 팬·관중 · 언론·평판 · 프런트 운영 · 육성 · 리그·날씨.
// 실존 선수에게 붙는 일은 시뮬레이션 안에서 생기는 일(부상·피로·경기력)과 중립적인 제안까지만 쓴다.
// 사람의 잘못·사생활로 읽힐 수 있는 일은 실명 없이(선수단·관계자) 쓴다. 효과 크기는 모두 임시값.

import type { Rng } from '../engine';
import type { EventChoice, EventContext, EventDef, EventPlayer, PendingEvent } from './events';

type V = PendingEvent['vars'];
const eok = (man: number) => `${(man / 10000).toFixed(1)}억 원`;
const num = (v: V, k: string) => Number(v[k]);
const str = (v: V, k: string) => String(v[k]);
/** 경기력 표기 (타석당 %p) */
const ed = (x: number) => `${x > 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}`;
const fp = (x: number) => `${x > 0 ? '+' : '−'}${Math.abs(Math.round(x * 100))}%p`;

function ch(label: string, note: string | ((c: EventContext, v: V) => string), apply: (c: EventContext, v: V, rng: Rng) => string): EventChoice {
  return { label, note: typeof note === 'string' ? () => note : note, apply };
}
const none = (label = '그냥 둔다', result = '별다른 조치는 하지 않았습니다.') => ch(label, '변화 없음', () => result);

// ---- 선수 고르기
const hitters = (c: EventContext) => c.players.filter((p) => !p.isPitcher && p.pa >= 40);
const starters = (c: EventContext) => c.players.filter((p) => p.isPitcher && p.starter && p.outs >= 30);
const relievers = (c: EventContext) => c.players.filter((p) => p.isPitcher && !p.starter && p.outs >= 15);
const veterans = (c: EventContext) => c.players.filter((p) => (p.age ?? 0) >= 32 && (p.pa >= 40 || p.outs >= 30));
const foreigners = (c: EventContext) => c.players.filter((p) => p.foreign);
const regulars = (c: EventContext) => c.players.filter((p) => p.pa >= 40 || p.outs >= 30);
const pick = <T>(xs: T[], rng: Rng): T => xs[rng.int(xs.length)];
const who = (p: EventPlayer) => ({ id: p.id, name: p.name });
const prospects = (c: EventContext) => c.roster
  .filter((p) => !p.foreign && p.birthYear !== null && c.year - p.birthYear <= 24 && p.military?.state !== 'serving')
  .sort((a, b) => b.potential - a.potential || a.id.localeCompare(b.id));
const losing = (c: EventContext) => c.rank >= c.teams - 2 || c.streak <= -4;

// ---- 공통 효과
const cash = (c: EventContext, man: number, note: string) => c.addCash(man, note);
const won = (_c: EventContext, v: V, k: string) => eok(num(v, k));

/** 비용을 쓰고 효과를 얻는 선택 */
const pay = (label: string, k: string, extra: string, fx: (c: EventContext, v: V, rng: Rng) => string, note: string) =>
  ch(label, (_c, v) => `자금 −${eok(num(v, k))}${extra ? `, ${extra}` : ''}`, (c, v, rng) => { cash(c, -num(v, k), note); return fx(c, v, rng); });

const amt = (lo: number, hi: number) => (_c: EventContext, rng: Rng): V => ({ cost: Math.round(rng.range(lo, hi) / 1000) * 1000 });

export const EXTRA_EVENTS: EventDef[] = [
  // ======== 컨디션·경기력 (15)
  { id: 'x-team-flu', title: '선수단 감기 확산', weight: 5,
    text: () => '환절기 감기가 선수단에 번지고 있습니다. 몇몇 주전은 목소리가 잠겼습니다.',
    choices: [
      ch('그대로 경기한다', `7일 동안 팀 경기력 ${ed(-0.02)}`, (c) => { c.addForm(-0.02, 7, '감기 확산'); return '선수단이 감기를 안고 뛰고 있습니다.'; }),
      ch('증상 있는 선수는 쉬게 한다', `3일 동안 팀 경기력 ${ed(-0.01)}, 그 뒤 회복`, (c) => { c.addForm(-0.01, 3, '감기 관리'); return '아픈 선수들을 먼저 쉬게 했습니다.'; }),
    ] },
  { id: 'x-food-poison', title: '원정 숙소 단체 배탈', weight: 3,
    vars: amt(5000, 12000),
    text: () => '원정 숙소에서 먹은 음식 탓에 선수단 여럿이 배탈이 났습니다.',
    choices: [
      ch('참고 뛴다', `5일 동안 팀 경기력 ${ed(-0.025)}`, (c) => { c.addForm(-0.025, 5, '단체 배탈'); return '선수들이 힘겹게 경기를 치르고 있습니다.'; }),
      pay('식단 업체를 바꾸고 회복을 지원한다', 'cost', `5일 동안 팀 경기력 ${ed(-0.01)}`, (c) => { c.addForm(-0.01, 5, '배탈 회복'); return '회복 식단을 붙였습니다.'; }, '배탈 회복 지원'),
    ] },
  { id: 'x-travel-delay', title: '원정 이동 지연', weight: 5,
    vars: amt(10000, 25000),
    text: () => '구단 버스가 고속도로에서 멈춰 섰습니다. 선수단은 새벽에야 숙소에 도착할 것 같습니다.',
    choices: [
      ch('그대로 버틴다', `2일 동안 팀 경기력 ${ed(-0.02)}`, (c) => { c.addForm(-0.02, 2, '이동 지연'); return '선수단이 피곤한 몸으로 경기에 나섭니다.'; }),
      pay('대체 차량과 숙소 연장을 잡는다', 'cost', '영향 없음', () => '선수단이 제때 쉬었습니다.', '원정 이동 대체 차량'),
    ] },
  { id: 'x-heatwave', title: '폭염 경보', weight: 5, when: (c) => c.month === 7 || c.month === 8,
    vars: amt(3000, 8000),
    text: () => '연일 폭염 경보입니다. 낮 훈련 뒤 지쳐 보이는 선수가 늘었습니다.',
    choices: [
      ch('평소대로 훈련한다', `7일 동안 팀 경기력 ${ed(-0.015)}`, (c) => { c.addForm(-0.015, 7, '폭염'); return '더위 속에 훈련을 이어 갑니다.'; }),
      pay('야간 훈련으로 바꾼다', 'cost', '영향 없음', () => '훈련 시간을 저녁으로 옮겼습니다.', '폭염 대비 야간 훈련'),
    ] },
  { id: 'x-rainy-season', title: '장마철 연속 우천', weight: 5, when: (c) => c.month === 6 || c.month === 7,
    vars: amt(5000, 12000),
    text: () => '장마로 경기가 연달아 취소되거나 미뤄지면서 타자들의 감각이 무뎌졌다는 말이 나옵니다.',
    choices: [
      ch('평소대로 간다', `5일 동안 타자 경기력 ${ed(-0.01)}`, (c) => { c.addForm(-0.01, 5, '장마 공백', { side: 'bat' }); return '경기 감각을 되찾는 데 시간이 걸립니다.'; }),
      pay('실내 훈련장을 빌린다', 'cost', `5일 동안 타자 경기력 ${ed(0.005)}`, (c) => { c.addForm(0.005, 5, '실내 훈련', { side: 'bat' }); return '실내 훈련장에서 타격감을 유지했습니다.'; }, '실내 훈련장 대관'),
    ] },
  { id: 'x-fine-dust', title: '미세먼지 경보', weight: 4, when: (c) => c.month >= 3 && c.month <= 5,
    vars: amt(2000, 4000),
    text: () => '미세먼지 경보가 며칠째 이어집니다. 야외 훈련을 강행할지 고민입니다.',
    choices: [
      ch('강행한다', `3일 동안 팀 경기력 ${ed(-0.01)}`, (c) => { c.addForm(-0.01, 3, '미세먼지'); return '마스크를 쓰고 훈련했습니다.'; }),
      pay('실내 훈련으로 돌린다', 'cost', '영향 없음', () => '실내에서 훈련했습니다.', '미세먼지 실내 훈련'),
    ] },
  { id: 'x-clubhouse-good', title: '클럽하우스 분위기 최고', weight: 5,
    vars: amt(3000, 6000),
    text: () => '고참과 젊은 선수들이 잘 어울린다는 이야기가 들립니다. 더그아웃이 밝습니다.',
    choices: [
      ch('지켜본다', `7일 동안 팀 경기력 ${ed(0.01)}`, (c) => { c.addForm(0.01, 7, '좋은 분위기'); return '좋은 분위기가 이어집니다.'; }),
      pay('선수단 회식을 지원한다', 'cost', `10일 동안 팀 경기력 ${ed(0.015)}`, (c) => { c.addForm(0.015, 10, '선수단 회식'); return '선수단이 함께 식사하며 결속을 다졌습니다.'; }, '선수단 회식'),
    ] },
  { id: 'x-clubhouse-tension', title: '더그아웃 신경전', weight: 4,
    text: () => '선수단과 코치진 사이에 운영 방식을 두고 의견 차가 있다는 말이 흘러나옵니다.',
    choices: [
      ch('감독에게 맡긴다', `반반: 7일 동안 팀 경기력 ${ed(-0.02)} / 변화 없음`, (c, _v, rng) => { if (rng.chance(0.5)) { c.addForm(-0.02, 7, '더그아웃 신경전'); return '어색한 분위기가 경기에 묻어납니다.'; } return '감독이 조용히 정리했습니다.'; }),
      ch('단장이 직접 중재한다', `구단주 신뢰도 −1, 3일 동안 팀 경기력 ${ed(-0.005)}`, (c) => { c.addTrust(-1); c.addForm(-0.005, 3, '중재'); return '양쪽 이야기를 듣고 정리했습니다.'; }),
    ] },
  { id: 'x-video-analysis', title: '새 전력분석 프로그램 제안', weight: 4,
    vars: amt(20000, 40000),
    text: () => '업체가 투구·타구 데이터를 실시간으로 보여 주는 분석 프로그램을 제안했습니다.',
    choices: [
      none('보류한다'),
      pay('도입한다', 'cost', `21일 동안 타자 경기력 ${ed(0.01)}`, (c) => { c.addForm(0.01, 21, '전력분석 도입', { side: 'bat' }); return '분석팀이 새 프로그램을 쓰기 시작했습니다.'; }, '전력분석 프로그램'),
    ] },
  { id: 'x-pitch-tipping', title: '투구 습관 노출 의혹', weight: 4,
    text: () => '상대 팀이 우리 투수들의 투구 습관을 읽고 있다는 분석이 나왔습니다.',
    choices: [
      ch('신경 쓰지 않는다', `10일 동안 투수 경기력 ${ed(-0.015)}`, (c) => { c.addForm(-0.015, 10, '습관 노출', { side: 'pit' }); return '상대 타자들이 잘 대응하고 있습니다.'; }),
      ch('교정 훈련을 한다', `3일 동안 투수 경기력 ${ed(-0.01)}, 그 뒤 10일 동안 ${ed(0.005)}`, (c) => { c.addForm(-0.01, 3, '투구 교정', { side: 'pit' }); c.addForm(0.005, 10, '교정 효과', { side: 'pit', delay: 3 }); return '투수들이 세트 포지션을 다듬었습니다.'; }),
    ] },
  { id: 'x-sign-stealing', title: '사인 노출 의혹', weight: 3,
    text: () => '우리 배터리 사인이 읽히는 것 같다는 내부 분석이 올라왔습니다.',
    choices: [
      ch('사인 체계를 바꾼다', `3일 동안 팀 경기력 ${ed(-0.01)} (혼선)`, (c) => { c.addForm(-0.01, 3, '사인 교체'); return '새 사인에 적응하는 중입니다.'; }),
      ch('그대로 간다', `반반: 10일 동안 투수 경기력 ${ed(-0.02)} / 변화 없음`, (c, _v, rng) => { if (rng.chance(0.5)) { c.addForm(-0.02, 10, '사인 노출', { side: 'pit' }); return '상대가 우리 볼 배합을 읽는 듯합니다.'; } return '기우였던 것 같습니다.'; }),
    ] },
  { id: 'x-lucky-charm', title: '팬이 보낸 행운의 부적', weight: 3,
    text: () => '한 팬이 선수단에 직접 만든 부적을 보내왔습니다.',
    choices: [
      ch('더그아웃에 건다', `7일 동안 팀 경기력 ${ed(0.005)}, 팬 만족도 +1`, (c) => { c.addForm(0.005, 7, '행운의 부적'); c.addFans(1, '팬 선물'); return '더그아웃 한쪽에 부적을 걸었습니다.'; }),
      none('정중히 보관한다', '감사 인사를 전하고 보관했습니다.'),
    ] },
  { id: 'x-night-games', title: '야간 경기 연속 피로', weight: 4,
    vars: amt(3000, 6000),
    text: () => '야간 경기와 장거리 이동이 겹치며 선수들의 수면 시간이 줄었습니다.',
    choices: [
      ch('그대로 간다', `7일 동안 팀 경기력 ${ed(-0.01)}`, (c) => { c.addForm(-0.01, 7, '수면 부족'); return '피로가 쌓이고 있습니다.'; }),
      pay('수면·회복 관리를 붙인다', 'cost', `7일 동안 팀 경기력 ${ed(0.005)}`, (c) => { c.addForm(0.005, 7, '회복 관리'); return '수면 관리를 시작했습니다.'; }, '수면 관리'),
    ] },
  { id: 'x-day-off', title: '휴식일 훈련 여부', weight: 4,
    text: () => '모처럼 휴식일입니다. 코치진은 특타를, 선수단은 휴식을 원합니다.',
    choices: [
      ch('푹 쉬게 한다', `구원 투수 피로 회복, 2일 동안 타자 경기력 ${ed(-0.005)}`, (c) => { c.restPitchers(); c.addForm(-0.005, 2, '휴식 뒤 감각', { side: 'bat' }); return '선수단이 하루를 푹 쉬었습니다.'; }),
      ch('특타를 한다', `5일 동안 타자 경기력 ${ed(0.01)}, 투수 피로는 그대로`, (c) => { c.addForm(0.01, 5, '휴식일 특타', { side: 'bat' }); return '타자들이 휴식일에도 방망이를 돌렸습니다.'; }),
    ] },
  { id: 'x-new-uniform', title: '새 유니폼 공개', weight: 3,
    vars: amt(8000, 15000),
    text: () => '새 시즌 스페셜 유니폼 디자인이 나왔습니다. 공개 행사를 열지 결정해야 합니다.',
    choices: [
      none('조용히 바꾼다', '유니폼만 바꿨습니다.'),
      pay('공개 행사를 연다', 'cost', `20일 동안 관중률 ${fp(0.04)}, 굿즈 수입 +2.0억 원`, (c) => { c.addFill(0.04, 20, '새 유니폼'); cash(c, 20000, '스페셜 유니폼 판매'); return '새 유니폼이 화제가 됐습니다.'; }, '유니폼 공개 행사'),
    ] },

  // ======== 부상·건강 (12)
  { id: 'x-practice-injury', title: '훈련 중 발목 부상', weight: 5, when: (c) => hitters(c).length > 3,
    vars: (c, rng) => who(pick(hitters(c), rng)),
    text: (_c, v) => `${str(v, 'name')} 선수가 수비 훈련 중 발목을 접질렸습니다. 큰 부상은 아니라는 소견입니다.`,
    choices: [
      ch('쉬게 한다', '7일 결장', (c, v) => { c.rest(str(v, 'id'), 7); return `${str(v, 'name')} 선수가 일주일 쉽니다.`; }),
      ch('테이핑하고 뛴다', `14일 동안 그 선수 경기력 ${ed(-0.04)}, 반반으로 그 뒤 10일 결장`, (c, v, rng) => { c.addForm(-0.04, 14, '발목 통증', { player: str(v, 'id') }); if (rng.chance(0.5)) c.rest(str(v, 'id'), 10); return `${str(v, 'name')} 선수가 통증을 참고 뜁니다.`; }),
    ] },
  { id: 'x-hamstring', title: '햄스트링 뭉침', weight: 4, when: (c) => hitters(c).length > 3,
    vars: (c, rng) => who(pick(hitters(c), rng)),
    text: (_c, v) => `${str(v, 'name')} 선수가 주루 중 허벅지 뒤쪽이 뭉친다고 합니다.`,
    choices: [
      ch('3일 쉬게 한다', '3일 결장', (c, v) => { c.rest(str(v, 'id'), 3); return '무리하지 않기로 했습니다.'; }),
      ch('그대로 내보낸다', '반반: 10일 결장 / 변화 없음', (c, v, rng) => { if (rng.chance(0.5)) { c.rest(str(v, 'id'), 10); return `${str(v, 'name')} 선수의 상태가 나빠져 열흘 빠집니다.`; } return '다행히 큰 문제 없이 넘어갔습니다.'; }),
    ] },
  { id: 'x-blister', title: '선발 투수 손가락 물집', weight: 4, when: (c) => starters(c).length > 0,
    vars: (c, rng) => who(pick(starters(c), rng)),
    text: (_c, v) => `${str(v, 'name')} 선수의 손가락에 물집이 잡혔습니다.`,
    choices: [
      ch('한 번 거른다', '6일 결장', (c, v) => { c.rest(str(v, 'id'), 6); return '등판을 한 번 건너뜁니다.'; }),
      ch('그대로 던진다', `10일 동안 그 선수 경기력 ${ed(-0.04)}`, (c, v) => { c.addForm(-0.04, 10, '물집', { player: str(v, 'id') }); return '공을 채기가 불편해 보입니다.'; }),
    ] },
  { id: 'x-back-pain', title: '베테랑 허리 통증', weight: 4, when: (c) => veterans(c).length > 0,
    vars: (c, rng) => who(pick(veterans(c), rng)),
    text: (_c, v) => `${str(v, 'name')} 선수가 허리 통증을 호소했습니다.`,
    choices: [
      ch('5일 쉬게 한다', '5일 결장', (c, v) => { c.rest(str(v, 'id'), 5); return '닷새 동안 관리합니다.'; }),
      ch('관리하며 출전시킨다', `14일 동안 그 선수 경기력 ${ed(-0.03)}`, (c, v) => { c.addForm(-0.03, 14, '허리 통증', { player: str(v, 'id') }); return '컨디션을 보며 내보냅니다.'; }),
    ] },
  { id: 'x-hbp-bruise', title: '몸에 맞는 공 후유증', weight: 4, when: (c) => hitters(c).length > 3,
    vars: (c, rng) => who(pick(hitters(c), rng)),
    text: (_c, v) => `어제 몸에 맞는 공을 맞은 ${str(v, 'name')} 선수의 부기가 빠지지 않았습니다.`,
    choices: [
      ch('이틀 쉬게 한다', '2일 결장', (c, v) => { c.rest(str(v, 'id'), 2); return '이틀 쉬기로 했습니다.'; }),
      ch('그대로 뛴다', `5일 동안 그 선수 경기력 ${ed(-0.03)}`, (c, v) => { c.addForm(-0.03, 5, '타박상', { player: str(v, 'id') }); return '통증을 참고 출전합니다.'; }),
    ] },
  { id: 'x-dead-arm', title: '구원 투수 팔 무거움', weight: 4, when: (c) => relievers(c).length > 0,
    vars: (c, rng) => who(pick(relievers(c), rng)),
    text: (_c, v) => `${str(v, 'name')} 선수가 팔이 무겁다고 말합니다. 최근 등판이 잦았습니다.`,
    choices: [
      ch('5일 쉬게 한다', '5일 결장', (c, v) => { c.rest(str(v, 'id'), 5); return '불펜에서 잠시 뺐습니다.'; }),
      ch('계속 쓴다', `7일 동안 그 선수 경기력 ${ed(-0.05)}`, (c, v) => { c.addForm(-0.05, 7, '팔 피로', { player: str(v, 'id') }); return '구위가 떨어진 채 던지고 있습니다.'; }),
    ] },
  { id: 'x-collision', title: '외야 수비 충돌', weight: 3, when: (c) => hitters(c).length > 3,
    vars: (c, rng) => who(pick(hitters(c), rng)),
    text: (_c, v) => `${str(v, 'name')} 선수가 뜬공을 쫓다 동료와 부딪혔습니다.`,
    choices: [
      ch('검사를 위해 쉬게 한다', '4일 결장', (c, v) => { c.rest(str(v, 'id'), 4); return '정밀 검사 결과 큰 이상은 없었습니다.'; }),
      ch('바로 복귀시킨다', `반반: 12일 결장 / 3일 동안 그 선수 경기력 ${ed(-0.02)}`, (c, v, rng) => { if (rng.chance(0.5)) { c.rest(str(v, 'id'), 12); return '뒤늦게 통증이 커져 빠지게 됐습니다.'; } c.addForm(-0.02, 3, '충돌 여파', { player: str(v, 'id') }); return '조금 불편하지만 뛰고 있습니다.'; }),
    ] },
  { id: 'x-toothache', title: '갑작스러운 치통', weight: 2, when: (c) => regulars(c).length > 0,
    vars: (c, rng) => who(pick(regulars(c), rng)),
    text: (_c, v) => `${str(v, 'name')} 선수가 치통으로 밤잠을 설쳤습니다.`,
    choices: [
      ch('치과에 보내고 하루 쉬게 한다', '1일 결장', (c, v) => { c.rest(str(v, 'id'), 1); return '치료를 받고 돌아왔습니다.'; }),
      ch('참고 뛴다', `3일 동안 그 선수 경기력 ${ed(-0.02)}`, (c, v) => { c.addForm(-0.02, 3, '치통', { player: str(v, 'id') }); return '집중하기 힘들어 보입니다.'; }),
    ] },
  { id: 'x-allergy', title: '꽃가루 알레르기', weight: 3, when: (c) => (c.month === 4 || c.month === 5) && regulars(c).length > 0,
    vars: (c, rng) => ({ ...who(pick(regulars(c), rng)), cost: 1000 }),
    text: (_c, v) => `${str(v, 'name')} 선수가 꽃가루 알레르기로 눈이 붓고 콧물이 멈추지 않습니다.`,
    choices: [
      pay('전문의 처방을 받게 한다', 'cost', `3일 동안 그 선수 경기력 ${ed(-0.01)}`, (c, v) => { c.addForm(-0.01, 3, '알레르기', { player: str(v, 'id') }); return '약을 먹고 나아지고 있습니다.'; }, '알레르기 치료'),
      ch('그대로 둔다', `7일 동안 그 선수 경기력 ${ed(-0.02)}`, (c, v) => { c.addForm(-0.02, 7, '알레르기', { player: str(v, 'id') }); return '봄이 지나가기만 기다립니다.'; }),
    ] },
  { id: 'x-medical-check', title: '의무팀의 정밀 검진 권고', weight: 3, when: (c) => starters(c).length > 0,
    vars: (c, rng) => who(pick(starters(c), rng)),
    text: (_c, v) => `의무팀이 ${str(v, 'name')} 선수의 팔꿈치 상태를 한 번 정밀하게 보자고 권합니다.`,
    choices: [
      ch('검진을 위해 한 번 뺀다', '2일 결장', (c, v) => { c.rest(str(v, 'id'), 2); return '검진 결과 이상 없음. 안심하고 던집니다.'; }),
      ch('그냥 던지게 한다', '반반: 15일 결장 / 변화 없음', (c, v, rng) => { if (rng.chance(0.5)) { c.rest(str(v, 'id'), 15); return '결국 통증이 생겨 보름 빠집니다.'; } return '별일 없이 지나갔습니다.'; }),
    ] },
  { id: 'x-trainer-quit', title: '수석 트레이너 이직', weight: 3,
    vars: amt(15000, 25000),
    text: () => '수석 트레이너가 다른 구단의 제안을 받고 떠나겠다고 합니다.',
    choices: [
      ch('내부에서 승격시킨다', `30일 동안 팀 경기력 ${ed(-0.005)}`, (c) => { c.addForm(-0.005, 30, '트레이너 교체'); return '내부 인원으로 빈자리를 메웠습니다.'; }),
      pay('경력자를 새로 영입한다', 'cost', '영향 없음', () => '경험 많은 트레이너를 데려왔습니다.', '트레이너 영입'),
    ] },
  { id: 'x-recovery-gear', title: '회복 장비 도입 제안', weight: 4,
    vars: amt(20000, 35000),
    text: () => '의무팀이 냉각·압박 회복 장비를 들여오자고 합니다.',
    choices: [
      none('보류한다'),
      pay('도입한다', 'cost', `구원 투수 피로 회복, 14일 동안 투수 경기력 ${ed(0.005)}`, (c) => { c.restPitchers(); c.addForm(0.005, 14, '회복 장비', { side: 'pit' }); return '투수들이 새 장비로 회복하고 있습니다.'; }, '회복 장비'),
    ] },

  // ======== 재정 (16)
  { id: 'x-sponsor-leave', title: '스폰서 계약 축소', weight: 4,
    vars: (_c, rng) => ({ amount: Math.round(rng.range(20000, 50000) / 1000) * 1000 }),
    text: (_c, v) => `스폰서 한 곳이 경영 사정을 이유로 남은 계약 ${won(_c, v, 'amount')}을 줄이겠다고 통보했습니다.`,
    choices: [
      ch('받아들인다', (_c, v) => `자금 −${won(_c, v, 'amount')}`, (c, v) => { cash(c, -num(v, 'amount'), '스폰서 계약 축소'); return '계약 축소를 받아들였습니다.'; }),
      ch('재협상한다', (_c, v) => `반반: 자금 −${eok(num(v, 'amount') / 2)} / −${eok(num(v, 'amount') * 1.5)}·신뢰도 −1`, (c, v, rng) => { if (rng.chance(0.5)) { cash(c, -num(v, 'amount') / 2, '스폰서 재협상'); return '절반만 줄이는 선에서 합의했습니다.'; } cash(c, -num(v, 'amount') * 1.5, '스폰서 계약 해지'); c.addTrust(-1); return '협상이 틀어져 계약이 아예 끝났습니다.'; }),
    ] },
  { id: 'x-ticket-system', title: '예매 시스템 장애', weight: 4,
    vars: amt(10000, 20000),
    text: () => '주말 경기 예매 시스템이 멈춰 팬들의 항의가 쏟아졌습니다.',
    choices: [
      pay('전액 보상한다', 'cost', '팬 만족도 +1', (c) => { c.addFans(1, '예매 장애 보상'); return '불편을 겪은 팬들에게 보상했습니다.'; }, '예매 장애 보상'),
      ch('최소한만 보상한다', `팬 만족도 −3, 10일 동안 관중률 ${fp(-0.03)}`, (c) => { c.addFans(-3, '예매 장애'); c.addFill(-0.03, 10, '예매 장애'); return '팬들의 불만이 남았습니다.'; }),
    ] },
  { id: 'x-electric-bill', title: '구장 전기료 인상', weight: 3,
    vars: amt(8000, 15000),
    text: () => '조명과 전광판 전기료가 크게 올랐습니다.',
    choices: [
      pay('감수한다', 'cost', '', () => '늘어난 전기료를 냈습니다.', '전기료 인상분'),
      ch('조명 운영 시간을 줄인다', `10일 동안 관중률 ${fp(-0.02)}`, (c) => { c.addFill(-0.02, 10, '조명 축소'); return '경기 전 행사를 줄였습니다.'; }),
    ] },
  { id: 'x-tax-audit', title: '세무 조사 추징', weight: 2,
    vars: (_c, rng) => ({ amount: Math.round(rng.range(10000, 30000) / 1000) * 1000 }),
    text: (_c, v) => `세무 조사 결과 구단 회계 처리가 문제가 돼 ${won(_c, v, 'amount')} 추징이 나왔습니다.`,
    choices: [
      ch('납부한다', (_c, v) => `자금 −${won(_c, v, 'amount')}`, (c, v) => { cash(c, -num(v, 'amount'), '세무 추징'); return '추징금을 냈습니다.'; }),
      ch('이의를 신청한다', (_c, v) => `반반: 변화 없음 / 자금 −${eok(num(v, 'amount') * 1.5)}`, (c, v, rng) => { if (rng.chance(0.5)) return '이의가 받아들여졌습니다.'; cash(c, -num(v, 'amount') * 1.5, '세무 추징 가산세'); return '이의가 기각돼 가산세까지 붙었습니다.'; }),
    ] },
  { id: 'x-merch-boom', title: '굿즈 판매 호조', weight: 5,
    vars: amt(8000, 12000),
    text: () => '구단 굿즈가 날개 돋친 듯 팔리고 있습니다. 추가 생산을 할지 정해야 합니다.',
    choices: [
      ch('그대로 판다', '자금 +1.0억 원', (c) => { cash(c, 10000, '굿즈 판매'); return '준비한 물량을 모두 팔았습니다.'; }),
      pay('추가 생산한다', 'cost', '반반: 자금 +3.0억 원 / +0.5억 원', (c, _v, rng) => { const g = rng.chance(0.5) ? 30000 : 5000; cash(c, g, '굿즈 추가 판매'); return g > 10000 ? '추가 물량도 다 팔렸습니다.' : '재고가 조금 남았습니다.'; }, '굿즈 추가 생산'),
    ] },
  { id: 'x-food-vendor', title: '구장 먹거리 업체 교체', weight: 3,
    vars: amt(8000, 12000),
    text: () => '구장 먹거리가 맛없다는 평이 많습니다. 유명 업체가 입점을 제안했습니다.',
    choices: [
      none('그대로 둔다'),
      pay('새 업체를 들인다', 'cost', `20일 동안 관중률 ${fp(0.03)}`, (c) => { c.addFill(0.03, 20, '구장 먹거리'); return '구장 먹거리가 화제가 됐습니다.'; }, '먹거리 업체 입점 공사'),
    ] },
  { id: 'x-naming-rights', title: '구장 명명권 제안', weight: 2,
    vars: (_c, rng) => ({ amount: Math.round(rng.range(60000, 120000) / 1000) * 1000 }),
    text: (_c, v) => `한 기업이 남은 시즌 구장 이름에 자기 회사 이름을 붙이는 대가로 ${won(_c, v, 'amount')}을 제안했습니다.`,
    choices: [
      none('정중히 거절한다', '제안을 거절했습니다.'),
      ch('받아들인다', (_c, v) => `자금 +${won(_c, v, 'amount')}, 팬 만족도 −2`, (c, v) => { cash(c, num(v, 'amount'), '구장 명명권'); c.addFans(-2, '구장 이름 변경'); return '구장 이름이 바뀌었습니다. 오랜 팬들은 서운해합니다.'; }),
    ] },
  { id: 'x-broadcast-dispute', title: '중계권 분쟁', weight: 2,
    vars: amt(8000, 15000),
    text: () => '중계사와 리그의 갈등으로 일부 경기 중계가 끊겼습니다. 구단 몫 수입도 줄어듭니다.',
    choices: [
      ch('리그 결정을 따른다', (_c, v) => `자금 −${won(_c, v, 'cost')}, 10일 동안 관중률 ${fp(-0.01)}`, (c, v) => { cash(c, -num(v, 'cost'), '중계 중단 손실'); c.addFill(-0.01, 10, '중계 중단'); return '중계가 다시 이어질 때까지 기다립니다.'; }),
    ] },
  { id: 'x-school-support', title: '지역 학교 야구부 지원 요청', weight: 3,
    vars: amt(8000, 12000),
    text: () => '연고지 고교 야구부가 장비 지원을 부탁해 왔습니다.',
    choices: [
      ch('사양한다', '팬 만족도 −1', (c) => { c.addFans(-1, '지원 사양'); return '이번에는 어렵다고 답했습니다.'; }),
      pay('지원한다', 'cost', '구단주 신뢰도 +1, 팬 만족도 +2', (c) => { c.addTrust(1); c.addFans(2, '학교 야구부 지원'); return '지역 야구부에 장비를 보냈습니다.'; }, '학교 야구부 지원'),
    ] },
  { id: 'x-parent-cost-cut', title: '모기업 비용 절감 지시', weight: 3,
    vars: (_c, rng) => ({ amount: Math.round(rng.range(20000, 40000) / 1000) * 1000 }),
    text: (_c, v) => `모기업이 계열사 전체에 비용 절감을 지시했습니다. 구단도 ${won(_c, v, 'amount')}을 줄여야 합니다.`,
    choices: [
      ch('따른다', (_c, v) => `자금 −${won(_c, v, 'amount')}`, (c, v) => { cash(c, -num(v, 'amount'), '모기업 비용 절감'); return '지시에 따라 예산을 줄였습니다.'; }),
      ch('구단 사정을 설명하며 버틴다', '구단주 신뢰도 −3', (c) => { c.addTrust(-3); return '예산은 지켰지만 모기업의 눈총을 받았습니다.'; }),
    ] },
  { id: 'x-win-bonus', title: '선수단 승리수당 요구', weight: 3, when: (c) => c.rank <= 3,
    vars: amt(15000, 25000),
    text: () => '상위권 싸움이 이어지자 선수단 대표가 승리수당을 올려 달라고 요청했습니다.',
    choices: [
      ch('거절한다', `7일 동안 팀 경기력 ${ed(-0.01)}`, (c) => { c.addForm(-0.01, 7, '수당 거절'); return '선수단이 다소 실망한 눈치입니다.'; }),
      pay('올려 준다', 'cost', `10일 동안 팀 경기력 ${ed(0.01)}`, (c) => { c.addForm(0.01, 10, '승리수당'); return '선수단 분위기가 올라갔습니다.'; }, '승리수당'),
    ] },
  { id: 'x-insurance', title: '선수 보험료 인상', weight: 2,
    vars: amt(8000, 12000),
    text: () => '선수단 상해보험료가 올랐습니다.',
    choices: [
      pay('감수한다', 'cost', '', () => '보험을 그대로 유지했습니다.', '보험료 인상분'),
      ch('보장을 줄인다', '구단주 신뢰도 −1, 팬 만족도 −1', (c) => { c.addTrust(-1); c.addFans(-1, '보험 축소 논란'); return '보장을 줄였다는 소식에 비판이 나왔습니다.'; }),
    ] },
  { id: 'x-game-collab', title: '게임사 협업 제안', weight: 3,
    text: () => '모바일 야구 게임사가 구단 협업 이벤트를 제안했습니다.',
    choices: [
      none('거절한다', '제안을 거절했습니다.'),
      ch('계약한다', `자금 +2.0억 원, 15일 동안 관중률 ${fp(0.02)}`, (c) => { cash(c, 20000, '게임사 협업'); c.addFill(0.02, 15, '게임 협업'); return '협업 이벤트가 젊은 팬들의 관심을 끌었습니다.'; }),
    ] },
  { id: 'x-rain-refund', title: '우천 취소 환불', weight: 3, when: (c) => c.month >= 5 && c.month <= 8,
    vars: amt(5000, 12000),
    text: () => '비로 경기가 취소됐습니다. 이미 입장한 관중에게 어떻게 보상할지 정해야 합니다.',
    choices: [
      ch('다음 경기 교환권만 준다', '팬 만족도 −2', (c) => { c.addFans(-2, '우천 환불'); return '교환권을 나눠 줬습니다.'; }),
      pay('전액 환불한다', 'cost', '팬 만족도 +1', (c) => { c.addFans(1, '우천 전액 환불'); return '전액 환불했습니다.'; }, '우천 환불'),
    ] },
  { id: 'x-scalpers', title: '암표 기승', weight: 3,
    vars: amt(4000, 7000),
    text: () => '인기 경기 표가 온라인에서 몇 배 값에 팔리고 있습니다.',
    choices: [
      ch('지켜본다', '팬 만족도 −2', (c) => { c.addFans(-2, '암표'); return '팬들의 불만이 커졌습니다.'; }),
      pay('단속과 예매 제한을 강화한다', 'cost', '팬 만족도 +2', (c) => { c.addFans(2, '암표 단속'); return '암표가 줄었습니다.'; }, '암표 단속'),
    ] },
  { id: 'x-memorabilia', title: '기념품 경매 수익', weight: 3,
    text: () => '자선 경매에 내놓은 구단 기념품이 예상보다 비싸게 팔렸습니다.',
    choices: [
      ch('구단 운영비로 쓴다', '자금 +1.5억 원', (c) => { cash(c, 15000, '기념품 경매'); return '수익을 운영비로 돌렸습니다.'; }),
      ch('전액 기부한다', '구단주 신뢰도 +2, 팬 만족도 +2', (c) => { c.addTrust(2); c.addFans(2, '경매 수익 기부'); return '수익을 지역 사회에 기부했습니다.'; }),
    ] },

  // ======== 팬·관중 (16)
  { id: 'x-truck-protest', title: '팬들의 트럭 시위', weight: 5, when: losing,
    text: (c) => `성적 부진에 화난 팬들이 구장 앞에 전광판 트럭을 세웠습니다. "${c.teamName}, 이대로는 안 된다"`,
    choices: [
      ch('묵묵히 경기에 집중한다', '구단주 신뢰도 −2, 팬 만족도 −3', (c) => { c.addTrust(-2); c.addFans(-3, '트럭 시위'); return '침묵이 길어지자 비판이 더 커졌습니다.'; }),
      ch('단장 입장문을 낸다', '반반: 팬 만족도 +2 / −4', (c, _v, rng) => { if (rng.chance(0.5)) { c.addFans(2, '단장 입장문'); return '진정성 있는 입장문이라는 평을 받았습니다.'; } c.addFans(-4, '입장문 역풍'); return '변명처럼 들린다는 반응이 많았습니다.'; }),
    ] },
  { id: 'x-cheer-song', title: '응원가 저작권 문제', weight: 3,
    vars: amt(8000, 12000),
    text: () => '오래 쓰던 응원가가 저작권 문제로 더는 쓸 수 없게 됐습니다.',
    choices: [
      ch('새 응원가로 바꾼다', `10일 동안 관중률 ${fp(-0.02)}`, (c) => { c.addFill(-0.02, 10, '응원가 교체'); return '새 응원가가 아직 입에 붙지 않았습니다.'; }),
      pay('사용료를 내고 계속 쓴다', 'cost', '', () => '익숙한 응원가가 계속 울립니다.', '응원가 사용료'),
    ] },
  { id: 'x-cheer-team', title: '응원단 개편 제안', weight: 3,
    vars: amt(8000, 12000),
    text: () => '마케팅팀이 응원단을 새로 꾸리자고 합니다.',
    choices: [
      none('지금 응원단을 유지한다'),
      pay('새 응원단을 꾸린다', 'cost', `20일 동안 관중률 ${fp(0.03)}`, (c) => { c.addFill(0.03, 20, '새 응원단'); return '새 응원 방식이 호응을 얻었습니다.'; }, '응원단 개편'),
    ] },
  { id: 'x-fan-meeting', title: '팬 미팅 요청', weight: 4,
    vars: amt(4000, 6000),
    text: () => '팬 커뮤니티에서 선수단 팬 미팅을 열어 달라는 요청이 많습니다.',
    choices: [
      ch('시즌 중이라 사양한다', '팬 만족도 −1', (c) => { c.addFans(-1, '팬 미팅 사양'); return '시즌 뒤로 미뤘습니다.'; }),
      pay('연다', 'cost', '팬 만족도 +3', (c) => { c.addFans(3, '팬 미팅'); return '팬 미팅이 성황리에 끝났습니다.'; }, '팬 미팅'),
    ] },
  { id: 'x-away-crowd', title: '원정 팬 대거 방문 예고', weight: 3,
    text: () => '다음 홈 경기에 상대 원정 팬이 대거 몰려올 것이라는 예고입니다.',
    choices: [
      ch('홈 팬석을 지킨다', '팬 만족도 +1', (c) => { c.addFans(1, '홈석 유지'); return '홈 팬들의 자리를 지켰습니다.'; }),
      ch('원정석을 늘려 판다', '자금 +1.0억 원, 팬 만족도 −1', (c) => { cash(c, 10000, '원정석 확대'); c.addFans(-1, '원정석 확대'); return '표는 더 팔렸지만 홈 팬들은 서운해합니다.'; }),
    ] },
  { id: 'x-kids-day', title: '어린이날 행사', weight: 6, when: (c) => c.month === 5,
    vars: amt(8000, 12000),
    text: () => '어린이날 주간입니다. 행사를 얼마나 크게 할지 정해야 합니다.',
    choices: [
      none('평소대로 한다'),
      pay('크게 연다', 'cost', `팬 만족도 +3, 10일 동안 관중률 ${fp(0.03)}`, (c) => { c.addFans(3, '어린이날 행사'); c.addFill(0.03, 10, '어린이날'); return '가족 관중이 구장을 가득 메웠습니다.'; }, '어린이날 행사'),
    ] },
  { id: 'x-foul-ball', title: '파울볼 관중 부상', weight: 3,
    vars: amt(15000, 25000),
    text: () => '파울볼에 관중이 다치는 사고가 났습니다. 보호 그물이 낮다는 지적이 나옵니다.',
    choices: [
      ch('최소한만 보상한다', '팬 만족도 −3, 구단주 신뢰도 −1', (c) => { c.addFans(-3, '파울볼 사고'); c.addTrust(-1); return '안전 대책이 부족하다는 비판을 받았습니다.'; }),
      pay('보상하고 그물을 높인다', 'cost', '팬 만족도 +1', (c) => { c.addFans(1, '안전 그물 보강'); return '보호 그물을 높였습니다.'; }, '안전 그물 보강'),
    ] },
  { id: 'x-sns-viral', title: '팬 영상 화제', weight: 4,
    vars: amt(3000, 4000),
    text: () => '관중석의 한 장면을 담은 팬 영상이 SNS에서 크게 퍼지고 있습니다.',
    choices: [
      ch('지켜본다', `10일 동안 관중률 ${fp(0.02)}`, (c) => { c.addFill(0.02, 10, '팬 영상'); return '화제가 자연스럽게 이어졌습니다.'; }),
      pay('구단 SNS로 키운다', 'cost', `20일 동안 관중률 ${fp(0.04)}`, (c) => { c.addFill(0.04, 20, '팬 영상 홍보'); return '구단 계정이 영상을 이어 받아 화제를 키웠습니다.'; }, 'SNS 홍보'),
    ] },
  { id: 'x-booing', title: '홈 팬들의 야유', weight: 4, when: losing,
    text: () => '홈 경기 내내 야유가 쏟아졌습니다. 선수들이 위축된 모습입니다.',
    choices: [
      ch('묵묵히 이겨 낸다', `7일 동안 팀 경기력 ${ed(-0.01)}`, (c) => { c.addForm(-0.01, 7, '야유'); return '선수단이 위축된 채 경기를 치릅니다.'; }),
      ch('선수단 이름으로 사과문을 낸다', '팬 만족도 +2, 구단주 신뢰도 −1', (c) => { c.addFans(2, '선수단 사과문'); c.addTrust(-1); return '팬들의 분노가 조금 누그러졌습니다.'; }),
    ] },
  { id: 'x-season-ticket', title: '시즌권 판매 부진', weight: 3,
    vars: amt(8000, 12000),
    text: () => '하반기 시즌권 판매가 지난해보다 저조합니다.',
    choices: [
      ch('그대로 둔다', `20일 동안 관중률 ${fp(-0.02)}`, (c) => { c.addFill(-0.02, 20, '시즌권 부진'); return '빈자리가 눈에 띕니다.'; }),
      ch('할인 판매한다', (_c, v) => `자금 −${won(_c, v, 'cost')}, 20일 동안 관중률 ${fp(0.02)}`, (c, v) => { cash(c, -num(v, 'cost'), '시즌권 할인'); c.addFill(0.02, 20, '시즌권 할인'); return '할인 덕에 시즌권이 다시 팔리기 시작했습니다.'; }),
    ] },
  { id: 'x-fan-donation', title: '팬클럽의 단체 선물', weight: 3,
    text: () => '팬클럽이 선수단에 보양식과 응원 편지를 보내왔습니다.',
    choices: [
      ch('감사 영상을 찍어 답한다', `팬 만족도 +2, 5일 동안 팀 경기력 ${ed(0.005)}`, (c) => { c.addFans(2, '팬클럽 선물 답례'); c.addForm(0.005, 5, '팬 응원'); return '선수단이 감사 인사를 전했습니다.'; }),
    ] },
  { id: 'x-mascot', title: '마스코트 인기 폭발', weight: 3,
    vars: amt(4000, 6000),
    text: () => '구단 마스코트의 춤 영상이 인기를 끌고 있습니다.',
    choices: [
      none('그대로 둔다'),
      pay('마스코트 굿즈를 낸다', 'cost', '자금 +1.5억 원', (c) => { cash(c, 15000, '마스코트 굿즈'); return '마스코트 인형이 매진됐습니다.'; }, '마스코트 굿즈 제작'),
    ] },
  { id: 'x-parking', title: '구장 주차난 민원', weight: 3,
    vars: amt(8000, 12000),
    text: () => '경기 날마다 구장 주변 주차난이 심하다는 민원이 쌓였습니다.',
    choices: [
      ch('지켜본다', `20일 동안 관중률 ${fp(-0.03)}, 팬 만족도 −1`, (c) => { c.addFill(-0.03, 20, '주차난'); c.addFans(-1, '주차난'); return '구장 오기가 불편하다는 말이 늘었습니다.'; }),
      pay('셔틀버스를 운행한다', 'cost', '영향 없음', () => '셔틀버스로 주차난을 덜었습니다.', '셔틀버스'),
    ] },
  { id: 'x-beer-price', title: '구장 맥주 가격 논란', weight: 3,
    vars: amt(4000, 6000),
    text: () => '구장 맥주가 너무 비싸다는 불만이 커졌습니다.',
    choices: [
      ch('가격을 유지한다', '팬 만족도 −2', (c) => { c.addFans(-2, '맥주 가격'); return '불만이 이어집니다.'; }),
      ch('가격을 내린다', (_c, v) => `자금 −${won(_c, v, 'cost')}, 팬 만족도 +2`, (c, v) => { cash(c, -num(v, 'cost'), '맥주 가격 인하'); c.addFans(2, '맥주 가격 인하'); return '가격 인하에 반응이 좋습니다.'; }),
    ] },
  { id: 'x-anniversary', title: '창단 기념일', weight: 2,
    vars: amt(15000, 25000),
    text: (c) => `${c.teamName}의 창단 기념일이 다가옵니다.`,
    choices: [
      ch('소박하게 기념한다', '팬 만족도 +1', (c) => { c.addFans(1, '창단 기념일'); return '조촐한 기념식을 열었습니다.'; }),
      pay('크게 연다', 'cost', `팬 만족도 +4, 15일 동안 관중률 ${fp(0.05)}`, (c) => { c.addFans(4, '창단 기념 행사'); c.addFill(0.05, 15, '창단 기념'); return '옛 유니폼과 레전드 영상으로 구장이 들썩였습니다.'; }, '창단 기념 행사'),
    ] },
  { id: 'x-rival-fans', title: '라이벌 팬 충돌 우려', weight: 3, when: (c) => c.hasRival,
    vars: amt(4000, 6000),
    text: () => '라이벌전을 앞두고 양 팀 팬 사이 신경전이 심상치 않습니다.',
    choices: [
      ch('평소대로 운영한다', '반반: 팬 만족도 −3·구단주 신뢰도 −2 / 변화 없음', (c, _v, rng) => { if (rng.chance(0.5)) { c.addFans(-3, '팬 충돌'); c.addTrust(-2); return '관중석에서 충돌이 일어나 비판을 받았습니다.'; } return '큰 탈 없이 지나갔습니다.'; }),
      pay('경호 인력을 늘린다', 'cost', '영향 없음', () => '안전하게 경기를 치렀습니다.', '경호 인력'),
    ] },

  // ======== 언론·평판 (12)
  { id: 'x-fake-news', title: '트레이드설 오보', weight: 4,
    text: () => '우리 주축 선수가 트레이드된다는 오보가 퍼졌습니다. 선수단이 뒤숭숭합니다.',
    choices: [
      ch('즉시 정정 보도를 요청한다', '영향 없음', () => '구단이 사실이 아니라고 밝혔습니다.'),
      ch('무시한다', `5일 동안 팀 경기력 ${ed(-0.01)}`, (c) => { c.addForm(-0.01, 5, '오보 여파'); return '소문이 한동안 이어졌습니다.'; }),
    ] },
  { id: 'x-documentary', title: '다큐멘터리 촬영 제안', weight: 3,
    text: () => '방송사가 한 시즌을 따라가는 다큐멘터리를 찍고 싶다고 합니다.',
    choices: [
      none('거절한다', '정중히 거절했습니다.'),
      ch('허락한다', `자금 +1.0억 원, 팬 만족도 +2, 5일 동안 팀 경기력 ${ed(-0.005)}`, (c) => { cash(c, 10000, '다큐 촬영'); c.addFans(2, '다큐 촬영'); c.addForm(-0.005, 5, '카메라 부담'); return '카메라가 더그아웃에 들어왔습니다.'; }),
    ] },
  { id: 'x-variety-show', title: '예능 출연 제안', weight: 3, when: (c) => regulars(c).length > 0,
    vars: (c, rng) => who(pick(regulars(c), rng)),
    text: (_c, v) => `예능 프로그램에서 ${str(v, 'name')} 선수의 출연을 요청했습니다.`,
    choices: [
      none('시즌 중이라 거절한다', '정중히 거절했습니다.'),
      ch('허락한다', `팬 만족도 +2, 3일 동안 그 선수 경기력 ${ed(-0.02)}`, (c, v) => { c.addFans(2, '예능 출연'); c.addForm(-0.02, 3, '방송 출연', { player: str(v, 'id') }); return '방송이 나가고 구단에 관심이 쏠렸습니다.'; }),
    ] },
  { id: 'x-commentator', title: '해설위원의 혹평', weight: 4, when: (c) => c.rank > c.teams / 2,
    text: () => '한 해설위원이 중계 중 구단 운영을 강하게 비판했습니다.',
    choices: [
      ch('대응하지 않는다', '구단주 신뢰도 −1', (c) => { c.addTrust(-1); return '비판이 그대로 남았습니다.'; }),
      ch('공식적으로 반박한다', '반반: 구단주 신뢰도 +2 / −3', (c, _v, rng) => { if (rng.chance(0.5)) { c.addTrust(2); return '조목조목 반박해 지지를 얻었습니다.'; } c.addTrust(-3); return '반박이 오히려 논란을 키웠습니다.'; }),
    ] },
  { id: 'x-youtube-hit', title: '구단 유튜브 영상 대박', weight: 4,
    vars: amt(8000, 12000),
    text: () => '구단 유튜브의 더그아웃 비하인드 영상이 조회 수 100만을 넘었습니다.',
    choices: [
      ch('그대로 운영한다', '팬 만족도 +1', (c) => { c.addFans(1, '유튜브 화제'); return '구독자가 늘었습니다.'; }),
      pay('콘텐츠 투자를 늘린다', 'cost', '자금 +2.0억 원, 팬 만족도 +2', (c) => { cash(c, 20000, '유튜브 수익'); c.addFans(2, '유튜브 투자'); return '구단 채널이 자리를 잡았습니다.'; }, '유튜브 제작비'),
    ] },
  { id: 'x-youtube-backlash', title: '구단 영상 역풍', weight: 3,
    text: () => '구단이 올린 영상이 패배 직후 너무 가볍다는 비판을 받고 있습니다.',
    choices: [
      ch('영상을 내리고 사과한다', '팬 만족도 −1', (c) => { c.addFans(-1, '영상 사과'); return '빠르게 사과해 논란이 가라앉았습니다.'; }),
      ch('그대로 둔다', '반반: 팬 만족도 +1 / −4', (c, _v, rng) => { if (rng.chance(0.5)) { c.addFans(1, '영상 화제'); return '오히려 재밌다는 반응도 많았습니다.'; } c.addFans(-4, '영상 역풍'); return '논란이 커졌습니다.'; }),
    ] },
  { id: 'x-press-conference', title: '연패 기자회견 요청', weight: 4, when: (c) => c.streak <= -5,
    text: () => '긴 연패에 기자들이 단장의 기자회견을 요구하고 있습니다.',
    choices: [
      ch('보도자료로 대신한다', '구단주 신뢰도 −1', (c) => { c.addTrust(-1); return '짧은 보도자료를 냈습니다.'; }),
      ch('단장이 직접 나선다', '반반: 구단주 신뢰도 +2 / −3', (c, _v, rng) => { if (rng.chance(0.5)) { c.addTrust(2); return '책임감 있는 모습이라는 평을 받았습니다.'; } c.addTrust(-3); return '답변이 핵심을 비켜 갔다는 비판을 받았습니다.'; }),
    ] },
  { id: 'x-best-club', title: '우수 구단 선정', weight: 3, when: (c) => c.rank <= 3,
    text: () => '한 스포츠 매체가 올해 가장 잘 운영되는 구단으로 우리를 꼽았습니다.',
    choices: [
      ch('감사히 받는다', '구단주 신뢰도 +2, 팬 만족도 +1', (c) => { c.addTrust(2); c.addFans(1, '우수 구단 선정'); return '구단주가 흡족해합니다.'; }),
    ] },
  { id: 'x-league-fine', title: '경기 지연 벌금', weight: 3,
    vars: amt(4000, 6000),
    text: () => '경기 시작 지연으로 리그가 구단에 벌금을 매겼습니다.',
    choices: [
      ch('납부한다', (_c, v) => `자금 −${won(_c, v, 'cost')}`, (c, v) => { cash(c, -num(v, 'cost'), '리그 벌금'); return '벌금을 냈습니다.'; }),
      ch('이의를 제기한다', (_c, v) => `반반: 변화 없음 / 자금 −${eok(num(v, 'cost') * 2)}·구단주 신뢰도 −1`, (c, v, rng) => { if (rng.chance(0.5)) return '이의가 받아들여졌습니다.'; cash(c, -num(v, 'cost') * 2, '리그 벌금 가중'); c.addTrust(-1); return '이의가 기각되고 벌금이 늘었습니다.'; }),
    ] },
  { id: 'x-bench-clear', title: '벤치 클리어링', weight: 3,
    vars: amt(4000, 6000),
    text: () => '몸에 맞는 공을 두고 양 팀 선수단이 그라운드로 쏟아져 나왔습니다. 리그가 징계를 검토합니다.',
    choices: [
      ch('리그 징계를 받아들인다', (_c, v) => `자금 −${won(_c, v, 'cost')}, 5일 동안 팀 경기력 ${ed(-0.01)}`, (c, v) => { cash(c, -num(v, 'cost'), '벤치 클리어링 제재금'); c.addForm(-0.01, 5, '징계 여파'); return '제재금을 내고 일단락했습니다.'; }),
      ch('강하게 항의한다', '반반: 팬 만족도 +2 / 구단주 신뢰도 −2', (c, _v, rng) => { if (rng.chance(0.5)) { c.addFans(2, '선수 보호 항의'); return '선수를 지켰다는 평을 받았습니다.'; } c.addTrust(-2); return '항의가 지나쳤다는 지적을 받았습니다.'; }),
    ] },
  { id: 'x-umpire-call', title: '판정 논란', weight: 4,
    text: () => '어제 경기 결정적인 순간의 판정을 두고 논란이 큽니다.',
    choices: [
      ch('넘어간다', '팬 만족도 −1', (c) => { c.addFans(-1, '판정 논란'); return '아쉬움을 삼켰습니다.'; }),
      ch('리그에 공문을 보낸다', '구단주 신뢰도 +1', (c) => { c.addTrust(1); return '리그가 판정 과정을 다시 들여다보겠다고 답했습니다.'; }),
    ] },
  { id: 'x-pr-campaign', title: '홍보 캠페인 제안', weight: 3,
    vars: amt(15000, 25000),
    text: () => '광고 대행사가 지하철·버스 광고를 포함한 홍보 캠페인을 제안했습니다.',
    choices: [
      none('보류한다'),
      pay('진행한다', 'cost', `30일 동안 관중률 ${fp(0.04)}`, (c) => { c.addFill(0.04, 30, '홍보 캠페인'); return '도시 곳곳에 구단 광고가 걸렸습니다.'; }, '홍보 캠페인'),
    ] },

  // ======== 프런트 운영 (12)
  { id: 'x-scout-poached', title: '스카우트 이직 위기', weight: 3,
    vars: amt(8000, 12000),
    text: () => '베테랑 스카우트가 다른 구단의 제안을 받았습니다.',
    choices: [
      ch('보낸다', '유망주 한 명 잠재력 −1', (c) => { const p = prospects(c)[0]; if (p) c.addPotential(p.id, -1); return '스카우트가 떠났습니다. 유망주 관리에 빈틈이 생겼습니다.'; }),
      pay('대우를 올려 붙잡는다', 'cost', '영향 없음', () => '스카우트가 남기로 했습니다.', '스카우트 연봉 인상'),
    ] },
  { id: 'x-data-team', title: '데이터팀 확충 제안', weight: 3,
    vars: amt(25000, 35000),
    text: () => '전력분석팀이 데이터 인력을 늘려 달라고 요청했습니다.',
    choices: [
      none('보류한다'),
      pay('확충한다', 'cost', `30일 동안 팀 경기력 ${ed(0.005)}`, (c) => { c.addForm(0.005, 30, '데이터팀 확충'); return '분석 인력을 늘렸습니다.'; }, '데이터팀 확충'),
    ] },
  { id: 'x-bus-breakdown', title: '구단 버스 노후', weight: 3,
    vars: amt(15000, 25000),
    text: () => '구단 버스가 또 고장 났습니다. 너무 오래 탔다는 말이 나옵니다.',
    choices: [
      ch('빌려 쓴다', `3일 동안 팀 경기력 ${ed(-0.01)}`, (c) => { c.addForm(-0.01, 3, '버스 고장'); return '급히 빌린 버스로 이동했습니다.'; }),
      pay('새 버스를 산다', 'cost', '영향 없음', () => '새 버스가 들어왔습니다.', '구단 버스 구입'),
    ] },
  { id: 'x-farm-facility', title: '2군 훈련장 노후', weight: 3,
    vars: amt(25000, 35000),
    text: () => '2군 훈련장 시설이 낡아 부상 위험이 있다는 보고가 올라왔습니다.',
    choices: [
      ch('미룬다', '유망주 한 명 잠재력 −1', (c) => { const p = prospects(c)[1] ?? prospects(c)[0]; if (p) c.addPotential(p.id, -1); return '보수를 미뤘습니다.'; }),
      pay('보수한다', 'cost', '유망주 두 명 잠재력 +1', (c) => { for (const p of prospects(c).slice(0, 2)) c.addPotential(p.id, 1); return '2군 시설을 새로 단장했습니다.'; }, '2군 시설 보수'),
    ] },
  { id: 'x-front-conflict', title: '프런트 내부 갈등', weight: 3,
    vars: amt(4000, 6000),
    text: () => '운영팀과 마케팅팀 사이 갈등이 커지고 있다는 보고입니다.',
    choices: [
      ch('조용히 덮는다', '반반: 변화 없음 / 구단주 신뢰도 −3', (c, _v, rng) => { if (rng.chance(0.5)) return '갈등이 잦아들었습니다.'; c.addTrust(-3); return '갈등이 바깥으로 새어 나갔습니다.'; }),
      ch('조직을 손본다', (_c, v) => `자금 −${won(_c, v, 'cost')}, 구단주 신뢰도 −1`, (c, v) => { cash(c, -num(v, 'cost'), '조직 개편'); c.addTrust(-1); return '조직을 개편했습니다.'; }),
    ] },
  { id: 'x-intern-idea', title: '인턴의 기발한 아이디어', weight: 3,
    text: () => '마케팅팀 인턴이 낸 관중 이벤트 아이디어가 내부에서 호평을 받았습니다.',
    choices: [
      none('나중에 검토한다'),
      ch('바로 해 본다', `15일 동안 관중률 ${fp(0.02)}`, (c) => { c.addFill(0.02, 15, '인턴 아이디어'); return '이벤트가 반응을 얻었습니다.'; }),
    ] },
  { id: 'x-site-hacked', title: '구단 홈페이지 해킹', weight: 2,
    vars: amt(8000, 12000),
    text: () => '구단 홈페이지가 해킹당해 한동안 접속이 막혔습니다.',
    choices: [
      ch('임시로 복구한다', '팬 만족도 −2', (c) => { c.addFans(-2, '홈페이지 해킹'); return '불안하다는 팬 반응이 이어집니다.'; }),
      pay('보안을 새로 갖춘다', 'cost', '팬 만족도 −1', (c) => { c.addFans(-1, '홈페이지 해킹'); return '보안 체계를 다시 갖췄습니다.'; }, '홈페이지 보안'),
    ] },
  { id: 'x-strength-coach', title: '컨디셔닝 코치 영입 제안', weight: 3,
    vars: amt(15000, 25000),
    text: () => '미국 구단 출신 컨디셔닝 코치가 합류 의사를 밝혔습니다.',
    choices: [
      none('보류한다'),
      pay('영입한다', 'cost', `30일 동안 팀 경기력 ${ed(0.005)}`, (c) => { c.addForm(0.005, 30, '컨디셔닝 코치'); return '새 코치가 체력 관리를 맡았습니다.'; }, '컨디셔닝 코치'),
    ] },
  { id: 'x-mental-coach', title: '멘탈 코치 영입 제안', weight: 3,
    vars: amt(8000, 12000),
    text: () => '스포츠 심리 전문가가 선수단과 함께하고 싶다고 합니다.',
    choices: [
      none('보류한다'),
      pay('영입한다', 'cost', `14일 동안 팀 경기력 ${ed(0.01)}`, (c) => { c.addForm(0.01, 14, '멘탈 코치'); return '선수들이 상담을 받기 시작했습니다.'; }, '멘탈 코치'),
    ] },
  { id: 'x-turf', title: '홈 구장 잔디 상태 악화', weight: 3,
    vars: amt(15000, 25000),
    text: () => '홈 구장 내야 잔디가 군데군데 파였습니다. 불규칙 바운드가 잦습니다.',
    choices: [
      ch('시즌 뒤로 미룬다', `15일 동안 팀 경기력 ${ed(-0.01)}`, (c) => { c.addForm(-0.01, 15, '잔디 상태'); return '수비가 불안해졌습니다.'; }),
      pay('바로 보수한다', 'cost', '영향 없음', () => '잔디를 새로 깔았습니다.', '잔디 보수'),
    ] },
  { id: 'x-locker-room', title: '라커룸 개선 요청', weight: 3,
    vars: amt(25000, 35000),
    text: () => '선수단이 낡은 라커룸과 사우나 시설을 바꿔 달라고 요청했습니다.',
    choices: [
      ch('다음에 하자고 한다', `7일 동안 팀 경기력 ${ed(-0.005)}`, (c) => { c.addForm(-0.005, 7, '시설 불만'); return '선수단이 아쉬워합니다.'; }),
      pay('공사한다', 'cost', `30일 동안 팀 경기력 ${ed(0.005)}`, (c) => { c.addForm(0.005, 30, '라커룸 개선'); return '라커룸이 새로 단장됐습니다.'; }, '라커룸 공사'),
    ] },
  { id: 'x-hotel-upgrade', title: '원정 숙소 업그레이드', weight: 3,
    vars: amt(12000, 18000),
    text: () => '원정 숙소를 한 단계 좋은 곳으로 바꾸자는 의견이 나왔습니다.',
    choices: [
      none('지금 숙소를 쓴다'),
      pay('바꾼다', 'cost', `21일 동안 팀 경기력 ${ed(0.005)}`, (c) => { c.addForm(0.005, 21, '숙소 개선'); return '원정길이 한결 편해졌습니다.'; }, '원정 숙소'),
    ] },

  // ======== 육성 (10)
  { id: 'x-prospect-breakout', title: '2군 유망주 급성장 보고', weight: 4, when: (c) => prospects(c).length > 0,
    vars: (c, rng) => { const p = pick(prospects(c).slice(0, 5), rng); return { id: p.id, name: p.name }; },
    text: (_c, v) => `2군 코치진이 ${str(v, 'name')} 선수가 최근 눈에 띄게 좋아졌다고 보고했습니다.`,
    choices: [
      ch('지켜본다', '그 선수 잠재력 +1', (c, v) => { c.addPotential(str(v, 'id'), 1); return '꾸준히 지켜보기로 했습니다.'; }),
      ch('특별 프로그램을 붙인다', '반반: 그 선수 잠재력 +3 / +0', (c, v, rng) => { if (rng.chance(0.5)) { c.addPotential(str(v, 'id'), 3); return '프로그램이 잘 맞았습니다.'; } return '아직 큰 변화는 없습니다.'; }),
    ] },
  { id: 'x-prospect-slump', title: '유망주의 깊은 부진', weight: 4, when: (c) => prospects(c).length > 0,
    vars: (c, rng) => { const p = pick(prospects(c).slice(0, 6), rng); return { id: p.id, name: p.name, cost: 3000 }; },
    text: (_c, v) => `${str(v, 'name')} 선수가 2군에서도 긴 부진에 빠졌습니다.`,
    choices: [
      ch('스스로 이겨 내게 둔다', '그 선수 잠재력 −2', (c, v) => { c.addPotential(str(v, 'id'), -2); return '부진이 길어지고 있습니다.'; }),
      pay('전문 상담을 붙인다', 'cost', '영향 없음', () => '상담 뒤 조금씩 안정을 찾고 있습니다.', '유망주 상담'),
    ] },
  { id: 'x-farm-manager-clash', title: '2군 감독과 의견 충돌', weight: 3, when: (c) => prospects(c).length > 0,
    text: () => '2군 감독이 유망주 기용 방식을 두고 프런트와 다른 의견을 냈습니다.',
    choices: [
      ch('2군 감독 뜻에 맡긴다', '유망주 한 명 잠재력 +1, 구단주 신뢰도 −1', (c) => { const p = prospects(c)[0]; if (p) c.addPotential(p.id, 1); c.addTrust(-1); return '현장의 판단을 존중했습니다.'; }),
      ch('프런트 방침대로 간다', '반반: 유망주 한 명 잠재력 +1 / −1', (c, _v, rng) => { const p = prospects(c)[0]; if (p) c.addPotential(p.id, rng.chance(0.5) ? 1 : -1); return '프런트 방침대로 운영합니다.'; }),
    ] },
  { id: 'x-japan-camp', title: '해외 교육리그 초청', weight: 3, when: (c) => prospects(c).length >= 2,
    vars: amt(12000, 18000),
    text: () => '해외 구단이 유망주 교육리그에 우리 선수 둘을 초청했습니다.',
    choices: [
      none('사양한다'),
      pay('보낸다', 'cost', '유망주 두 명 잠재력 +2', (c) => { for (const p of prospects(c).slice(0, 2)) c.addPotential(p.id, 2); return '두 선수가 교육리그를 다녀왔습니다.'; }, '교육리그 파견'),
    ] },
  { id: 'x-pitching-lab', title: '피칭 랩 도입 제안', weight: 3,
    vars: amt(15000, 25000),
    text: () => '투구 동작을 정밀하게 분석하는 피칭 랩을 들이자는 제안입니다.',
    choices: [
      none('보류한다'),
      pay('도입한다', 'cost', '젊은 투수 두 명 잠재력 +2', (c) => { for (const p of prospects(c).filter((x) => x.isPitcher).slice(0, 2)) c.addPotential(p.id, 2); return '젊은 투수들이 피칭 랩에서 훈련을 시작했습니다.'; }, '피칭 랩'),
    ] },
  { id: 'x-swing-change', title: '유망주 타격 폼 수정', weight: 3, when: (c) => prospects(c).some((p) => !p.isPitcher),
    vars: (c) => { const p = prospects(c).find((x) => !x.isPitcher)!; return { id: p.id, name: p.name }; },
    text: (_c, v) => `타격 코치가 ${str(v, 'name')} 선수의 타격 폼을 크게 바꾸자고 제안했습니다.`,
    choices: [
      none('지금 폼을 유지한다'),
      ch('바꾼다', '반반: 그 선수 잠재력 +3 / −1', (c, v, rng) => { const up = rng.chance(0.5); c.addPotential(str(v, 'id'), up ? 3 : -1); return up ? '새 폼이 잘 맞습니다.' : '새 폼에 적응하지 못하고 있습니다.'; }),
    ] },
  { id: 'x-overtraining', title: '유망주 과훈련 우려', weight: 3, when: (c) => prospects(c).length > 0,
    vars: (c) => { const p = prospects(c)[0]; return { id: p.id, name: p.name }; },
    text: (_c, v) => `${str(v, 'name')} 선수가 밤늦게까지 혼자 훈련한다는 보고입니다. 과훈련이 걱정됩니다.`,
    choices: [
      ch('훈련량을 조절시킨다', '영향 없음', () => '코치진이 훈련량을 조절했습니다.'),
      ch('의욕을 존중한다', '반반: 그 선수 잠재력 +1 / −3', (c, v, rng) => { const up = rng.chance(0.5); c.addPotential(str(v, 'id'), up ? 1 : -3); return up ? '노력이 결실을 맺고 있습니다.' : '몸에 탈이 나 한동안 쉬어야 했습니다.'; }),
    ] },
  { id: 'x-interpreter', title: '외국인 선수 통역 문제', weight: 3, when: (c) => foreigners(c).length > 0,
    vars: amt(4000, 6000),
    text: () => '외국인 선수들이 코치진과 의사소통이 잘 안 된다고 호소합니다.',
    choices: [
      ch('지금 통역으로 간다', `10일 동안 외국인 선수 경기력 ${ed(-0.015)}`, (c) => { for (const p of foreigners(c)) c.addForm(-0.015, 10, '소통 문제', { player: p.id }); return '소통 문제가 이어집니다.'; }),
      pay('통역을 한 명 더 둔다', 'cost', `14일 동안 외국인 선수 경기력 ${ed(0.01)}`, (c) => { for (const p of foreigners(c)) c.addForm(0.01, 14, '통역 보강', { player: p.id }); return '외국인 선수들의 표정이 밝아졌습니다.'; }, '통역 추가'),
    ] },
  { id: 'x-family-visit', title: '외국인 선수 가족 방문 지원', weight: 3, when: (c) => foreigners(c).length > 0,
    vars: amt(4000, 6000),
    text: () => '외국인 선수들의 가족을 한국에 초청하자는 요청이 들어왔습니다.',
    choices: [
      ch('어렵다고 답한다', `14일 동안 외국인 선수 경기력 ${ed(-0.01)}`, (c) => { for (const p of foreigners(c)) c.addForm(-0.01, 14, '가족 방문 무산', { player: p.id }); return '아쉬워하는 눈치입니다.'; }),
      pay('항공권과 숙소를 지원한다', 'cost', `14일 동안 외국인 선수 경기력 ${ed(0.015)}`, (c) => { for (const p of foreigners(c)) c.addForm(0.015, 14, '가족 방문', { player: p.id }); return '가족과 함께 지내며 힘을 얻었습니다.'; }, '가족 방문 지원'),
    ] },
  { id: 'x-amateur-scouting', title: '아마추어 대회 관찰', weight: 3,
    vars: amt(4000, 6000),
    text: () => '전국 대회에서 지명 후보들이 대거 나온다는 소식입니다. 스카우트를 더 보낼지 정해야 합니다.',
    choices: [
      none('평소대로 본다'),
      pay('스카우트를 더 보낸다', 'cost', '구단주 신뢰도 +1', (c) => { c.addTrust(1); return '드래프트 후보 정보를 넉넉히 모았습니다.'; }, '아마추어 스카우팅'),
    ] },

  // ======== 리그·날씨·외부 (11)
  { id: 'x-typhoon', title: '태풍 북상', weight: 4, when: (c) => c.month === 8 || c.month === 9,
    vars: amt(4000, 6000),
    text: () => '태풍이 올라옵니다. 원정 이동 일정을 어떻게 할지 정해야 합니다.',
    choices: [
      ch('예정대로 이동한다', `3일 동안 팀 경기력 ${ed(-0.015)}`, (c) => { c.addForm(-0.015, 3, '태풍 이동'); return '험한 길을 뚫고 이동했습니다.'; }),
      pay('하루 일찍 이동한다', 'cost', '영향 없음', () => '태풍을 피해 미리 움직였습니다.', '태풍 조기 이동'),
    ] },
  { id: 'x-allstar-vote', title: '올스타 팬 투표', weight: 4, when: (c) => c.month === 6 || c.month === 7,
    vars: amt(4000, 6000),
    text: () => '올스타 팬 투표가 시작됐습니다. 우리 선수들을 홍보할지 정해야 합니다.',
    choices: [
      none('따로 홍보하지 않는다'),
      pay('투표 독려 이벤트를 연다', 'cost', '팬 만족도 +2', (c) => { c.addFans(2, '올스타 투표'); return '팬들이 투표에 몰렸습니다.'; }, '올스타 홍보'),
    ] },
  { id: 'x-allstar-break', title: '올스타 휴식기 뒤 리듬', weight: 4, when: (c) => c.month === 7,
    vars: amt(8000, 12000),
    text: () => '올스타 휴식기가 끝났습니다. 경기 감각을 어떻게 끌어올릴지 고민입니다.',
    choices: [
      ch('평소대로 간다', `5일 동안 팀 경기력 ${ed(-0.01)}`, (c) => { c.addForm(-0.01, 5, '휴식기 뒤 감각'); return '감각을 찾는 데 며칠이 걸렸습니다.'; }),
      pay('짧은 집중 훈련을 한다', 'cost', `5일 동안 팀 경기력 ${ed(0.005)}`, (c) => { c.addForm(0.005, 5, '후반기 훈련'); return '후반기를 힘차게 시작했습니다.'; }, '후반기 훈련'),
    ] },
  { id: 'x-pace-rule', title: '경기 시간 단축 규정', weight: 3,
    text: () => '리그가 경기 시간 단축을 위해 투수 준비 시간 규정을 강화했습니다.',
    choices: [
      ch('적응 훈련을 한다', `7일 동안 투수 경기력 ${ed(-0.005)}`, (c) => { c.addForm(-0.005, 7, '새 규정 적응', { side: 'pit' }); return '투수들이 새 규정에 맞춰 가고 있습니다.'; }),
      ch('그대로 둔다', `반반: 7일 동안 투수 경기력 ${ed(-0.015)} / 변화 없음`, (c, _v, rng) => { if (rng.chance(0.5)) { c.addForm(-0.015, 7, '규정 혼선', { side: 'pit' }); return '경고를 받으며 흔들렸습니다.'; } return '큰 문제 없이 적응했습니다.'; }),
    ] },
  { id: 'x-ball-debate', title: '공인구 반발력 논란', weight: 3,
    vars: amt(4000, 6000),
    text: () => '올해 공이 덜 날아간다는 이야기가 나옵니다. 타자들이 예민합니다.',
    choices: [
      none('신경 쓰지 않는다'),
      pay('타격 훈련을 보강한다', 'cost', `14일 동안 타자 경기력 ${ed(0.005)}`, (c) => { c.addForm(0.005, 14, '타격 보강', { side: 'bat' }); return '타자들이 짧게 치는 연습을 늘렸습니다.'; }, '타격 훈련 보강'),
    ] },
  { id: 'x-city-festival', title: '지자체 축제 연계 제안', weight: 3,
    text: () => '연고지 지자체가 축제 기간에 구장 행사를 함께하자고 제안했습니다.',
    choices: [
      none('사양한다'),
      ch('참여한다', `15일 동안 관중률 ${fp(0.03)}, 구단주 신뢰도 +1`, (c) => { c.addFill(0.03, 15, '지역 축제'); c.addTrust(1); return '축제와 함께 구장이 북적였습니다.'; }),
    ] },
  { id: 'x-flu-season', title: '독감 유행 경보', weight: 3,
    vars: amt(2000, 4000),
    text: () => '지역에 독감이 유행한다는 경보가 내려졌습니다.',
    choices: [
      ch('그냥 지나간다', `반반: 7일 동안 팀 경기력 ${ed(-0.02)} / 변화 없음`, (c, _v, rng) => { if (rng.chance(0.5)) { c.addForm(-0.02, 7, '독감'); return '독감이 선수단에 번졌습니다.'; } return '다행히 피해 갔습니다.'; }),
      pay('예방 접종을 한다', 'cost', '영향 없음', () => '선수단이 미리 접종했습니다.', '예방 접종'),
    ] },
  { id: 'x-power-outage', title: '경기 중 정전', weight: 2,
    vars: amt(8000, 12000),
    text: () => '홈 경기 도중 정전으로 경기가 한참 멈췄습니다.',
    choices: [
      ch('최소한만 보상한다', '팬 만족도 −2', (c) => { c.addFans(-2, '정전'); return '관중들의 불만이 남았습니다.'; }),
      pay('관중에게 보상한다', 'cost', '팬 만족도 +1', (c) => { c.addFans(1, '정전 보상'); return '다음 경기 할인권을 나눠 줬습니다.'; }, '정전 보상'),
    ] },
  { id: 'x-national-team', title: '국가대표 예비 명단', weight: 3, when: (c) => regulars(c).length > 0,
    vars: (c, rng) => who(pick(regulars(c), rng)),
    text: (_c, v) => `${str(v, 'name')} 선수가 국제대회 국가대표 예비 명단에 이름을 올렸습니다.`,
    choices: [
      ch('축하한다', `팬 만족도 +2, 7일 동안 그 선수 경기력 ${ed(0.02)}`, (c, v) => { c.addFans(2, '국가대표 예비 명단'); c.addForm(0.02, 7, '국가대표 발탁', { player: str(v, 'id') }); return '구단이 축하 현수막을 걸었습니다.'; }),
    ] },
  { id: 'x-coach-poached', title: '상대 구단의 코치 영입 시도', weight: 3,
    vars: amt(8000, 12000),
    text: () => '다른 구단이 우리 타격 코치를 데려가려 한다는 소식입니다.',
    choices: [
      ch('보낸다', `30일 동안 타자 경기력 ${ed(-0.005)}`, (c) => { c.addForm(-0.005, 30, '코치 이탈', { side: 'bat' }); return '코치가 떠났습니다.'; }),
      pay('대우를 올려 붙잡는다', 'cost', '영향 없음', () => '코치가 남기로 했습니다.', '코치 연봉 인상'),
    ] },
  { id: 'x-travel-allowance', title: '원정 수당 인상 요구', weight: 3,
    vars: amt(8000, 12000),
    text: () => '선수단 대표가 물가가 올랐다며 원정 수당을 올려 달라고 요청했습니다.',
    choices: [
      ch('다음 해에 논의하자고 한다', `7일 동안 팀 경기력 ${ed(-0.005)}`, (c) => { c.addForm(-0.005, 7, '수당 협상'); return '선수단이 다소 실망했습니다.'; }),
      pay('올려 준다', 'cost', `7일 동안 팀 경기력 ${ed(0.005)}`, (c) => { c.addForm(0.005, 7, '수당 인상'); return '선수단이 반겼습니다.'; }, '원정 수당 인상'),
    ] },
];
