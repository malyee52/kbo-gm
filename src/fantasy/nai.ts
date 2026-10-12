// 판타지 모드 삽화: NovelAI 이미지 생성 (2026-10-12 사용자 요청 "nai를 이용해 삽화를 넣는 기능").
// 사용자 결정: 가상 인물·장면만 그리고 유니폼은 구단 색만 빌린다 (로고·엠블럼·글자 없음). 실존 선수는 그리지 않는다 (CLAUDE.md 초상 규칙).
// 그래서 그림 지시문(태그)에서 한글·선수 이름을 지우고, 금지 태그를 늘 붙인다 (sanitizeTags).
// API (2026-10 확인, 공개 문서 대신 커뮤니티 정리): POST https://image.novelai.net/ai/generate-image, Bearer 영구 토큰(pst-),
// 본문 input·model·action·parameters(v4_prompt·v4_negative_prompt 필수), 답은 image_0.png가 든 zip. 브라우저 호출 허용(CORS *) 확인.
// 그림은 게임 상태에 영향이 없어 조작 기록에 남기지 않고 이 브라우저(IndexedDB)에만 둔다 (images.ts).

export interface NaiSettings {
  token: string;
  model: string;
  /** AI 글이 생길 때마다 자동으로 그린다 */
  auto: boolean;
}

export const NAI_DEFAULT_MODEL = 'nai-diffusion-4-5-full';
export const NAI_MODEL_HINTS = ['nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated', 'nai-diffusion-5-full', 'nai-diffusion-5-curated'];

const KEY = 'kbo-fantasy-nai';

export function loadNaiSettings(): NaiSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<NaiSettings>;
      return { token: s.token ?? '', model: s.model || NAI_DEFAULT_MODEL, auto: s.auto ?? true };
    }
  } catch { /* 기본값 */ }
  return { token: '', model: NAI_DEFAULT_MODEL, auto: true };
}

export function saveNaiSettings(s: NaiSettings): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch { return false; }
}

/** 늘 붙이는 태그와 빼는 태그 */
export const NAI_BASE_TAGS = 'original characters only, anime illustration, baseball, korean professional baseball atmosphere, no text, no logo';
export const NAI_NEGATIVE = 'text, letters, logo, emblem, watermark, signature, team logo, jersey number, realistic, photorealistic, photo, real person, celebrity, lowres, bad anatomy, bad hands, worst quality, low quality';

/**
 * 그림 태그를 다듬는다: 영어·숫자·기본 기호만 남기고(한글 이름이 섞여 들어오지 않게), 이름 목록(실존 선수 등)과 겹치는 낱말을 지운다.
 * 로고·글자 쪽 태그는 뺀다. 결과는 쉼표로 이은 태그
 */
