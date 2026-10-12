// Tests para `resolveUrl` de `@/lib/normalize`.
//
// Cubre los casos del fixture `08-relative-url.html` (URLs relativas contra
// `<base>`) más casos canónicos de URL absoluta, protocol-relative y data:
// URIs.
//
// La política del extractor es:
// - Resolver siempre contra el baseUrl cuando la URL no es absoluta.
// - Devolver '' si la entrada es null/undefined/empty.
// - Pasar data: URIs sin modificar (no se resuelven contra base).
//
// Ejecutar con: `npx vitest run tests/normalize-url.test.ts`

import { describe, expect, it } from 'vitest'
import { resolveUrl } from '../src/lib/normalize'

describe('resolveUrl', () => {
  it('resuelve URL relativa simple contra base con path', () => {
    // "image.jpg" contra "https://shop.com/products/123"
    // El path "123" no es un directorio → la imagen se resuelve como hermana.
    expect(resolveUrl('image.jpg', 'https://shop.com/products/123')).toBe(
      'https://shop.com/products/image.jpg',
    )
  })

  it('resuelve "../../img/p.png" contra base con directorio (sube 2 niveles)', () => {
    // Base path "/products/123/" (con trailing slash) → "123" es un directorio.
    // "../../" sube 2 niveles: /products/123/ → /products/ → /
    // Append "img/p.png" → /img/p.png
    // Nota: "../img/p.png" (1 solo nivel) → /products/img/p.png (no sube a root).
    expect(resolveUrl('../../img/p.png', 'https://shop.com/products/123/')).toBe(
      'https://shop.com/img/p.png',
    )
  })

  it('resuelve "../../img/x.png" (sube 2 niveles) contra base con directorio', () => {
    // De "https://shop.com/a/b/c/" → "/a/" → "/img/x.png"
    expect(resolveUrl('../../img/x.png', 'https://shop.com/a/b/c/')).toBe(
      'https://shop.com/a/img/x.png',
    )
  })

  it('resuelve "./producto" (relativa con punto) contra base con directorio', () => {
    // "./batidora" contra "https://shop.com/cat/" → "https://shop.com/cat/batidora"
    expect(resolveUrl('./batidora', 'https://shop.com/cat/')).toBe(
      'https://shop.com/cat/batidora',
    )
  })

  it('resuelve URL protocol-relative "//cdn.com/img.png" contra https base', () => {
    // "//cdn.com/img.png" → hereda el protocolo del base (https)
    expect(resolveUrl('//cdn.com/img.png', 'https://shop.com')).toBe(
      'https://cdn.com/img.png',
    )
  })

  it('devuelve la URL absoluta tal cual cuando ya es absoluta', () => {
    expect(resolveUrl('https://abs.com/img.png', 'https://shop.com')).toBe(
      'https://abs.com/img.png',
    )
  })

  it('devuelve "" para string vacío', () => {
    expect(resolveUrl('', 'https://shop.com')).toBe('')
  })

  it('devuelve "" para null (defensivo)', () => {
    // @ts-expect-error — caller real puede pasar null
    expect(resolveUrl(null, 'https://shop.com')).toBe('')
  })

  it('devuelve "" para undefined (defensivo)', () => {
    // @ts-expect-error — caller real puede pasar undefined
    expect(resolveUrl(undefined, 'https://shop.com')).toBe('')
  })

  it('devuelve "" para entrada con solo espacios', () => {
    expect(resolveUrl('   ', 'https://shop.com')).toBe('')
  })

  it('pasa data: URIs sin modificar (no se resuelven contra base)', () => {
    // data: URIs son URLs válidas por sí mismas — el constructor URL las
    // retorna tal cual. Esto es lo que queremos: si la página declaró un
    // placeholder transparente, no es nuestro problema "resolverlo".
    const dataUri = 'data:image/svg+xml,<svg></svg>'
    expect(resolveUrl(dataUri, 'https://shop.com')).toBe(dataUri)
  })

  it('devuelve la URL absoluta si no hay baseUrl pero la relativa es https', () => {
    // Sin base, solo podemos devolver URLs ya absolutas.
    expect(resolveUrl('https://abs.com/img.png', '')).toBe('https://abs.com/img.png')
  })

  it('devuelve "" si no hay base y la relativa no es absoluta', () => {
    // Sin base no podemos resolver "image.jpg" — mejor fallar closed.
    expect(resolveUrl('image.jpg', '')).toBe('')
  })
})
