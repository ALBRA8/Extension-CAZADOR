// Tests para `detectCountry(doc, url)` de `@/lib/normalize` — iter2.
//
// Cubre el bug 6: no había detección de país desde el HTML. Esto hacía que
// `parsePrice('$29.99')` siempre devolviera USD (default) incluso en
// páginas colombianas/brasileñas donde $ debería ser COP/BRL.
//
// Implementación iter2:
// - `detectCountry(doc, url)` consulta 4 signals en orden de prioridad:
//   1. `<html lang="es-CO">` → extrae el subtag del país ('CO').
//   2. `<meta name="region" content="MX">` → contenido directo (2 letras).
//   3. `<meta property="og:locale" content="es_CO">` → extrae subtag del país.
//   4. TLD de la URL: `.com.co` → CO, `.com.br` → BR, etc.
//   Devuelve `undefined` si ninguna signal matchea.
//
// El caller debe pasar el resultado a `parsePrice(raw, countryHint)`:
//   const country = detectCountry(doc, url)
//   const parsed = parsePrice(rawPriceText, country)
//
// Nota: el JSON-LD `Product.offers.priceCurrency` NO se extrae aquí — el
// extractor JSON-LD debe pasarlo directo como `currencyHint` a `parsePrice`
// (3er param), que tiene prioridad sobre `countryHint`.
//
// Ejecutar con: `npx vitest run tests/detect-country.test.ts`

import { describe, expect, it } from 'vitest'
import { detectCountry } from '../src/lib/normalize'

