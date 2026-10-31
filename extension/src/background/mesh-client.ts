/**
 * CAZADOR → NEX-SCOPE mesh client
 * ===============================
 *
 * Reusable signing + delivery helper for the CAZADOR → NEX-SCOPE mesh
 * channel. Used by:
 *   - `src/background/context-menus.ts` (the 4 YouTube right-click menus)
 *   - The affiliate scraper (when the user clicks "Send to NEX-SCOPE"
 *     on a JVZoo / Hotmart / Muncheye results page)
 *   - The "Probar conexión" button in `NexscopeSettings.tsx`
 *
 * Signing convention (mirrors CHISMOSO's `deliverWebhook` + NEX-SCOPE's
 * `verifyCazadorSignature`):
 *   - Body: `JSON.stringify(payload)` (UTF-8).
 *   - Header: `X-Cazador-Signature: sha256=<hex-hmac>` where
 *     `<hex-hmac>` = `HMAC-SHA256(body, secret)`.
 *   - `Content-Type: application/json`.
 *   - `credentials: 'include'` so the httpOnly JWT cookie set when the
 *     user logged into NEX-SCOPE in the same browser profile is sent
 *     with the request. Without it the route returns 401.
 *
 * The secret + base URL are read from `chrome.storage.local` so the
 * user can configure them in the sidebar without rebuilding the
 * extension. Defaults:
 *   - NEXSCOPE_URL: `http://localhost:3000`
 *   - CAZADOR_WEBHOOK_SECRET: `` (empty — open mode; for dev only)
 *
 * Returns a discriminated union so callers can `if (!res.ok)` or read
 * `res.signalId` without optional chaining.
 */

/// <reference types="chrome" />

export interface MeshPayload {
  source: 'cazador';
  type: 'affiliate_offer' | 'channel_analysis' | 'niche_save' | 'ad_spy' | 'product_spy' | 'ping';
  data: Record<string, unknown>;
  metadata?: {
    url?: string;
    scrapedAt?: string;
    extractorUsed?: string;
    [k: string]: unknown;
  };
}

export interface MeshOk {
  ok: true;
  status: number;
  signalId?: string;
}

export interface MeshErr {
  ok: false;
  status?: number;
  error: string;
}

export type MeshResult = MeshOk | MeshErr;

const STORAGE_KEY_URL = 'NEXSCOPE_URL';
const STORAGE_KEY_SECRET = 'CAZADOR_WEBHOOK_SECRET';
const DEFAULT_NEXSCOPE_URL = 'http://localhost:3000';
const REQUEST_TIMEOUT_MS = 10_000;

interface NexscopeSettings {
  url: string;
  secret: string;
}

/**
 * Read NEXSCOPE_URL + CAZADOR_WEBHOOK_SECRET from chrome.storage.local.
 * Returns the defaults when unset so the user gets a clear "you need
 * to configure this" error instead of a silent failure.
 */
export async function readNexscopeSettings(): Promise<NexscopeSettings> {
  const entries = await chrome.storage.local.get([STORAGE_KEY_URL, STORAGE_KEY_SECRET]);
  return {
    url: (entries[STORAGE_KEY_URL] as string | undefined)?.replace(/\/+$/, '') || DEFAULT_NEXSCOPE_URL,
    secret: (entries[STORAGE_KEY_SECRET] as string | undefined) ?? '',
  };
}

/**
 * Persist NEXSCOPE_URL + CAZADOR_WEBHOOK_SECRET to chrome.storage.local.
 * Used by the settings panel. Triggers no automatic re-test — the
 * caller should invoke `sendToNexscope({ type: 'ping', ... })`
 * afterwards to verify.
 */
export async function writeNexscopeSettings(settings: Partial<NexscopeSettings>): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (settings.url !== undefined) patch[STORAGE_KEY_URL] = settings.url;
  if (settings.secret !== undefined) patch[STORAGE_KEY_SECRET] = settings.secret;
  if (Object.keys(patch).length === 0) return;
  await chrome.storage.local.set(patch);
}

