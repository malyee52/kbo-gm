// 시드 고정 난수. 같은 시드면 같은 수열이 나온다 (버그 재현과 테스트용).

function hashSeed(seed: string | number): number {
  const s = String(seed);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Rng {
  private a: number;
  readonly seed: string;

  constructor(seed: string | number) {
    this.seed = String(seed);
    this.a = hashSeed(seed) || 1;
  }

  /** [0, 1) 실수 (mulberry32) */
  next(): number {
    this.a = (this.a + 0x6d2b79f5) | 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [0, n) 정수 */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** [lo, hi) 실수 */
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** 현재 위치 (저장용). fromState에 넘기면 이 위치부터 같은 수열을 이어서 낸다 */
  state(): number {
    return this.a;
  }

  static fromState(seed: string | number, state: number): Rng {
    const r = new Rng(seed);
    r.a = state;
    return r;
  }

  /** 이 수열과 독립된 하위 수열. 같은 label이면 항상 같은 수열. */
  fork(label: string): Rng {
    return new Rng(`${this.seed}/${label}`);
  }
}