// Helper: parsea HTML string a Document usando DOMParser (jsdom-polyfilled
// en vitest config).
function doc(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

describe('detectCountry — iter2 país detection desde HTML/URL', () => {
  // ─── Signal 1: <html lang="es-CO"> ────────────────────────────────────
  it('Documento con <html lang="es-CO"> → "CO"', () => {
    const d = doc('<!DOCTYPE html><html lang="es-CO"><head></head><body></body></html>')
    expect(detectCountry(d, 'https://shop.com/product')).toBe('CO')
  })

  it('Documento con <html lang="pt-BR"> → "BR"', () => {
    const d = doc('<!DOCTYPE html><html lang="pt-BR"><head></head><body></body></html>')
    expect(detectCountry(d, 'https://shop.com/product')).toBe('BR')
  })

  it('Documento con <html lang="es-MX"> → "MX"', () => {
    const d = doc('<!DOCTYPE html><html lang="es-MX"><head></head><body></body></html>')
    expect(detectCountry(d, 'https://shop.com/product')).toBe('MX')
  })

  it('Documento con <html lang="es"> (sin país) → undefined (no signal)', () => {
    // lang="es" solo tiene idioma, no país → no se puede detectar.
    const d = doc('<!DOCTYPE html><html lang="es"><head></head><body></body></html>')
    expect(detectCountry(d, 'https://shop.com/product')).toBeUndefined()
  })

  // ─── Signal 2: <meta name="region" content="MX"> ──────────────────────
  it('Documento con <meta name="region" content="MX"> → "MX"', () => {
    const d = doc(`<!DOCTYPE html><html><head>
      <meta name="region" content="MX" />
    </head><body></body></html>`)
    expect(detectCountry(d, 'https://shop.com/product')).toBe('MX')
  })

  // ─── Signal 3: <meta property="og:locale" content="es_CO"> ───────────
  it('Documento con <meta property="og:locale" content="es_CO"> → "CO"', () => {
    const d = doc(`<!DOCTYPE html><html><head>
      <meta property="og:locale" content="es_CO" />
    </head><body></body></html>`)
    expect(detectCountry(d, 'https://shop.com/product')).toBe('CO')
  })

  it('Documento con <meta property="og:locale" content="pt_BR"> → "BR"', () => {
    const d = doc(`<!DOCTYPE html><html><head>
      <meta property="og:locale" content="pt_BR" />
    </head><body></body></html>`)
    expect(detectCountry(d, 'https://shop.com/product')).toBe('BR')
  })

  // ─── Signal 4: TLD de la URL ─────────────────────────────────────────
  it('URL https://shop.com.co/product → "CO"', () => {
    const d = doc('<!DOCTYPE html><html><head></head><body></body></html>')
    expect(detectCountry(d, 'https://shop.com.co/product')).toBe('CO')
  })

  it('URL https://shop.com.br/product → "BR"', () => {
    const d = doc('<!DOCTYPE html><html><head></head><body></body></html>')
    expect(detectCountry(d, 'https://shop.com.br/product')).toBe('BR')
  })

  it('URL https://shop.com.mx/product → "MX"', () => {
    const d = doc('<!DOCTYPE html><html><head></head><body></body></html>')
    expect(detectCountry(d, 'https://shop.com.mx/product')).toBe('MX')
  })

  it('URL https://shop.com.ar/product → "AR"', () => {
    const d = doc('<!DOCTYPE html><html><head></head><body></body></html>')
    expect(detectCountry(d, 'https://shop.com.ar/product')).toBe('AR')
  })

  it('URL https://shop.com.pe/product → "PE"', () => {
    const d = doc('<!DOCTYPE html><html><head></head><body></body></html>')
    expect(detectCountry(d, 'https://shop.com.pe/product')).toBe('PE')
  })

  it('URL https://shop.com.cl/product → "CL"', () => {
    const d = doc('<!DOCTYPE html><html><head></head><body></body></html>')
    expect(detectCountry(d, 'https://shop.com.cl/product')).toBe('CL')
  })

  it('URL https://shop.co.uk/product → "GB"', () => {
    // .co.uk → GB (no USD, aunque $ se mapearía a USD por default si el
    // caller no pasa countryHint; el extractor real usaría £ del HTML).
    const d = doc('<!DOCTYPE html><html><head></head><body></body></html>')
    expect(detectCountry(d, 'https://shop.co.uk/product')).toBe('GB')
  })

  // ─── Sin signals → undefined ─────────────────────────────────────────
  it('URL https://shop.com/product sin signals → undefined', () => {
    // .com es global (mayormente US pero no confiable) → no detectamos país.
    const d = doc('<!DOCTYPE html><html><head></head><body></body></html>')
    expect(detectCountry(d, 'https://shop.com/product')).toBeUndefined()
  })

  it('Documento sin html lang, sin meta, URL genérica → undefined', () => {
    // Ninguna signal: ni lang, ni meta, ni TLD específico de país.
    const d = doc('<!DOCTYPE html><html><head></head><body></body></html>')
    expect(detectCountry(d, 'https://example.org/page')).toBeUndefined()
  })

  // ─── Prioridad: html lang gana sobre meta y TLD ──────────────────────
  it('Prioridad: <html lang="es-CO"> gana sobre TLD .com.br', () => {
    // HTML explícito > TLD. La página es colombiana aunque esté en .com.br
    // (caso raro pero posible: dominio brasileño con contenido CO).
    const d = doc('<!DOCTYPE html><html lang="es-CO"><head></head><body></body></html>')
    expect(detectCountry(d, 'https://shop.com.br/product')).toBe('CO')
  })

  it('Prioridad: <meta name="region" content="MX"> gana sobre TLD .com.co', () => {
    // meta region es explícita, gana sobre TLD.
    const d = doc(`<!DOCTYPE html><html><head>
      <meta name="region" content="MX" />
    </head><body></body></html>`)
    expect(detectCountry(d, 'https://shop.com.co/product')).toBe('MX')
  })

  // ─── Casos edge ───────────────────────────────────────────────────────
  it('URL inválida → solo signals HTML (lang/meta) se consideran', () => {
    // URL no parseable por new URL() → cae al catch, sigue con signals HTML.
    const d = doc('<!DOCTYPE html><html lang="es-AR"><head></head><body></body></html>')
    expect(detectCountry(d, 'not-a-url')).toBe('AR')
  })

  it('URL vacía → solo signals HTML se consideran', () => {
    const d = doc('<!DOCTYPE html><html lang="pt-BR"><head></head><body></body></html>')
    expect(detectCountry(d, '')).toBe('BR')
  })

  it('Documento nulo → undefined (defensivo)', () => {
    // @ts-expect-error — caller real puede pasar null/undefined
    expect(detectCountry(null, 'https://shop.com.co')).toBeUndefined()
  })
})
