# 자료 출처와 라이선스

이 저장소의 게임 자료(`public/data/`)와 가공 자료(`data-src/`)가 어디서 왔고 어떤 조건인지 자료별로 모은 안내다 (2026-10-24, M9 공개 검토 Q6).
게임 안 정보·출처 화면(`src/ui/screens/About.tsx`)이 같은 내용을 짧게 보여 준다. 코드의 라이선스는 아직 정하지 않았다.

이 게임은 KBO 및 각 구단과 관련 없는 비영리 팬 프로젝트다. 아래에 비영리(NC) 조건 자료가 있으므로 광고·결제·후원 링크를 넣지 않는다.

## 자료별 표

| 자료 | 라이선스·조건 | 쓰는 곳 (배포 파일) | 비고 |
|---|---|---|---|
| [PsyproLEE/KBO_statics](https://github.com/PsyproLEE/KBO_statics) (KBO 공식 사이트 koreabaseball.com 기록 수집본) | 표시 없음 (권리 미확인) | 선수·시즌 기록 바탕: `players.json`, `seasons/*.json`, `meta.json` | 2026 시즌은 2026-10-12판 (팀별 143~144경기). 자료집 엑셀 `data-src/KBO_단장게임_자료집.xlsx`의 "출처" 시트 |
| [jpark-spec/dot-707-kbo-draft](https://github.com/jpark-spec/dot-707-kbo-draft) (원출처 Kaggle KBO Player Dataset) | 표시 없음 (Kaggle 원본 라이선스 미확인) | 보조 자료 (자료집 엑셀), `contracts.json`(FA 계약, 금액 미검증) | |
| [baseballchart.kr](https://baseballchart.kr/draft) 신인 지명 1982~2027 (나무위키 드래프트·육성선수 문서 정리) | [CC BY-NC-SA 2.0 KR](https://creativecommons.org/licenses/by-nc-sa/2.0/kr/) | `drafts.json` | 이 자료에서 만든 `drafts.json`도 같은 조건. 원본 `data-src/baseballchart/` (`SOURCE.md`) |
| [위키데이터](https://www.wikidata.org) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/deed.ko) | `players.json`·`seasons/` 빈 칸 (생년·투타·세부 포지션), `military.json` | 우리 자료가 빈 칸만 채움. 문서 목록 `data-src/wiki/출처.csv` |
| [한국어 위키백과](https://ko.wikipedia.org) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.ko), 저작자는 각 문서 기여자 | 위와 같음, 제도 확인(`meta.json` rules, `rule_changes.json`, `data-src/제도연표_보정.csv`), 감독 목록(`managers.json`) | 사실 값만 뽑음 |
| [나무위키](https://namu.wiki) (2026-08-29 크롤링본, [archive.org namuwiki-data-dump-20260829](https://archive.org/details/namuwiki-data-dump-20260829)) | [CC BY-NC-SA 2.0 KR](https://creativecommons.org/licenses/by-nc-sa/2.0/kr/), 저작권은 각 문서 기여자 | 인적 사항·병역 빈 칸, 구장 제원(`parks.json`), 수상·올스타전(`awards.json`, `allstar_history.json`), 2026 외국인 개막 명단(`data-src/외국인_개막명단.csv`), 구종 목록(`pitches.json` 일부), 수비 평판(`defense.json` 등급·시기만), 제도 확인 | 나무위키에서 온 값은 같은 조건. 문서 제목은 각 CSV의 출처 열과 `data-src/wiki/출처.csv` |
| Hugging Face [slothman3878/kbo_playbyplay](https://huggingface.co/datasets/slothman3878/kbo_playbyplay) "KBO Play-by-Play 2023-2026 (v0)" | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (출처 표기 의무) | `ppa.json`(2023~), `plate.json`, `data-src/pbp_derived/` | 네이버 스포츠 문자중계에서 만든 구조화 자료. KBO·네이버와 무관한 비공식 자료. 표기 문구는 `data-src/pbp_derived/README.md` |
| 하드힛 [hardhit.ai](https://hardhit.ai) (사용자 유료 회원 CSV) | 비상업적 이용. 약관 9.4조가 자동 대량 수집을 금지 (수집하지 않음) | 2003년 이후 도루·도루실패·병살타 빈 값, 2015년 이후 구장 효과, 포지션·투구손, `ppa.json` 2015~2022 | **원본은 공개하지 않고 가공값만 쓴다.** 원본(`data-src/hardhit/`)과 선수별 가공 파일(`data-src/hardhit_derived/`)은 저장소에 넣지 않는다 |
| FM코리아 게시 "KBO 타자 기록 DB (1982-2024)" (구 스탯티즈 기록 기반) | 약관 미확인 | `src/engine/params.ts` `sbPctByYear` (1982~2002 리그 도루 성공률) | 원본은 올리지 않고 계산한 값만 |
| 스탯티즈 WAR 세 시즌 값 | 사실 값 3개 | `src/league/war.ts` 눈금 | |
| [visualbaseball.com](https://visualbaseball.com) 구종 자료 2016~2026 (사용자 수집) | 약관 미확인 | `pitches.json` (선수·시즌·구종별 구속·무브·사용률 등), `data-src/구종.csv` | 원본은 저장소 밖. `tools/build_pitches.py` |
| KBO 공식 사이트 수비 기록 2001~2026 (사용자 수집) | 약관 미확인 | `defense.json` (자리별 경기·수비 이닝·실책 등), `data-src/수비이닝.csv` | 원본은 저장소 밖. `tools/build_defense.py` |
| KBO 수비상 순위 (언론 보도) | 사실 값 | `defense_awards.json` (`data-src/수비상.csv`) | |
| 타구 유형·방향 리그 비율 2010~2026 | **출처 미확인 참고값** | `src/engine/params.ts` 땅볼 몫·타구 방향 (`data-src/batted_ball_derived/`) | 원 출처를 모른다 (`data-src/batted_ball_derived/README.md`) |
| 언론 보도 (서울신문, OSEN, 뉴시스 등) | 사실 값 | 제도·규칙 변경·공인구 (`meta.json` rules, `rule_changes.json`) | 줄마다 출처 열 |
| 언론 보도 (OSEN, 다음, 스포츠경향, 아이뉴스24) | 사실 값 | 다년 계약 연도별 연봉 (`contracts.json` yearly ← `data-src/계약_연도별.csv`, 2022 SSG 4명) | 줄마다 출처 열 |
| 연고지 좌표 | 임시값 (기억값) | `homes.json` (`data-src/연고지.csv`) | |
| 글꼴 [Pretendard](https://github.com/orioncactus/pretendard) (CDN) | SIL Open Font License 1.1 | 화면 | `index.html`에서 받음 |

## 섞인 파일

- `players.json`·`seasons/*.json`·`military.json`에는 위키데이터(CC0)·위키백과(CC BY-SA 4.0)·나무위키(CC BY-NC-SA 2.0 KR) 값이 빈 칸 채움으로 함께 들어간다. 두 동일조건 라이선스는 서로 맞지 않는다고 알려져 있고, 들어간 것이 생년·투타 같은 사실 값이라 저작물성이 약하다는 견해도 있다. 판단은 하지 않았다 (확인 필요).
- 쓰지 않는 것: 구단 로고·엠블럼·유니폼, 선수 사진·초상.
