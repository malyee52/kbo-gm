// 정보·출처 화면 (2026-10-13 사용자 선택 "정보·출처 화면", docs/release-1.0-gaps.md A-2).
// 자료 출처·라이선스, 이 게임의 규정 요약(바뀐 규정 포함), 추정값·AI 기능 안내. 시작 화면과 게임 안(구단 → 정보·출처)에서 같은 내용을 보여 준다.
import type { LeagueState } from '../../league/types';
import { changedRules, ruleDate, ruleOf } from '../../league/rules';
import { dollarText, foreignCap, minSalary, salaryCap, wonText } from '../../league/salary';
import { useGame } from '../context';

const A = ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>;

export function AboutContent({ league, year }: { league?: LeagueState; year?: number }) {
  const y = year ?? 2026;
  const cap = salaryCap(y, league);
  const tdl = ruleDate(league, 'tradeDeadline');
  const mdl = ruleDate(league, 'marketDeadline');
  const changed = changedRules(league);
  return (
    <div className="stack about">
      <section className="panel">
        <h2>이 게임</h2>
        <p>KBO 및 각 구단과 관련 없는 비영리 팬 프로젝트입니다. 구단 로고·엠블럼과 선수 사진은 쓰지 않습니다.</p>
        <p className="small muted">실제 선수 이름과 기록을 바탕으로 한 시뮬레이션이며, 게임 속 결과·능력치·성장은 실제와 다릅니다.</p>
      </section>

      <section className="panel">
        <h2>자료 출처</h2>
        <ul className="small">
          <li>
            선수·시즌 기록: <A href="https://github.com/PsyproLEE/KBO_statics">PsyproLEE/KBO_statics</A> (KBO 공식 사이트 koreabaseball.com 기록 수집, 2026-10-08 받음),
            보조 자료 <A href="https://github.com/jpark-spec/dot-707-kbo-draft">jpark-spec/dot-707-kbo-draft</A> (원출처: Kaggle KBO Player Dataset, KBO 공식 기록).
            두 저장소 모두 라이선스 표시가 없어 권리를 확인하지 못했습니다. 2026 시즌은 2026-10-12판(팀별 143~144경기)입니다.
          </li>
          <li>
            신인 지명 1982~2027: <A href="https://baseballchart.kr/draft">baseballchart.kr</A> (나무위키 「(연도) KBO 신인 드래프트」·「육성선수」 문서 정리).
            라이선스 <A href="https://creativecommons.org/licenses/by-nc-sa/2.0/kr/">CC BY-NC-SA 2.0 KR</A> (저작자표시-비영리-동일조건변경허락).
            이 자료로 만든 게임 자료(신인 지명 목록)도 같은 조건입니다. 게임 안에서 지명은 다시 하고 능력은 지명 순번으로 가늠한 추정값입니다.
          </li>
          <li>
            제도(FA 연한·등급, 외국인 상한·보유 한도, 아시아쿼터, 샐러리캡, 2차 드래프트 등): 위키백과(<A href="https://ko.wikipedia.org/wiki/KBO_리그">KBO 리그</A>,
            {' '}<A href="https://en.wikipedia.org/wiki/KBO_League">KBO League</A>)와 언론 보도(서울신문, OSEN, 뉴스서울, 뉴시스, 데일리안, 경향신문, 스포츠경향, 매일신문 등)로 확인한 값.
            확인하지 못한 값은 "임시값"으로 두었습니다.
          </li>
          <li>
            병역: 2026 선수 프로필 경력의 상무·경찰 복무와 국제대회 금메달 대표팀 명단(위키백과 메달리스트 표, 2026 아시안게임은 언론 보도).
            그 밖의 선수는 아래 위키 문서의 병역 칸(현역·사회복무 등)을 쓰고, 그것도 없으면 나이와 1군 기록 공백으로 짐작합니다.
          </li>
          <li>
            선수 인적 사항(생년·투타·세부 포지션·병역)과 시즌 기록의 빈 칸 일부: 선수 문서에서 사실 값만 뽑아 위 자료가 비어 있는 칸만 채웠습니다
            (기록이 다른 칸은 바꾸지 않았습니다).
            {' '}<A href="https://www.wikidata.org">위키데이터</A> (<A href="https://creativecommons.org/publicdomain/zero/1.0/deed.ko">CC0 1.0</A>),
            {' '}<A href="https://ko.wikipedia.org">한국어 위키백과</A> (<A href="https://creativecommons.org/licenses/by-sa/4.0/deed.ko">CC BY-SA 4.0</A>, 저작자는 각 문서의 기여자),
            {' '}<A href="https://namu.wiki">나무위키</A> (<A href="https://creativecommons.org/licenses/by-nc-sa/2.0/kr/">CC BY-NC-SA 2.0 KR</A>, 저작권은 각 문서 기여자에게 있음).
            나무위키는 2026년 8월 크롤링본(<A href="https://archive.org/details/namuwiki-data-dump-20260829">archive.org namuwiki-data-dump-20260829</A>)을 썼고,
            나무위키에서 온 값은 같은 CC BY-NC-SA 2.0 KR 조건입니다. 쓴 문서 제목·주소·판은 저장소의 data-src/wiki/출처.csv에 있습니다.
          </li>
          <li>
            구장 제원(펜스 거리·높이, 좌석, 잔디, 쓴 기간): 나무위키 구장 문서 (<A href="https://creativecommons.org/licenses/by-nc-sa/2.0/kr/">CC BY-NC-SA 2.0 KR</A>,
            저작권은 각 문서 기여자에게 있음, 위 2026년 8월 크롤링본). 문서 이름은 저장소의 data-src/구장.csv·구장_사용.csv 출처 열에 있습니다.
          </li>
          <li>
            수상(골든글러브·MVP·신인왕·한국시리즈 MVP·올스타전 MVP)과 올스타전 경기 기록: 나무위키 수상·올스타전 문서
            (<A href="https://creativecommons.org/licenses/by-nc-sa/2.0/kr/">CC BY-NC-SA 2.0 KR</A>, 저작권은 각 문서 기여자에게 있음, 위 2026년 8월 크롤링본).
            문서 이름은 저장소의 data-src/수상.csv·올스타.csv 출처 열에 있습니다.
          </li>
          <li>감독: 시즌별 개막 감독과 대행을 KBO 기록과 위키백과 감독 목록으로 정리한 표 (이름만 쓰고 성향은 중립값).</li>
          <li>
            투구 단위 리그 집계: slothman3878, <A href="https://huggingface.co/datasets/slothman3878/kbo_playbyplay">"KBO Play-by-Play 2023-2026 (v0)"</A> (Hugging Face,
            {' '}<A href="https://creativecommons.org/licenses/by/4.0/deed.ko">CC BY 4.0</A>)를 가공. KBO·네이버와 무관한 비공식 자료입니다 (네이버 스포츠 문자중계에서 만든 구조화 자료).
            볼카운트·투구 수·구원 운용 맞춤과 선수별 타석당 투구 수에 썼습니다.
          </li>
          <li>
            1982~2002 리그 도루 성공률: 구 스탯티즈 기록 기반, FM코리아 게시 자료 "KBO 타자 기록 DB (1982-2024)"에서 계산한 값만 씁니다 (원본은 올리지 않음).
            이용 조건은 아직 확인하지 못했습니다. WAR 눈금은 스탯티즈 WAR 세 시즌 값에 맞췄습니다.
          </li>
          <li>
            투수 구종(2016~2026 구속·무브·사용률 등): <A href="https://visualbaseball.com">visualbaseball.com</A> 구종 자료(사용자 수집)를 가공.
            구종 목록이 없는 투수는 위 위키 문서의 구종 서술(구종 이름·주무기·최고 구속)로 채웠습니다. 이용 조건은 아직 확인하지 못했습니다.
          </li>
          <li>
            수비 기록(2001~2026 자리별 경기·수비 이닝·실책 등): KBO 공식 사이트 수비 기록(사용자 수집)을 가공. 이용 조건은 아직 확인하지 못했습니다.
            수비 평판은 위 위키 문서 서술에서 등급·시기만 뽑았습니다.
          </li>
          <li>
            기록 일부: 하드힛(<A href="https://hardhit.ai">https://hardhit.ai</A>), 비상업적 이용. 원본은 공개하지 않고 가공값만 씁니다.
            2003년 이후 타자 도루·도루실패·병살타 빈 값, 2015년 이후 구단별 구장 효과(파크팩터·구장 구성 지수), 포지션·투구손, 2015~2022 선수별 타석당 투구 수를 만드는 데 썼습니다.
          </li>
          <li>타구 유형·방향 리그 비율(2010~2026): 출처 미확인 참고값입니다 (원 출처를 확인하지 못했습니다). 리그 연도별 비율만 엔진 목표값으로 씁니다.</li>
          <li>
            2026 외국인 개막 명단·아시아쿼터: 나무위키 「2026 KBO 리그」 계약표(<A href="https://creativecommons.org/licenses/by-nc-sa/2.0/kr/">CC BY-NC-SA 2.0 KR</A>, 위 크롤링본)의 개막 명단·국적.
            수비 능력과 잠재력은 기록에서 추정한 값입니다.
          </li>
        </ul>
        <p className="small muted">자료별 출처·라이선스·쓰는 곳은 저장소의 DATA_LICENSES.md에 모아 두었습니다.</p>
      </section>

      <section className="panel">
        <h2>이 게임의 규정 {league ? <span className="muted small">지금 게임 기준</span> : <span className="muted small">2026년 기준</span>}</h2>
        <ul className="small">
          <li>소속 선수 정원 {ruleOf(league, 'orgLimit')}명, 육성선수 {ruleOf(league, 'devLimit')}명({ruleOf(league, 'devMaxAge')}세 이하, 정원 밖). 1군 엔트리는 시대별 규정 인원</li>
          <li>최저 연봉 {wonText(minSalary(y, league))}. 외국인: 신규 계약 상한 {dollarText(foreignCap(league, 'foreignNewCap', y))}, 총액 상한 {dollarText(foreignCap(league, 'foreignTotalCap', y))}, 아시아쿼터 신규 상한 {dollarText(foreignCap(league, 'asiaNewCap', y))}. 시즌 중 교체 {ruleOf(league, 'foreignSwaps')}번. 외국인은 트레이드할 수 없습니다</li>
          <li>샐러리캡: {cap === null ? (ruleOf(league, 'capScale') <= 0 ? '폐지됨' : '없음 (2023년 도입)') : `${wonText(cap)} (외국인·신인을 뺀 연봉 상위 ${ruleOf(league, 'capTopN')}명). 넘으면 제재금, 연속으로 넘으면 1라운드 지명 순서가 밀립니다`}</li>
          <li>트레이드: {tdl.month}월 {tdl.date}일까지, 한쪽 {ruleOf(league, 'maxPerSide')}명·지명권 {ruleOf(league, 'maxPicksPerTrade')}장까지. 시즌 중 방출·영입은 {mdl.month}월 {mdl.date}일까지</li>
          <li>FA: 고졸 8시즌·대졸 7시즌(등급에 따라 보상), 오프시즌 외부 FA {ruleOf(league, 'maxFaSignings')}명까지. 비FA 다년 계약 최대 {ruleOf(league, 'extMaxYears')}년</li>
          <li>포스트시즌: 시대별 진출 팀 수와 시리즈 길이, 연장 {ruleOf(league, 'postseasonMaxInnings')}회까지</li>
          {changed.length > 0 && <li><strong>이 게임에서 바뀐 규정</strong>: {changed.map((c) => `${c.label} ${c.from ?? '실제'} → ${c.to ?? '실제'}`).join(' · ')}</li>}
        </ul>
      </section>

      <section className="panel">
        <h2>AI 기능 (판타지·자유 모드)</h2>
        <ul className="small">
          <li>본인의 AI API 키(Claude·OpenAI·Gemini·Vertex)와 NovelAI 토큰은 이 브라우저에만 저장되고, 각 제공자에게 직접 보냅니다. 저장 파일·내보내기·재현 정보에는 들어가지 않습니다.</li>
          <li>AI가 쓴 기사·대화·사건·판정은 지어낸 이야기입니다. 내용 검열은 AI 제공자 쪽 기준을 따릅니다.</li>
          <li>AI가 만든 결과는 이야기 기록으로 남아 저장·불러오기·재현 때 AI를 다시 부르지 않고 그대로 들어갑니다.</li>
        </ul>
      </section>
    </div>
  );
}

/** 게임 안 화면 (구단 → 정보·출처) */
export function About() {
  const { session: s } = useGame();
  return (
    <section className="stack">
      <h1>정보·출처</h1>
      <AboutContent league={s.league} year={s.phase === 'season' ? s.world.year : s.year + 1} />
    </section>
  );
}
