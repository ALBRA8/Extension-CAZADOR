// Tests iter2 para `parsePrice` y `currencySymbolToCode` con countryHint y
// currencyHint — bug fixes confirmados por auditoría.
//
// Cubre los bugs:
// 4. `parsePrice(raw)` no aceptaba `countryHint` → `$` siempre se mapeaba a
//    USD por default (incluso en páginas colombianas/brasileñas).
// 5. `currencySymbolToCode(symbol, countryHint)` existía pero nadie la usaba
//    desde `parsePrice` cuando solo había `$`.
// 6. No había detección de país desde el HTML (ver tests/detect-country.test.ts).
//
// Implementación iter2:
// - `parsePrice(raw, countryHint?, currencyHint?)`:
//   1. Si `currencyHint` está seteado → se usa directamente (skip detection).
//   2. Si no, ISO 4217 explícito en el texto gana (ej. "COP" en "$ 129 COP").
//   3. Si no, símbolos multi-char (R$, US$, €, £, etc.) desde el mapa estático.
//   4. Si no, símbolo `$` solitario → `currencySymbolToCode('$', countryHint)`.
// - Backwards compatible: `parsePrice(raw)` (1 arg) sigue devolviendo 'USD'
//   para `$` sin contexto (default documentado como NO fiable).
//
// Ejecutar con: `npx vitest run tests/normalize-currency-iter2.test.ts`

import { describe, expect, it } from 'vitest'
import { parsePrice, currencySymbolToCode } from '../src/lib/normalize'