export function sanitizeTags(raw: string, banned: string[] = []): string {
  const ban = banned.map((b) => b.toLowerCase().trim()).filter((b) => b.length >= 2);
  return raw
    .replace(/[\n;]+/g, ',')
    .split(',')
    .map((t) => t.replace(/[^A-Za-z0-9 ()_:.'-]/g, '').replace(/\s+/g, ' ').trim())
    .filter((t) => t.length > 1 && t.length < 60)
    .filter((t) => !/\b(logo|emblem|text|letters|signature|watermark|real person|celebrity)\b/i.test(t))
    .filter((t) => !ban.some((b) => t.toLowerCase().includes(b)))
    .slice(0, 40)
    .join(', ');
}

/** 구단 색(#rrggbb) → 그림 태그용 색 이름 */
export function colorWord(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return 'navy';
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16));
  const named: [string, number, number, number][] = [
    ['black', 20, 20, 20], ['white', 240, 240, 240], ['red', 200, 30, 40], ['crimson', 150, 20, 40], ['orange', 240, 120, 20],
    ['yellow', 240, 200, 30], ['green', 30, 130, 60], ['navy blue', 20, 40, 100], ['blue', 30, 90, 200], ['sky blue', 100, 170, 230],
    ['purple', 100, 40, 140], ['gray', 128, 128, 128], ['brown', 120, 70, 30], ['gold', 200, 160, 60],
  ];
  let best = named[0];
  let d0 = Infinity;
  for (const c of named) {
    const d = (c[1] - r) ** 2 + (c[2] - g) ** 2 + (c[3] - b) ** 2;
    if (d < d0) { d0 = d; best = c; }
  }
  return best[0];
}

/** 같은 글이면 같은 시드 (다시 그려도 비슷하게) */
export function seedOf(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 4294967295;
}

export function naiBody(model: string, prompt: string, seed: number, size: { width: number; height: number }) {
  const caption = (base: string) => ({ caption: { base_caption: base, char_captions: [] as unknown[] }, use_coords: false, use_order: true });
  return {
    input: prompt, model, action: 'generate',
    parameters: {
      params_version: 3, width: size.width, height: size.height, scale: 5, sampler: 'k_euler_ancestral', steps: 28, n_samples: 1,
      ucPreset: 0, qualityToggle: true, sm: false, sm_dyn: false, dynamic_thresholding: false, controlnet_strength: 1, legacy: false,
      add_original_image: false, cfg_rescale: 0, noise_schedule: 'karras', legacy_v3_extend: false, uncond_scale: 1,
      seed, extra_noise_seed: seed, negative_prompt: NAI_NEGATIVE, prompt,
      reference_image_multiple: [], reference_information_extracted_multiple: [], reference_strength_multiple: [],
      v4_prompt: caption(prompt), v4_negative_prompt: caption(NAI_NEGATIVE),
    },
  };
}

/** zip 안 파일 하나: 이름, 압축 방식, 압축된 데이터 */
interface ZipEntry { name: string; method: number; data: Uint8Array }

/**
 * zip의 파일 목록. 중앙 디렉터리(파일 끝)에서 크기·위치를 읽는다: 스트리밍으로 만든 zip은 앞쪽 헤더의 크기가 0이고
 * 실제 크기가 뒤(데이터 설명자·중앙 디렉터리)에 있다 (2026-10-13: 앞쪽 헤더만 읽다 압축 풀기가 깨져 "Failed to fetch"로 보였다)
 */
export function zipEntries(buf: ArrayBuffer): ZipEntry[] {
  const v = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const dec = new TextDecoder();
  // 중앙 디렉터리 끝 기록 (끝에서 거꾸로 찾는다, 주석 최대 64KB)
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  const out: ZipEntry[] = [];
  if (eocd >= 0) {
    const count = v.getUint16(eocd + 10, true);
    let p = v.getUint32(eocd + 16, true);
    for (let k = 0; k < count && p + 46 <= bytes.length && v.getUint32(p, true) === 0x02014b50; k++) {
      const method = v.getUint16(p + 10, true);
      const csize = v.getUint32(p + 20, true);
      const nameLen = v.getUint16(p + 28, true);
      const extraLen = v.getUint16(p + 30, true);
      const commentLen = v.getUint16(p + 32, true);
      const local = v.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      if (local + 30 <= bytes.length && v.getUint32(local, true) === 0x04034b50) {
        const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
        out.push({ name, method, data: bytes.subarray(start, start + csize) });
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    if (out.length) return out;
  }
  // 중앙 디렉터리가 없으면 앞쪽 헤더로 (크기가 적힌 zip만)
  let p = 0;
  while (p + 30 <= bytes.length && v.getUint32(p, true) === 0x04034b50) {
    const method = v.getUint16(p + 8, true);
    const csize = v.getUint32(p + 18, true);
    const nameLen = v.getUint16(p + 26, true);
    const extra = v.getUint16(p + 28, true);
    const start = p + 30 + nameLen + extra;
    out.push({ name: dec.decode(bytes.subarray(p + 30, p + 30 + nameLen)), method, data: bytes.subarray(start, start + csize) });
    if (!csize) break;
    p = start + csize;
  }
  return out;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** zip에서 첫 PNG 파일을 꺼낸다 (저장·deflate 둘 다, PNG가 그대로 오면 그대로) */
export async function firstPngFromZip(buf: ArrayBuffer): Promise<Uint8Array> {
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return bytes;
  const entries = zipEntries(buf);
  const e = entries.find((x) => /\.png$/i.test(x.name)) ?? entries[0];
  if (!e || !e.data.length) throw new Error('NovelAI 답에서 그림을 찾지 못했습니다 (zip 형식을 읽지 못함).');
  if (e.method === 0) return e.data.slice();
  if (e.method === 8) {
    try { return await inflateRaw(e.data); } catch (err) { throw new Error(`NovelAI 그림의 압축을 풀지 못했습니다 (${(err as Error).message}).`); }
  }
  throw new Error(`zip 압축 방식 ${e.method}은 풀 수 없습니다.`);
}

/** 그림 한 장 (PNG 바이트) */
export async function generateImage(s: NaiSettings, prompt: string, seed: number,
  size = { width: 1216, height: 832 }, f: typeof fetch = fetch): Promise<Uint8Array> {
  if (!s.token.trim()) throw new Error('NovelAI 토큰이 없습니다. 판타지 → AI 설정 → 삽화(NovelAI)에서 넣으세요.');
  let res: Response;
  try {
    res = await f('https://image.novelai.net/ai/generate-image', {
      method: 'POST', headers: { authorization: `Bearer ${s.token.trim()}`, 'content-type': 'application/json' },
      body: JSON.stringify(naiBody(s.model || NAI_DEFAULT_MODEL, prompt, seed, size)),
    });
  } catch (e) {
    throw new Error(`NovelAI(image.novelai.net)에 연결하지 못했습니다 (${(e as Error).message}). 광고 차단·보안 확장 프로그램을 확인하고 잠시 뒤 다시 해 보세요 (그림 서버가 바쁠 때도 이렇게 보입니다).`);
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    const hint = res.status === 401 ? ' (토큰을 확인하세요)' : res.status === 402 ? ' (구독·Anlas가 모자랍니다)' : res.status === 429 ? ' (동시 요청 한도, 잠시 뒤에)' : '';
    throw new Error(`NovelAI 오류 ${res.status}${hint}: ${t.slice(0, 160)}`);
  }
  let buf: ArrayBuffer;
  try { buf = await res.arrayBuffer(); } catch (e) { throw new Error(`NovelAI 그림을 받는 중에 연결이 끊겼습니다 (${(e as Error).message}). 잠시 뒤 다시 해 보세요.`); }
  return firstPngFromZip(buf);
}
