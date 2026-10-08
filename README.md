# KBO 단장 게임

KBO 실제 선수와 구단으로 하는 단장(구단 운영) 시뮬레이션. 수익을 내지 않는 실험적 프로젝트다.

현재 상태: **M4 완료**. 2026년(또는 1982~2025년) 구단 하나를 골라 정규시즌 한 시즌을 치르고, AI 구단과 트레이드하고, 저장·이어하기를 할 수 있다.

## 실행

Node.js 22와 Python 3(openpyxl)가 필요하다.

```bash
npm install
npm run dev        # 게임 (http://localhost:5173), 엔진 시험 화면은 http://localhost:5173/?lab
npm test           # 자동 테스트
npm run typecheck  # 타입 검사
npm run build      # 배포용 빌드 (dist/)
```

## 데이터 다시 만들기

게임 데이터는 `data-src/KBO_단장게임_자료집.xlsx`에서 만든다. 엑셀을 고친 뒤 아래를 실행하면 `public/data/`가 갱신된다.

```bash
npm run data       # 엑셀 → JSON 변환 후 검사
```

## 엔진 검증

```bash
npm run validate -- --years 2025 --seasons 1000 --out reports/engine-validation-2025.md
npm run validate -- --years 2024,2019,2012 --seasons 200 --params '{"doublePlay":0.45}'
npm run validate -- --years 2024 --usage actual     # 선수별 출전 기간을 그 해 실제 출전량에 맞춤
python3 tools/fit_regression.py                      # 능력 산출의 회귀 상수 다시 맞추기
```

## 폴더

| 경로 | 내용 |
|---|---|
| `docs/design.md` | 기획서 v1.0 |
| `docs/engine.md` | 엔진 구조, 검증 결과, 알려진 한계 |
| `data-src/` | 원자료 엑셀 |
| `public/data/` | 게임 데이터 JSON (선수 마스터, 시즌별 기록, 규칙) |
| `src/data/` | 데이터 타입과 로더 |
| `src/engine/` | 경기 엔진. 화면과 브라우저에 의존하지 않는다 |
| `src/ai/` | AI 단장: 선수 가치, 구단 성향, 트레이드 판단 |
| `src/game/` | 게임 진행: 세션, 달력, 기록 계산, 브라우저 저장 |
| `src/ui/` | 게임 화면과 엔진 시험 화면 |
| `tools/` | 데이터 변환·검사, 엔진 검증, 회귀 상수 맞추기 |
| `tests/` | 자동 테스트 |
| `reports/` | 검증 결과 |

## 데이터 출처와 주의

- 기록은 KBO 공식 사이트를 수집한 공개 저장소와 보조 자료에서 가져왔다. 출처와 한계는 자료집 엑셀의 "안내", "출처", "데이터공백" 시트에 있다.
- 두 저장소 모두 라이선스 표시가 없다. 공개 범위를 넓히기 전에 권리 문제를 다시 검토한다 (M9).
- KBO 및 각 구단과 관련이 없는 팬 프로젝트다.
