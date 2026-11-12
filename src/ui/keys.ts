// 단축키 공통 판정 (U5 선수 넘기기·U7 단축키)

/** 글을 넣는 칸(입력·선택·글상자·편집 가능한 곳)에 초점이 있으면 단축키를 받지 않는다 */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (t as HTMLInputElement).type;
  return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes(type);
}

/** 단축키로 받을 만한 키 누름인가: 다른 곳이 이미 처리했거나, Ctrl·Alt·Meta를 같이 눌렀거나, 글을 넣는 중이면 아니다 */
export function shortcutOk(e: KeyboardEvent): boolean {
  return !e.defaultPrevented && !e.ctrlKey && !e.altKey && !e.metaKey && !e.isComposing && !isTypingTarget(e.target);
}

/** 지금 열린 모달 창(dialog showModal)이 있나. except는 빼고 본다 */
export function modalOpen(except?: Element | null): boolean {
  return [...document.querySelectorAll('dialog[open]')].some((d) => d !== except && d.matches(':modal'));
}

/** 단축키 표 (저장·설정 화면) */
export const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: 'N', what: '주 진행 단추 (다음 경기·이어서 지휘·오프시즌 단계 넘기기 등, 막혀 있으면 아무 일 없음)' },
  { keys: '/', what: '상태 줄 검색 칸으로' },
  { keys: '1 ~ 6', what: '대분류: 브리핑·전력·영입·시즌·경영·아카이브' },
  { keys: 'Esc', what: '열린 창 닫기 (선수 창·진행 설정·전체 메뉴)' },
  { keys: '← / →', what: '선수 창에서 이전·다음 선수 (표에서 연 경우, 그 표의 지금 순서)' },
];
