// 되돌릴 수 없는 조작(저장 지우기 등)을 두 번 눌러야 하게 하는 버튼. 브라우저 확인 창 대신 버튼 글자가 바뀐다 (3초 뒤 원래대로)
import { useEffect, useState } from 'react';

export function ConfirmButton({ label, confirmLabel, onConfirm, className = 'ghost danger', disabled }: {
  label: string; confirmLabel: string; onConfirm: () => void; className?: string; disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button type="button" className={className} disabled={disabled}
      onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}>
      {armed ? confirmLabel : label}
    </button>
  );
}
