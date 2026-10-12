// Tests mínimos para `parsePrice` de `@/lib/normalize`.
//
// Estos tests cubren los casos canónicos especificados en la tarea:
// - "$29.99"     → { amount: "29.99", currency: "USD" }
// - "R$ 89,90"   → { amount: "89,90", currency: "BRL" }
// - "€19,95"     → { amount: "19,95", currency: "EUR" }
// - "1.299,99 €" → { amount: "1.299,99", currency: "EUR" }
// - "1,299.99"   → { amount: "1,299.99", currency: undefined }
//
// Ejecutar con: `npx vitest run tests/normalize.test.ts`
// (el subagente de testing configurará el framework en wave 2).

import { describe, expect, it } from 'vitest'
import { parsePrice } from '../src/lib/normalize'

describe('parsePrice', () => {
  it('parsea $ USD con punto decimal', () => {
    const result = parsePrice('$29.99')
    expect(result).toEqual({ amount: '29.99', currency: 'USD' })
  })

  it('parsea R$ BRL con coma decimal', () => {
    const result = parsePrice('R$ 89,90')
    expect(result).toEqual({ amount: '89,90', currency: 'BRL' })
  })

  it('parsea € EUR con coma decimal al inicio', () => {
    const result = parsePrice('€19,95')
    expect(result).toEqual({ amount: '19,95', currency: 'EUR' })
  })

  it('parsea € EUR al final con separador de miles por punto', () => {
    const result = parsePrice('1.299,99 €')
    expect(result).toEqual({ amount: '1.299,99', currency: 'EUR' })
  })

  it('deja currency undefined cuando no hay símbolo (formato ambiguo)', () => {
    const result = parsePrice('1,299.99')
    expect(result).toEqual({ amount: '1,299.99', currency: undefined })
  })

  it('devuelve amount vacío para entrada vacía', () => {
    expect(parsePrice('')).toEqual({ amount: '', currency: undefined })
    expect(parsePrice('   ')).toEqual({ amount: '', currency: undefined })
    // @ts-expect-error toleramos null/undefined de forma defensiva
    expect(parsePrice(null)).toEqual({ amount: '', currency: undefined })
  })

  it('detecta código ISO 4217 explícito al inicio', () => {
    expect(parsePrice('USD 29.99')).toEqual({ amount: '29.99', currency: 'USD' })
    expect(parsePrice('COP 28.497')).toEqual({ amount: '28.497', currency: 'COP' })
  })

  it('no inventa currency para texto sin dígitos', () => {
    expect(parsePrice('gratis')).toEqual({ amount: '', currency: undefined })
  })
})