/**
 * Compute `HMAC-SHA256(body, secret)` using the Web Crypto API and
 * return the hex digest. The Web Crypto API returns an ArrayBuffer,
 * so we convert it to hex by iterating 32 bytes (SHA-256 = 256 bits
 * = 32 bytes) and padding each byte to 2 hex chars.
 *
 * MV3 service workers don't have Node's `crypto` module — Web Crypto
 * is the only option. `crypto.subtle.sign` is async (returns a
 * Promise<ArrayBuffer>), so this function is async too.
 */
async function computeHmacSha256Hex(body: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  // ArrayBuffer → hex string
  const bytes = new Uint8Array(sig);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Send a signed mesh payload to NEX-SCOPE.
 *
 * Flow:
 *   1. Read NEXSCOPE_URL + secret from chrome.storage.local.
 *   2. JSON.stringify the payload (canonical form for signing).
 *   3. Compute HMAC-SHA256(body, secret). If the secret is empty,
 *      skip the header (NEX-SCOPE will accept the request in open
 *      mode and log a warning).
 *   4. POST to `${NEXSCOPE_URL}/api/mesh/external-signals` with
 *      `credentials: 'include'` (so the httpOnly JWT cookie is sent)
 *      and a 10s timeout via AbortController.
 *   5. Parse the JSON response. On 2xx, extract `signalId`. On
 *      non-2xx, surface the server's error message. On network error
 *      / timeout, return `{ ok: false, error }` with a human-readable
 *      cause.
 *
 * The function never throws — callers can `if (!res.ok)` without a
 * try/catch. The error string is safe to display in a Chrome
 * notification.
 */
export async function sendToNexscope(payload: MeshPayload): Promise<MeshResult> {
  const settings = await readNexscopeSettings();
  const base = settings.url.replace(/\/+$/, '');
  if (!base) {
    return { ok: false, error: 'NEXSCOPE_URL no configurado. Abrí el panel de ajustes del sidebar.' };
  }
  const url = `${base}/api/mesh/external-signals`;

  let body: string;
  try {
    body = JSON.stringify(payload);
  } catch (e) {
    return { ok: false, error: `No se pudo serializar el payload: ${(e as Error).message}` };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (settings.secret.length > 0) {
    try {
      const hex = await computeHmacSha256Hex(body, settings.secret);
      headers['X-Cazador-Signature'] = `sha256=${hex}`;
    } catch (e) {
      return { ok: false, error: `Firma HMAC falló: ${(e as Error).message}` };
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      credentials: 'include',
      signal: controller.signal,
    });
    // Parse JSON regardless of status — the server always returns a
    // JSON body, even for 401/400/500.
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* ignore — non-JSON body, fall through to error below */
    }
    if (res.status >= 200 && res.status < 300) {
      const signalId = (json as { signalId?: string } | null)?.signalId;
      return { ok: true, status: res.status, signalId };
    }
    // Error response — try to surface the server's `error` field.
    const errBody = json as { error?: string; details?: { reason?: string } } | null;
    const reason = errBody?.details?.reason;
    const errMsg = errBody?.error ?? `HTTP ${res.status}`;
    const full = reason ? `${errMsg} (${reason})` : errMsg;
    return { ok: false, status: res.status, error: full };
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      return { ok: false, error: `Timeout después de ${REQUEST_TIMEOUT_MS}ms` };
    }
    return { ok: false, error: `Red: ${(e as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Convenience: build a "ping" payload for the "Probar conexión" button.
 * The server persists it as an ExternalSignal of type `ping` (visible
 * in `GET /api/mesh/signals?type=ping`) so the user can confirm the
 * round-trip works end-to-end.
 */
export function buildPingPayload(): MeshPayload {
  return {
    source: 'cazador',
    type: 'ping',
    data: { hello: 'nexscope', timestamp: new Date().toISOString() },
    metadata: {
      url: 'cazador-extension://ping',
      scrapedAt: new Date().toISOString(),
      extractorUsed: 'manual-ping',
    },
  };
}
