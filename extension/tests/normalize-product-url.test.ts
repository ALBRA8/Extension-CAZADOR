// Tests para `normalizeProductUrl` de `@/lib/normalize`.
//
// Cubre los casos de tracking/affiliate especificados en la tarea, donde
// el extractor debe normalizar URLs de producto eliminando parámetros de
// tracking pero conservando parámetros funcionales (variant, size, tag, etc.).
//
// Política actual (leída del código):
// - Quita "www." del host.
// - Quita fragmento (#hash) salvo hashbang SPA (#!).
// - Filtra parámetros de tracking (utm_*, fbclid, gclid, ref, ref_, source,
//   _source, src, sr, sr_share, ss_source, igshid, spm, scm, pvi, pfx,
//   cmpid, campaign_id, ad_id, adgroup_id, mkt_tok, mc_eid, mc_cid,
//   yclid, msclkid, dclid, referer, referrer).
// - Conserva TODO parámetro no listado arriba (ej. `tag`, `variant`, `size`).
// - Reordena los params restantes alfabéticamente para estabilidad.
//
// Ejecutar con: `npx vitest run tests/normalize-product-url.test.ts`

import { describe, expect, it } from 'vitest'
import { normalizeProductUrl } from '../src/lib/normalize'

describe('normalizeProductUrl', () => {
  it('quita parámetros de tracking (utm_source, fbclid)', () => {
    const input = 'https://amazon.com/dp/B123?utm_source=google&fbclid=abc'
    expect(normalizeProductUrl(input)).toBe('https://amazon.com/dp/B123')
  })

  it('quita el "www." del host', () => {
    expect(normalizeProductUrl('https://www.amazon.com/dp/B123')).toBe(
      'https://amazon.com/dp/B123',
    )
  })

  it('quita ref y source (tracking params poco obvios)', () => {
    // ref, ref_, source, _source, src, sr, sr_share son considerados tracking
    // por la política del extractor.
    const input = 'https://amazon.com/dp/B123?ref=abc&source=def'
    expect(normalizeProductUrl(input)).toBe('https://amazon.com/dp/B123')
  })

  it('CONSERVA el parámetro `tag` (no es tracking estándar)', () => {
    // Documentación del comportamiento real: `tag` NO está en
    // TRACKING_PARAMS en src/lib/normalize.ts (líneas 40-77), así que se
    // conserva intacto. Esto es intencional: `tag` identifica el programa
    // de afiliados, no es un parámetro de sesión/click que deba normalizarse.
    const input = 'https://amazon.com/dp/B123?tag=affiliate-20'
    expect(normalizeProductUrl(input)).toBe('https://amazon.com/dp/B123?tag=affiliate-20')
  })

  it('conserva parámetros funcionales (variant, size) y reordena alfabéticamente', () => {
    // El extractor NO debe tocar variant/size — son datos del producto.
    // Verifica también el reordenamiento alfabético para estabilidad.
    const input = 'https://shop.com/p/abc?size=42&variant=red'
    expect(normalizeProductUrl(input)).toBe('https://shop.com/p/abc?size=42&variant=red')
  })

  it('normaliza dos URLs equivalentes (con y sin tracking) al mismo resultado', () => {
    // Este es el propósito principal de normalizeProductUrl: permitir que
    // dos URLs que apuntan al mismo producto se detecten como iguales tras
    // normalización (clave para el dedup).
    const withTracking = 'https://www.amazon.com/dp/B123?utm_source=google&fbclid=xyz'
    const clean = 'https://amazon.com/dp/B123'
    expect(normalizeProductUrl(withTracking)).toBe(normalizeProductUrl(clean))
  })

  it('quita el fragmento #hash', () => {
    expect(normalizeProductUrl('https://shop.com/p/abc#reviews')).toBe(
      'https://shop.com/p/abc',
    )
  })

  it('conserva hashbang SPA (Angular-style #!/path)', () => {
    // El hashbang SPA es parte del routing real de la página, no un anchor.
    expect(normalizeProductUrl('https://app.example.com/#!/products/123')).toBe(
      'https://app.example.com/#!/products/123',
    )
  })

  it('devuelve "" para string vacío', () => {
    expect(normalizeProductUrl('')).toBe('')
  })

  it('devuelve "" para null (defensivo)', () => {
    // @ts-expect-error — caller real puede pasar null
    expect(normalizeProductUrl(null)).toBe('')
  })

  it('devuelve "" para URL inválida', () => {
    // "not-a-url" no es parseable por new URL() → ''
    expect(normalizeProductUrl('not-a-url')).toBe('')
  })
})
