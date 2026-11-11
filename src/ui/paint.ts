// 무거운 계산 전에 화면이 한 번 그려지게 기다린다 (2026-11-11 편의 P4 단기).
// setTimeout만으로는 브라우저가 그리기 전에 계산이 시작될 수 있어, 다음 그리기(requestAnimationFrame) 뒤로 미룬다.
// 창이 뒤에 있으면 requestAnimationFrame이 오지 않으므로 timeoutMs 뒤에는 그냥 넘어간다.
export function afterPaint(timeoutMs = 100): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const go = () => { if (!done) { done = true; resolve(); } };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(go, 0));
    setTimeout(go, timeoutMs);
  });
}
