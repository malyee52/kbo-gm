// 환경 맞춤(calibrate) 디스크 캐시. 시험(tests/setup.ts)과 검증 도구가 끼운다. Node 전용.
//
// 맞춤은 예비 시즌을 여러 번 돌려서 비싸다 (2026 월드 pilotSeasons 1 = 예비 시즌 2개, 이 PC에서 약 10~20초).
// 결과는 월드·조정값·난수 시드·엔진 코드로 정해지므로, 그 넷을 모두 키에 넣고 저장한 값을 다시 쓴다.
// - 월드·조정값은 빠짐없이 글로 바꿔 해시한다 (Map·Set·형식 배열·undefined·NaN·-0도 구별, 함수가 있으면 캐시하지 않음).
// - 엔진 코드는 src/engine·src/data의 .ts 내용 해시. 엔진을 고치면 키가 모두 바뀐다.
// 끄기: KBO_CAL_CACHE=0. 위치: node_modules/.cache/kbo-cal (KBO_CAL_CACHE_DIR로 바꿈). 적중 기록: KBO_CAL_STATS=<파일>.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setCalibrationCache, type CalibrationCache } from '../src/engine';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CODE_DIRS = ['src/engine', 'src/data'];

class Uncacheable extends Error {}

/** 값 하나를 빠짐없이 글로 쓴다. 같은 글이면 엔진이 보기에 같은 값이어야 한다 */
export function canonical(x: unknown): string {
  const out: string[] = [];
  const seen = new Set<object>();
  const walk = (v: unknown): void => {
    switch (typeof v) {
      case 'number':
        out.push(Number.isNaN(v) ? 'NaN' : Object.is(v, -0) ? '-0' : String(v));
        return;
      case 'string':
        out.push(JSON.stringify(v));
        return;
      case 'boolean':
        out.push(v ? 'T' : 'F');
        return;
      case 'undefined':
        out.push('U');
        return;
      case 'bigint':
        out.push(`${v}n`);
        return;
      case 'function':
      case 'symbol':
        throw new Uncacheable(typeof v);
    }
    if (v === null) {
      out.push('N');
      return;
    }
    const o = v as object;
    if (seen.has(o)) throw new Uncacheable('cycle');
    seen.add(o);
    if (ArrayBuffer.isView(o)) {
      out.push(`${o.constructor.name}[`, Array.from(o as unknown as ArrayLike<number>).join(','), ']');
    } else if (Array.isArray(o)) {
      out.push('[');
      // 빈 칸(hole)과 undefined를 구별
      for (let i = 0; i < o.length; i++) {
        if (i) out.push(',');
        if (i in o) walk(o[i]);
        else out.push('H');
      }
      out.push(']');
    } else if (o instanceof Map) {
      out.push('M{');
      for (const [k, val] of o) { walk(k); out.push('=>'); walk(val); out.push(';'); }
      out.push('}');
    } else if (o instanceof Set) {
      out.push('S{');
      for (const val of o) { walk(val); out.push(';'); }
      out.push('}');
    } else {
      const proto = Object.getPrototypeOf(o);
      if (proto !== Object.prototype && proto !== null) throw new Uncacheable(`class ${proto?.constructor?.name}`);
      out.push('{');
      for (const k of Object.keys(o)) {
        // 투수 구종(World.arsenals, 엔진 2 20단계)은 A 해결기만 쓰고 맞춤(B)에 닿지 않는다
        if (k === 'arsenals') continue;
        out.push(JSON.stringify(k), ':'); walk((o as Record<string, unknown>)[k]); out.push(',');
      }
      out.push('}');
    }
    seen.delete(o);
  };
  walk(x);
  return out.join('');
}

function listTs(dir: string): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listTs(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  ).sort();
}

/** 엔진 코드 해시 (줄바꿈은 LF로 맞춰 CRLF 체크아웃에서도 같게) */
export function engineCodeHash(): string {
  const h = createHash('sha256');
  for (const f of CODE_DIRS.flatMap(listTs)) h.update(f.replace(/\\/g, '/')).update('\0').update(readFileSync(join(ROOT, f), 'utf-8').replace(/\r\n/g, '\n')).update('\0');
  return h.digest('hex');
}

export interface CalCacheStats { hits: number; misses: number; skipped: number }

/** 디스크 캐시를 만든다 (끼우지는 않는다) */
export function diskCalCache(dir = process.env.KBO_CAL_CACHE_DIR ?? join(ROOT, 'node_modules', '.cache', 'kbo-cal')): CalibrationCache & { stats: CalCacheStats } {
  const code = engineCodeHash();
  const stats: CalCacheStats = { hits: 0, misses: 0, skipped: 0 };
  const statsFile = process.env.KBO_CAL_STATS;
  const note = (kind: string): void => {
    if (statsFile) try { appendFileSync(statsFile, `${kind}\n`); } catch { /* 기록 실패는 무시 */ }
  };
  // get 다음에 바로 set이 오므로, get에서 낸 키를 set에서 다시 쓴다 (월드 글쓰기는 수십 ms)
  let last: { world: unknown; params: unknown; seed: string; key: string | null } | null = null;
  const keyOf = (world: unknown, params: unknown, seed: string): string | null => {
    if (last && last.world === world && last.params === params && last.seed === seed) return last.key;
    let key: string | null;
    try {
      key = createHash('sha256').update(code).update('\0').update(canonical(params)).update('\0').update(seed).update('\0').update(canonical(world)).digest('hex');
    } catch (e) {
      if (!(e instanceof Uncacheable)) throw e;
      key = null;
    }
    last = { world, params, seed, key };
    return key;
  };
  return {
    stats,
    get(world, params, seed) {
      const key = keyOf(world, params, seed);
      if (!key) { stats.skipped++; note('skip'); return undefined; }
      const file = join(dir, `${key}.json`);
      if (existsSync(file)) {
        try {
          const cal = JSON.parse(readFileSync(file, 'utf-8'));
          stats.hits++; note('hit');
          return cal;
        } catch { /* 깨진 파일은 다시 만든다 */ }
      }
      stats.misses++; note('miss');
      return undefined;
    },
    set(world, params, seed, cal) {
      const key = keyOf(world, params, seed);
      if (!key) return;
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${key}.json`);
      // 여러 작업자가 같은 키를 동시에 쓸 수 있어, 임시 파일에 쓰고 이름을 바꾼다
      const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      writeFileSync(tmp, JSON.stringify(cal));
      try { renameSync(tmp, file); } catch { /* 다른 작업자가 먼저 썼으면 그대로 둔다 */ }
    },
  };
}

/** KBO_CAL_CACHE=0이 아니면 디스크 캐시를 끼운다 */
export function installCalCache(): ReturnType<typeof diskCalCache> | undefined {
  if (process.env.KBO_CAL_CACHE === '0') return undefined;
  const c = diskCalCache();
  setCalibrationCache(c);
  return c;
}
