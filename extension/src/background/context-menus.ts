/**
 * CAZADOR — YouTube context menus → NEX-SCOPE
 * ==========================================
 *
 * Registers 4 right-click context menus on YouTube channel/video links.
 * Each menu sends a signed mesh signal to NEX-SCOPE via
 * `sendToNexscope()` (see `mesh-client.ts`).
 *
 *   🎯 Analizar canal con NEX-SCOPE     → type: 'channel_analysis'
 *   📌 Guardar nicho en NEX-SCOPE       → type: 'niche_save'
 *   🎬 Enviar a Fábrica de Videos        → type: 'product_spy' (video idea)
 *   👁️ Espiar anuncios del canal        → type: 'ad_spy'
 *
 * All 4 menus target `context: 'link'` with `targetUrlPatterns` covering
 * YouTube channel URLs (`/@handle`, `/channel/UC...`, `/c/Custom`) and,
 * for the video menu, video URLs (`/watch?v=...`).
 *
 * On click:
 *   1. Extract the channel handle / video ID from `info.linkUrl`.
 *   2. Build a MeshPayload with the right `type`.
 *   3. `sendToNexscope(payload)` — signs with HMAC + sends the JWT
 *      cookie via `credentials: 'include'`.
 *   4. Show a Chrome notification (success or error) so the user
 *      gets immediate feedback even if the sidebar is closed.
 *
 * Notifications use a stable `notificationId` per menu id so multiple
 * clicks replace the previous toast instead of stacking.
 */

/// <reference types="chrome" />

import { sendToNexscope, type MeshPayload } from './mesh-client';

// ---------------------------------------------------------------------------
// Menu IDs — must be stable across service-worker restarts (Chrome matches
// `onClicked` callbacks by `menuItemId`, so re-registering with the same id
// on every `onInstalled` is the documented pattern).
// ---------------------------------------------------------------------------
const MENU_ANALYZE_CHANNEL = 'cazador-yt-analyze-channel';
const MENU_SAVE_NICHE = 'cazador-yt-save-niche';
const MENU_SEND_TO_VIDEO_FACTORY = 'cazador-yt-video-factory';
const MENU_SPY_ADS = 'cazador-yt-spy-ads';

// URL patterns — `*://*.youtube.com/@*` covers custom handles,
// `/channel/*` covers the canonical UC... URLs, `/c/*` covers legacy
// custom URLs. The video menu additionally matches `/watch?v=*`.
const CHANNEL_PATTERNS = [
  '*://*.youtube.com/@*',
  '*://*.youtube.com/channel/*',
  '*://*.youtube.com/c/*',
  '*://*.youtube.com/user/*',
  '*://www.youtube.com/@*',
  '*://www.youtube.com/channel/*',
  '*://www.youtube.com/c/*',
  '*://www.youtube.com/user/*',
];

const VIDEO_PATTERNS = [
  '*://*.youtube.com/watch?v=*',
  '*://*.youtube.com/shorts/*',
  '*://www.youtube.com/watch?v=*',
  '*://www.youtube.com/shorts/*',
];

/**
 * Register the 4 context menus. Idempotent — Chrome dedupes by id, so
 * calling this on every `chrome.runtime.onInstalled` (including
 * updates) is safe. We also call it on service-worker startup as a
 * belt-and-braces measure (Chrome sometimes drops menus if the
 * service worker is evicted for too long).
 */
export function registerContextMenus(): void {
  // Wipe existing menus first so re-install / update doesn't leave
  // stale entries with outdated patterns.
  try {
    chrome.contextMenus.removeAll(() => {
      // `removeAll` is async but Chrome fires the callback even on
      // first install (when there's nothing to remove).
      chrome.contextMenus.create({
        id: MENU_ANALYZE_CHANNEL,
        title: '🎯 Analizar canal con NEX-SCOPE',
        contexts: ['link'],
        targetUrlPatterns: CHANNEL_PATTERNS,
      });
      chrome.contextMenus.create({
        id: MENU_SAVE_NICHE,
        title: '📌 Guardar nicho en NEX-SCOPE',
        contexts: ['link'],
        targetUrlPatterns: CHANNEL_PATTERNS,
      });
      chrome.contextMenus.create({
        id: MENU_SEND_TO_VIDEO_FACTORY,
        title: '🎬 Enviar a Fábrica de Videos',
        contexts: ['link'],
        targetUrlPatterns: [...CHANNEL_PATTERNS, ...VIDEO_PATTERNS],
      });
      chrome.contextMenus.create({
        id: MENU_SPY_ADS,
        title: '👁️ Espiar anuncios del canal',
        contexts: ['link'],
        targetUrlPatterns: CHANNEL_PATTERNS,
      });
    });
  } catch (e) {
    console.error('[cazador] registerContextMenus failed', e);
  }
}

// ---------------------------------------------------------------------------
// URL → channel / video extraction
// ---------------------------------------------------------------------------