describe('parsePrice — iter2 currency detection (countryHint + currencyHint)', () => {
  // ─── ISO 4217 explícito en el texto gana sobre el símbolo `$` ────────
  it('parsea "$ 129.900 COP" → { amount: "129.900", currency: "COP" } (ISO gana)', () => {
    // Caso típico de tienda colombiana: $ + ISO COP explícito. El ISO
    // se detecta primero (prioridad 2) → currency='COP', y el $ se
    // strip en el amount.
    const result = parsePrice('$ 129.900 COP')
    expect(result).toEqual({ amount: '129.900', currency: 'COP' })
  })

  it('parsea "COP 129.900" → { amount: "129.900", currency: "COP" }', () => {
    // ISO al inicio, sin símbolo. Formato canónico de Schema.org Product.offers
    // cuando el extractor pasa el priceCurrency + price por separado.
    const result = parsePrice('COP 129.900')
    expect(result).toEqual({ amount: '129.900', currency: 'COP' })
  })

  it('parsea "$1,299.99 USD" → { amount: "1,299.99", currency: "USD" }', () => {
    // $ + ISO USD. ISO gana. El amount preserva el formato en-US (,=miles,
    // .=decimal) — parsePrice NO convierte.
    const result = parsePrice('$1,299.99 USD')
    expect(result).toEqual({ amount: '1,299.99', currency: 'USD' })
  })

  // ─── Símbolos multi-char desde el mapa estático ─────────────────────
  it('parsea "R$ 89,90" → { amount: "89,90", currency: "BRL" }', () => {
    // R$ es inequívoco → BRL. countryHint no se necesita.
    const result = parsePrice('R$ 89,90')
    expect(result).toEqual({ amount: '89,90', currency: 'BRL' })
  })

  it('parsea "1.299,99 €" → { amount: "1.299,99", currency: "EUR" }', () => {
    // € al final, formato es-ES. Símbolo multi-char desde el mapa.
    const result = parsePrice('1.299,99 €')
    expect(result).toEqual({ amount: '1.299,99', currency: 'EUR' })
  })

  // ─── `$` solitario sin contexto → USD (default NO fiable) ──────────
  it('parsea "$29.99" sin countryHint → { amount: "29.99", currency: "USD" } (default NO fiable)', () => {
    // Bug iter1: este caso era el único disponible → siempre USD. En iter2
    // sigue siendo el default cuando NO hay countryHint, pero está
    // documentado como no fiable. El caller debe pasar countryHint o
    // currencyHint cuando tenga contexto.
    const result = parsePrice('$29.99')
    expect(result).toEqual({ amount: '29.99', currency: 'USD' })
  })

  // ─── `$` solitario con countryHint → currency desambiguada ─────────
  it('parsea "$29.99", "CO" → { amount: "29.99", currency: "COP" }', () => {
    // Página colombiana (detectCountry=CO). El $ se desambigua a COP.
    const result = parsePrice('$29.99', 'CO')
    expect(result).toEqual({ amount: '29.99', currency: 'COP' })
  })

  it('parsea "$29.99", "BR" → { amount: "29.99", currency: "BRL" }', () => {
    // Página brasileña (detectCountry=BR). El $ se desambigua a BRL.
    const result = parsePrice('$29.99', 'BR')
    expect(result).toEqual({ amount: '29.99', currency: 'BRL' })
  })

  it('parsea "$29.99", "MX" → { amount: "29.99", currency: "MXN" }', () => {
    // Página mexicana (detectCountry=MX). El $ se desambigua a MXN.
    const result = parsePrice('$29.99', 'MX')
    expect(result).toEqual({ amount: '29.99', currency: 'MXN' })
  })

  // ─── currencyHint (3er param) → se usa directamente, skip detection ──
  it('parsea "$29.99", undefined, "USD" → { amount: "29.99", currency: "USD" } (currencyHint gana)', () => {
    // El caller (ej. extractor JSON-LD) ya sabe que la moneda es USD
    // (de Product.offers.priceCurrency del Schema.org). Lo pasa directo
    // como currencyHint y parsePrice no necesita adivinar.
    const result = parsePrice('$29.99', undefined, 'USD')
    expect(result).toEqual({ amount: '29.99', currency: 'USD' })
  })

  it('parsea "$29.99", "CO", "USD" → { amount: "29.99", currency: "USD" } (currencyHint gana sobre countryHint)', () => {
    // Conflict: countryHint sugiere COP, pero currencyHint dice USD.
    // currencyHint tiene prioridad (es el dato explícito del JSON-LD).
    // Caso real: tienda colombiana que vende en USD (ej. electronics).
    const result = parsePrice('$29.99', 'CO', 'USD')
    expect(result).toEqual({ amount: '29.99', currency: 'USD' })
  })

  // ─── ISO gana aunque el símbolo también esté presente ─────────────────
  it('parsea "R$ 89,90 BRL" → { amount: "89,90", currency: "BRL" } (ISO gana aunque símbolo sea BRL también)', () => {
    // Doble signal: R$ (símbolo) y BRL (ISO). El ISO se detecta primero
    // (prioridad 2) → currency='BRL', R$ se strip del amount.
    const result = parsePrice('R$ 89,90 BRL')
    expect(result).toEqual({ amount: '89,90', currency: 'BRL' })
  })
})

// ─── currencySymbolToCode (ya existía en iter1, ahora se usa en parsePrice) ─

describe('currencySymbolToCode — iter2 (consumido por parsePrice para `$`)', () => {
  it('currencySymbolToCode("$", "CO") → "COP"', () => {
    // Símbolo $ en contexto colombiano → COP.
    expect(currencySymbolToCode('$', 'CO')).toBe('COP')
  })

  it('currencySymbolToCode("$", "BR") → "BRL"', () => {
    // Símbolo $ en contexto brasileño → BRL (Brasil usa R$ también, pero
    // algunos sites usan $ solitario).
    expect(currencySymbolToCode('$', 'BR')).toBe('BRL')
  })

  it('currencySymbolToCode("$", undefined) → "USD" (default)', () => {
    // Símbolo $ sin contexto → USD (default, NO fiable — documentado).
    expect(currencySymbolToCode('$', undefined)).toBe('USD')
  })

  it('currencySymbolToCode("$", "MX") → "MXN"', () => {
    // Símbolo $ en contexto mexicano → MXN.
    expect(currencySymbolToCode('$', 'MX')).toBe('MXN')
  })
})
