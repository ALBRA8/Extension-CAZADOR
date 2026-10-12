// Tests para `parsePrice` de `@/lib/normalize` con casos extraídos de los
// fixtures HTML de WAVE 1 (04-product-price-currency, 05-product-sale-price,
// 15-regional-price-format).
//
// Cubre:
// - Detección de moneda por símbolos multi-char (US$, R$) y single-char (€, $).
// - Símbolos al inicio y al final del texto.
// - Formatos regionales ambigüos (1.299,99 vs 1,299.99) — el amount se
//   preserva tal cual, NO se convierte.
// - Casos edge: null/undefined/empty/texto sin dígitos.
//
// Ejecutar con: `npx vitest run tests/normalize-price.test.ts`

import { describe, expect, it } from 'vitest'
import { parsePrice } from '../src/lib/normalize'

describe('parsePrice — casos extraídos de fixtures 04, 05, 15', () => {
  // ─── Fixture 04-product-price-currency.html ────────────────────────────
  // La página muestra el precio con "US$" al inicio (formato común en
  // tiendas que venden en USD desde Latam). El extractor debe detectar
  // moneda USD y dejar el amount "99.00" tal cual.
  it('parsea "US$ 230.00" → { amount: "230.00", currency: "USD" } (símbolo multi-char al inicio)', () => {
    const result = parsePrice('US$ 230.00')
    expect(result).toEqual({ amount: '230.00', currency: 'USD' })
  })

  it('parsea "$29.99" → { amount: "29.99", currency: "USD" } ($ solitario al inicio → USD por defecto)', () => {
    const result = parsePrice('$29.99')
    expect(result).toEqual({ amount: '29.99', currency: 'USD' })
  })

  // ─── Fixture 05-product-sale-price.html ───────────────────────────────
  // Precio anterior (529,00 €) y precio actual (399,00 €) con € al final.
  it('parsea "529,00 €" → { amount: "529,00", currency: "EUR" } (€ al final, formato es-ES)', () => {
    const result = parsePrice('529,00 €')
    expect(result).toEqual({ amount: '529,00', currency: 'EUR' })
  })

  it('parsea "399,00 €" → { amount: "399,00", currency: "EUR" }', () => {
    const result = parsePrice('399,00 €')
    expect(result).toEqual({ amount: '399,00', currency: 'EUR' })
  })

  // ─── Fixture 15-regional-price-format.html ────────────────────────────
  // El fixture muestra el mismo valor numérico (1299.99) en 3 formatos:
  //   1. "1.299,99 €"    (es-ES: punto=miles, coma=decimal)
  //   2. "1,299.99 US$"  (en-US: coma=miles, punto=decimal)
  //   3. "1299.99 €"     (compacto sin separador de miles)
  //
  // La política del extractor es NO convertir el amount: lo deja tal cual lo
  // vio el usuario. Solo separa la moneda.
  it('parsea "1.299,99 €" → { amount: "1.299,99", currency: "EUR" } (formato es-ES, € al final)', () => {
    const result = parsePrice('1.299,99 €')
    expect(result).toEqual({ amount: '1.299,99', currency: 'EUR' })
  })

  it('parsea "1,299.99 US$" → { amount: "1,299.99", currency: "USD" } (formato en-US, US$ al final)', () => {
    const result = parsePrice('1,299.99 US$')
    expect(result).toEqual({ amount: '1,299.99', currency: 'USD' })
  })

  it('parsea "1299.99 €" → { amount: "1299.99", currency: "EUR" } (formato compacto)', () => {
    const result = parsePrice('1299.99 €')
    expect(result).toEqual({ amount: '1299.99', currency: 'EUR' })
  })

  // ─── BRL/EUR canónicos (también útiles para fixture 02 y 03 que usan EUR) ─
  it('parsea "R$ 89,90" → { amount: "89,90", currency: "BRL" }', () => {
    const result = parsePrice('R$ 89,90')
    expect(result).toEqual({ amount: '89,90', currency: 'BRL' })
  })

  it('parsea "€19,95" → { amount: "19,95", currency: "EUR" } (€ al inicio sin espacio)', () => {
    const result = parsePrice('€19,95')
    expect(result).toEqual({ amount: '19,95', currency: 'EUR' })
  })

  // ─── Casos edge: entradas inválidas o sin precio ──────────────────────
  // El extractor debe tolerar valores nulos/vacíos/texto sin dígitos sin
  // lanzar excepción. Devuelve { amount: '', currency: undefined }.
  it('devuelve amount vacío para string vacío', () => {
    expect(parsePrice('')).toEqual({ amount: '', currency: undefined })
  })

  it('devuelve amount vacío para null (defensivo)', () => {
    // @ts-expect-error — la firma pide string pero el caller real puede pasar null
    expect(parsePrice(null)).toEqual({ amount: '', currency: undefined })
  })

  it('devuelve amount vacío para undefined (defensivo)', () => {
    // @ts-expect-error — la firma pide string pero el caller real puede pasar undefined
    expect(parsePrice(undefined)).toEqual({ amount: '', currency: undefined })
  })

  it('devuelve amount vacío para "Free" (palabra sin dígitos)', () => {
    expect(parsePrice('Free')).toEqual({ amount: '', currency: undefined })
  })

  it('devuelve amount vacío para "Contact for price" (texto sin dígitos)', () => {
    expect(parsePrice('Contact for price')).toEqual({ amount: '', currency: undefined })
  })
})
