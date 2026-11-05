// 조정값 덮어쓰기 (맞춤용 도구 공통): --set aging.pit=-3.5/-4.5/-6.5,aging.lateRate=0.15/0,aging.startGap.slope=0.3
// DEFAULT_PARAMS를 그 자리에서 바꾼다 (AI 가치 계산처럼 params를 받지 않는 곳도 같은 값을 보게)
import { DEFAULT_PARAMS } from '../src/engine';

export function applySets(spec: string): void {
  for (const kv of spec.split(',').filter(Boolean)) {
    const [path, v] = kv.split('=');
    const keys = path.split('.');
    let o = DEFAULT_PARAMS as unknown as Record<string, unknown>;
    for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
    o[keys[keys.length - 1]] = v.includes('/') ? v.split('/').map(Number) : Number(v);
  }
  if (spec) console.log(`조정값: ${spec}`);
}
