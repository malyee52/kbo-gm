// Vertex AI (Google Cloud) 연결: 서비스 계정 JSON 파일로 접속 토큰을 받는다 (2026-10-12 사용자 요청).
// 브라우저에서 JWT(RS256)를 Web Crypto로 서명해 OAuth 토큰과 바꾼다. 토큰은 메모리에만 두고 한 시간 안쪽으로 다시 쓴다.
// 서비스 계정 JSON에는 비밀 키가 들어 있다: 이 브라우저(localStorage)에만 두고 저장 파일·재현 정보에는 넣지 않는다 (settings.ts).
// Gemini 모델은 publishers/google …:generateContent, Claude 모델(이름이 claude로 시작)은 publishers/anthropic …:rawPredict
// (본문에 anthropic_version 'vertex-2023-10-16', 출처: Anthropic "Claude on Vertex AI" 문서)

export interface ServiceAccount {
  type: string;
  project_id: string;
  private_key: string;
  client_email: string;
  token_uri?: string;
}

/** JSON 글을 서비스 계정으로 읽는다. 아니면 이유를 담은 오류 */
export function parseServiceAccount(text: string): ServiceAccount {
  let j: Partial<ServiceAccount>;
  try { j = JSON.parse(text) as Partial<ServiceAccount>; } catch { throw new Error('JSON 파일을 읽지 못했습니다.'); }
  if (j.type !== 'service_account') throw new Error('서비스 계정 키 파일이 아닙니다 ("type": "service_account"가 없음).');
  if (!j.project_id || !j.private_key || !j.client_email) throw new Error('project_id·private_key·client_email이 모두 있어야 합니다.');
  return j as ServiceAccount;
}

const b64url = (bytes: Uint8Array | string): string => {
  const bin = typeof bytes === 'string' ? unescape(encodeURIComponent(bytes)) : String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** 서명한 JWT (토큰 교환용) */
export async function signJwt(sa: ServiceAccount, nowSec: number, subtle: SubtleCrypto = crypto.subtle): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: sa.token_uri ?? 'https://oauth2.googleapis.com/token', iat: nowSec, exp: nowSec + 3600,
  };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const key = await subtle.importKey('pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input)));
  return `${input}.${b64url(sig)}`;
}

const tokens = new Map<string, { token: string; until: number }>();

/** 접속 토큰 (메모리에 50분 둔다) */
export async function accessToken(sa: ServiceAccount, f: typeof fetch = fetch): Promise<string> {
  const now = Date.now();
  const hit = tokens.get(sa.client_email);
  if (hit && hit.until > now) return hit.token;
  const jwt = await signJwt(sa, Math.floor(now / 1000));
  let res: Response;
  try {
    res = await f(sa.token_uri ?? 'https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`,
    });
  } catch (e) {
    throw new Error(`Google 인증 서버에 연결하지 못했습니다 (${(e as Error).message}). 브라우저가 막았을 수 있습니다.`);
  }
  const d = await res.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !d.access_token) throw new Error(`Google 인증 실패 (${res.status}): ${d.error_description ?? d.error ?? '알 수 없음'}. 서비스 계정 키와 권한(Vertex AI 사용자)을 확인하세요.`);
  tokens.set(sa.client_email, { token: d.access_token, until: now + Math.min(50 * 60, (d.expires_in ?? 3600) - 60) * 1000 });
  return d.access_token;
}

/** Vertex 요청 주소. region 'global'이면 지역 없는 주소 */
export function vertexUrl(sa: ServiceAccount, region: string, model: string): string {
  const loc = region.trim() || 'global';
  const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;
  const claude = /^claude/i.test(model);
  return `https://${host}/v1/projects/${encodeURIComponent(sa.project_id)}/locations/${encodeURIComponent(loc)}/publishers/${claude ? 'anthropic' : 'google'}/models/${encodeURIComponent(model)}:${claude ? 'rawPredict' : 'generateContent'}`;
}
