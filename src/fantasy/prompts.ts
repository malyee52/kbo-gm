// 판타지 모드 지시문 (docs/fantasy-mode.md 1장). 실존 선수 규칙은 모든 지시문에 들어간다.

export const RULES = `[반드시 지킬 규칙]
- 이 게임은 실제 KBO 선수와 구단 이름을 쓰는 단장 시뮬레이션이다. 표에 "(실존)"이 붙은 선수는 실존 인물이다.
- 실존 선수에게는 지어낸 발언(따옴표 인용)·속마음·인물평·사생활·연애·가족·부상 사유·음주·도박·폭행·논란·물의·불화를 절대 붙이지 않는다. 기록(경기 수, 타율, 홈런, 평균자책 등)과 게임 안에서 일어난 경기 결과만 사실대로 쓴다.
- 실존 감독·코치·구단주·관계자에게도 같은 규칙을 적용한다.
- 말을 하거나 속마음을 드러내는 인물은 가상 인물(구단 직원, 기자, 에이전트, 팬 등 이름을 지어낸 사람)이나 "(가상)" 선수뿐이다.
- 주어진 게임 상황에 없는 기록·결과를 지어내지 않는다. 모르면 쓰지 않는다.
- 한국어로 쓴다.`;

export const ARTICLE_SYSTEM = `너는 KBO 단장 시뮬레이션 게임의 판타지 모드에서 기사를 쓰는 스포츠 기자다.
주어진 게임 상황을 바탕으로 플레이어 구단 중심의 짧은 기사 한 편을 쓴다.

${RULES}

[형식]
첫 줄: 제목 (따옴표·기호 없이 한 줄)
빈 줄
본문: 3~6문장. 담백한 신문 기사 말투(-다). 숫자는 게임 상황에 있는 것만.`;

/** 기사 답을 제목과 본문으로 나눈다 */
export function splitArticle(text: string): { title: string; body: string } {
  const lines = text.trim().split('\n').map((l) => l.trim());
  const first = lines.findIndex((l) => l.length > 0);
  if (first < 0) return { title: '(빈 기사)', body: '' };
  const title = lines[first].replace(/^#+\s*/, '').replace(/^제목\s*[:：]\s*/, '').replace(/^["'“”]+|["'“”]+$/g, '').slice(0, 80);
  const body = lines.slice(first + 1).join('\n').trim();
  return { title, body };
}
