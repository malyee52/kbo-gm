# 판타지 모드 (AI 이야기) 설계

2026-10-12 사용자 요청: "ai api 키를 사용해 ai와 소통하며 유동적으로 진행하는 게임을 모드로".

## 0. 사용자 결정

| 질문 | 답 |
|---|---|
| 모드 성격 | **실제 리그 + AI 이야기**: 지금 KBO 리그·선수 그대로, AI가 대화·사건·기사를 즉석에서 만들어 시즌 흐름이 유동적으로 바뀐다 |
| AI 역할 | 사건 생성, 자유 대화, 기사·해설, **게임 수치에 영향**. 큰 변화도 가능 (예: 소설처럼 플레이어만 미래를 아는 회귀물) |
| 실존 선수 규칙 | **유지**: 실존 선수에게 지어낸 발언·사생활·물의를 붙이지 않는다 (CLAUDE.md "지켜야 할 규칙") |
| AI 제공자 | **여러 제공자 중 선택**: Claude(Anthropic), OpenAI, Gemini |

## 1. 지켜야 할 것

- **실존 선수**: AI에게 주는 지시문에 규칙을 넣고(발언 인용·인물평·사생활·부상 사유·물의 금지, 기록 사실만), AI가 고른 효과도 실존 선수에게는 중립 효과(컨디션 ±, 휴식)만 받는다. 대화 상대는 가상 인물(구단 직원·기자·에이전트·구단주 측근)과 게임이 만든 가상 선수뿐이다.
- **숨겨진 특수능력**: AI에게 주는 게임 상황(`context.ts`)에 넣지 않는다 (`tests/traits.test.ts`와 같은 원칙).
- **재현**: AI 답은 매번 달라 시드로 재현되지 않는다. 그래서 AI가 만든 글과 효과는 **조작 기록(`GameAction` 'ai')에 그대로 남기고**, 재현·불러오기 때는 AI를 다시 부르지 않고 기록된 효과를 적용한다. 버그 재현 정보(`reproInfo`)도 그대로 쓸 수 있다.
- **API 키**: 서버가 없는 게임이라 플레이어 본인 키로 브라우저에서 바로 부른다. 키는 그 브라우저(localStorage)에만 두고 **저장 파일·내보내기·재현 정보에는 넣지 않는다**. 화면에 "키는 이 브라우저에만 저장, 요금은 키 주인에게" 안내.
- **효과의 크기**: AI가 수치를 바꾸는 것은 정해 둔 효과 목록(화이트리스트)과 상한 안에서만 (`effects.ts`). AI가 목록 밖 효과나 상한 넘는 값을 내면 잘라 낸다.

## 2. 구조

| 파일 | 하는 일 |
|---|---|
| `src/fantasy/llm.ts` | 제공자 3종(Anthropic Messages, OpenAI Chat Completions, Gemini generateContent) 호출, 모델 목록, JSON 답 꺼내기. 시험용 가짜 제공자(`mock`) |
| `src/fantasy/settings.ts` | 제공자·모델·키 (브라우저 localStorage) |
| `src/fantasy/context.ts` | AI에게 줄 게임 상황 요약 (구단·순위·주요 선수 기록·최근 소식·재정, 회귀자 모드면 원래 역사) |
| `src/fantasy/prompts.ts` | 지시문 (실존 선수 규칙, 말투, JSON 형식) |
| `src/fantasy/effects.ts` | 효과 화이트리스트·상한·적용 (이벤트의 `EventContext` 도구를 다시 쓴다) |
| `src/fantasy/history.ts` | 회귀자 모드: 실제 자료의 "원래 역사"(시즌 순위·우승·주요 기록)와 게임 결과의 분기 |
| `league.fantasy` | 판타지 상태: 켜짐, 회귀자, 이야기 기록(글·효과), 인물 기억 요약 |
| `src/ui/screens/Fantasy.tsx` | 판타지 화면: 이야기(기사·사건), 대화, 기억 노트, AI 설정 |

## 3. 단계

1. **기반**: AI 설정(제공자·키·모델·연결 시험·모델 목록), 새 게임 옵션 "판타지 모드", 조작 기록 'ai', AI 기사(이번 주·시즌 정리, 글만)
2. **회귀자**: 새 게임 옵션 "회귀자 (미래를 안다)". 기억 노트(시작 뒤 실제 시즌의 순위·우승·주요 선수 기록, 자료가 있는 해까지), 역사 분기 표시("원래는 SK 우승"), AI가 회상·분기 서술
3. **자유 대화**: 가상 인물과 채팅 (단장 보좌, 수석 스카우트, 담당 기자, 에이전트, 구단주 측근). 대화 결과로 효과(신뢰·팬·컨디션 등) 제안 → 플레이어가 받아들이면 적용
4. **AI 사건**: 상황 맞춤 이벤트(글 + 선택지 + 선택지별 효과)를 AI가 만든다. 기존 무작위 이벤트와 같은 멈춤·답하기 흐름
5. **큰 변화**: 여러 주에 걸친 이야기 줄기(아크), 큰 효과 묶음 (구단주 교체·대형 투자·리그 개편 제안 등, 효과 목록 확장)

## 4. 제공자 메모 (2026-10-12)

- Anthropic: `POST https://api.anthropic.com/v1/messages`, 헤더 `x-api-key`, `anthropic-version: 2023-06-01`, 브라우저에서 부를 때 `anthropic-dangerous-direct-browser-access: true`. 기본 모델 `claude-sonnet-5-5`
- OpenAI: `POST https://api.openai.com/v1/chat/completions`, 헤더 `Authorization: Bearer`. 기본 `gpt-5.5` (OpenAI 변경 기록의 권장)
- Gemini: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, 헤더 `x-goog-api-key`. 기본 `gemini-3.6-flash` (공식 안내 예시, 확인 필요)
- 모델 이름은 자주 바뀌므로 설정에서 직접 고치거나 "모델 목록 불러오기"(각 제공자의 모델 목록 API)로 고른다
- Vertex AI (2026-10-12 사용자 요청): Google Cloud 서비스 계정 JSON 파일로 연결 (`src/fantasy/vertex.ts`). 브라우저에서 JWT(RS256)를 Web Crypto로 서명해 `oauth2.googleapis.com/token`에서 접속 토큰을 받는다(메모리에 50분).
  Gemini는 `publishers/google/models/{model}:generateContent`, 이름이 claude로 시작하는 모델은 `publishers/anthropic/models/{model}:rawPredict`(본문 `anthropic_version: vertex-2023-10-16`). 지역 기본 global (지역 없는 호스트 `aiplatform.googleapis.com`).
  JSON 안의 비밀 키가 브라우저에 저장된다: 권한을 "Vertex AI 사용자"로만 준 계정을 권한다. 브라우저에서 토큰 서버·Vertex 주소를 막지 않는지는 아직 실제 키로 확인하지 못했다