interface YtExtraction {
  url: string;
  channelHandle: string | null;
  videoId: string | null;
}

/**
 * Parse a YouTube URL into its channel handle (e.g. `@mkneco`) and / or
 * video id (e.g. `dQw4w9WgXcQ`). Both are null when the URL doesn't
 * match any known shape — the signal is still sent (the URL alone is
 * useful for the receiver to re-scrape), but `data` won't carry the
 * structured fields.
 *
 * Examples handled:
 *   https://www.youtube.com/@mkneco            → handle=@mkneco
 *   https://www.youtube.com/channel/UCxxxx      → handle=channel:UCxxxx
 *   https://www.youtube.com/c/CustomName        → handle=custom:CustomName
 *   https://www.youtube.com/watch?v=dQw4w9WgXcQ→ videoId=dQw4w9WgXcQ
 *   https://www.youtube.com/shorts/abc123       → videoId=abc123
 */
function extractYoutube(url: string): YtExtraction {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { url, channelHandle: null, videoId: null };
  }
  const path = u.pathname;
  // Handle: /@something
  const handleMatch = path.match(/^\/(@[^/]+)/);
  if (handleMatch) {
    return { url, channelHandle: handleMatch[1], videoId: null };
  }
  // Canonical channel id: /channel/UCxxxx
  const channelMatch = path.match(/^\/channel\/([^/]+)/);
  if (channelMatch) {
    return { url, channelHandle: `channel:${channelMatch[1]}`, videoId: null };
  }
  // Legacy custom URL: /c/CustomName
  const cMatch = path.match(/^\/c\/([^/]+)/);
  if (cMatch) {
    return { url, channelHandle: `custom:${cMatch[1]}`, videoId: null };
  }
  // Legacy user URL: /user/Name
  const userMatch = path.match(/^\/user\/([^/]+)/);
  if (userMatch) {
    return { url, channelHandle: `user:${userMatch[1]}`, videoId: null };
  }
  // Watch URL: /watch?v=ID
  const watchId = u.searchParams.get('v');
  if (watchId) {
    return { url, channelHandle: null, videoId: watchId };
  }
  // Shorts: /shorts/ID
  const shortsMatch = path.match(/^\/shorts\/([^/]+)/);
  if (shortsMatch) {
    return { url, channelHandle: null, videoId: shortsMatch[1] };
  }
  return { url, channelHandle: null, videoId: null };
}

// ---------------------------------------------------------------------------
// Notification helper
// ---------------------------------------------------------------------------

function notify(menuId: string, ok: boolean, message: string): void {
  try {
    chrome.notifications.create(`cazador-${menuId}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: ok ? 'CAZADOR → NEX-SCOPE' : 'CAZADOR — error',
      message: ok ? `✅ ${message}` : `❌ ${message}`,
      priority: 2,
    });
  } catch (e) {
    // Notifications permission may be missing — log to the SW console.
    console.warn('[cazador] notify failed', e);
  }
}

// ---------------------------------------------------------------------------
// Click handler — wires each menu id to its payload type + sends it.
// ---------------------------------------------------------------------------

export async function handleContextMenuItemClick(
  info: chrome.contextMenus.OnClickData,
  _tab: chrome.tabs.Tab | undefined,
): Promise<void> {
  const url = info.linkUrl;
  if (!url) {
    notify(String(info.menuItemId), false, 'No se encontró URL en el enlace.');
    return;
  }
  const extracted = extractYoutube(url);

  let type: MeshPayload['type'];
  let humanLabel: string;
  switch (info.menuItemId) {
    case MENU_ANALYZE_CHANNEL:
      type = 'channel_analysis';
      humanLabel = 'Análisis de canal';
      break;
    case MENU_SAVE_NICHE:
      type = 'niche_save';
      humanLabel = 'Nicho guardado';
      break;
    case MENU_SEND_TO_VIDEO_FACTORY:
      type = 'product_spy';
      humanLabel = 'Idea para Fábrica de Videos';
      break;
    case MENU_SPY_ADS:
      type = 'ad_spy';
      humanLabel = 'Espionaje de anuncios';
      break;
    default:
      // Not our menu — ignore (other extensions / handlers).
      return;
  }

  const payload: MeshPayload = {
    source: 'cazador',
    type,
    data: {
      url: extracted.url,
      channelHandle: extracted.channelHandle,
      videoId: extracted.videoId,
    },
    metadata: {
      url: extracted.url,
      scrapedAt: new Date().toISOString(),
      extractorUsed: 'youtube-context-menu',
    },
  };

  const result = await sendToNexscope(payload);
  if (result.ok) {
    notify(
      String(info.menuItemId),
      true,
      `${humanLabel} enviado a NEX-SCOPE${result.signalId ? ` (${result.signalId.slice(0, 8)})` : ''}.`,
    );
  } else {
    notify(
      String(info.menuItemId),
      false,
      `${humanLabel}: ${result.error}`,
    );
  }
}
