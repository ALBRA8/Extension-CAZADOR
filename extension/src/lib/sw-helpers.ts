// Pure helpers for the background service worker.
//
// These functions are extracted from `src/background/service-worker.ts` so
// they can be unit-tested without mocking `chrome.runtime.onMessage` and the
// whole service-worker bootstrapping side effects. The service worker imports
// them and wires up the cache state at call-time.
//
// Convention: a helper belongs here when:
//  - It has no `chrome.*` side effects (no listeners, no storage access).
//  - It takes its inputs as plain arguments (no module-level mutable state).
//  - It is deterministic (same inputs → same outputs).
//
// `pickStructuredProducts` matches all three: it inspects a plain `caches`
// snapshot and returns the highest-priority `StructuredProduct[]` matching the
// URL, or `null` when no cache applies.

import type { StructuredProduct } from '@/types'
import type { HotmartProduct } from '@/lib/hotmart'
import type { JVZooProduct } from '@/lib/jvzoo'
import type { MuncheyeLaunch } from '@/lib/muncheye'
import { hotmartToStructured } from '@/lib/hotmart'
import { jvzooToStructured } from '@/lib/jvzoo'
import { muncheyeToStructured } from '@/lib/muncheye'

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Snapshot of the service worker's per-URL caches at a given instant.
 *
 * Each entry stores the URL the extraction was performed against plus the raw
 * platform-specific products. `pickStructuredProducts` walks these caches in
 * priority order (Hotmart → JVZoo → Muncheye → generic) and converts the
 * first matching one to canonical `StructuredProduct[]`.
 *
 * A `null` slot (or missing field) means "no cache for that source". The
 * generic slot stores canonical `StructuredProduct[]` directly (the WAVE 1
 * extractor already emits them in that shape), so no conversion is needed.
 */
export interface StructuredCacheSnapshot {
  hotmart?: { url: string; products: HotmartProduct[] } | null
  jvzoo?: { url: string; products: JVZooProduct[] } | null
  muncheye?: { url: string; launches: MuncheyeLaunch[] } | null
  generic?: { url: string; products: StructuredProduct[] } | null
}

// ─── URL / cache matching ─────────────────────────────────────────────────

/**
 * Returns the `StructuredProduct[]` cached for `url`, or `null` if no
 * specialized extraction is available.
 *
 * Priority (first match wins — specialised caches take precedence over the
 * generic WAVE 1 extractor's `structuredProducts` because they are 100%
 * accurate, while the generic extractor may have partial fields):
 *  1. `hotmart`   (Hotmart marketplace — `__NEXT_DATA__`)
 *  2. `jvzoo`     (jvzoomarket.com — `div.home-review-card`)
 *  3. `muncheye`  (muncheye.com — schema.org/Product metadata)
 *  4. `generic`   (generic WAVE 1 extractor's `structuredProducts`)
 *
 * Matching is **exact string equality** between the cache's `url` and the
 * requested URL. Known limitation: a URL with tracking params (e.g.
 * `?utm_source=newsletter`) does NOT match the same URL without them. This
 * is a minor bug — a future iter can normalise both sides via
 * `normalizeProductUrl` from `@/lib/normalize`. Until then, callers should
 * ensure they pass the same URL string they received from
 * `extractActiveTab()` (which uses `tab.url` verbatim) so cache hits line up.
 *
 * A cache slot with `products.length === 0` is treated as a miss (returns
 * `null` for that slot and falls through to the next priority). This is
 * deliberate: an empty cache means "extraction ran but produced nothing",
 * which is different from "no cache".
 *
 * @param url    The URL whose cached structured products we want (typically
 *               the active tab's URL).
 * @param caches  Snapshot of the four per-URL caches. Missing fields are
 *                treated as `null` (no cache for that source).
 * @returns `StructuredProduct[] | null`. The returned array is a fresh copy
 *          for the specialised sources (because `*ToStructured` maps each
 *          time), or the same reference as `caches.generic.products` for the
 *          generic source. Callers may freely mutate the result.
 */
export function pickStructuredProducts(
  url: string,
  caches: StructuredCacheSnapshot,
): StructuredProduct[] | null {
  if (!url) return null
  // Defensive: allow callers to pass an empty object.
  const c = caches || {}

  if (
    c.hotmart &&
    c.hotmart.url === url &&
    Array.isArray(c.hotmart.products) &&
    c.hotmart.products.length > 0
  ) {
    return hotmartToStructured(c.hotmart.products)
  }
  if (
    c.jvzoo &&
    c.jvzoo.url === url &&
    Array.isArray(c.jvzoo.products) &&
    c.jvzoo.products.length > 0
  ) {
    return jvzooToStructured(c.jvzoo.products)
  }
  if (
    c.muncheye &&
    c.muncheye.url === url &&
    Array.isArray(c.muncheye.launches) &&
    c.muncheye.launches.length > 0
  ) {
    return muncheyeToStructured(c.muncheye.launches)
  }
  if (
    c.generic &&
    c.generic.url === url &&
    Array.isArray(c.generic.products) &&
    c.generic.products.length > 0
  ) {
    return c.generic.products
  }
  return null
}
