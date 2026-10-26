import { describe, expect, it } from 'vitest'
import { isJVZooUrl, buildJVZooSuggestion, jvzooToStructured, type JVZooProduct } from '@/lib/jvzoo'

describe('JVZoo Extractor Pure Helpers', () => {
  describe('isJVZooUrl', () => {
    it('detects standard jvzoomarket.com urls', () => {
      expect(isJVZooUrl('https://www.jvzoomarket.com/productlibrary/review/363')).toBe(true)
      expect(isJVZooUrl('https://jvzoomarket.com/')).toBe(true)
    })

    it('detects www.jvzoo.com affiliate and funnel urls', () => {
      expect(isJVZooUrl('https://www.jvzoo.com/c/1/446851?tid=topseller')).toBe(true)
      expect(isJVZooUrl('https://www.jvzoo.com/b/115739/434893/5')).toBe(true)
      expect(isJVZooUrl('https://www.jvzoo.com/affiliate/affiliateinfonew/index/436239')).toBe(true)
    })

    it('detects customer.jvzoo.com product library', () => {
      expect(isJVZooUrl('https://customer.jvzoo.com/productlibrary/')).toBe(true)
      expect(isJVZooUrl('https://customer.jvzoo.com/productlibrary/review/123')).toBe(true)
    })

    it('rejects non-jvzoo urls', () => {
      expect(isJVZooUrl('https://example.com')).toBe(false)
      expect(isJVZooUrl('https://google.com/search?q=jvzoo')).toBe(false)
      expect(isJVZooUrl('https://fake-jvzoo.com.attacker.com')).toBe(false)
    })
  })

  describe('buildJVZooSuggestion', () => {
    it('creates suggestion fields with commission and units sold', () => {
      const mockProducts: JVZooProduct[] = [
        {
          title: 'Adastra Studio Bundle',
          price: '47.00',
          units_sold: 1250,
          vendor: 'Adastra Team',
          image_url: 'https://cdn.jvzoo.com/img1.png',
          detail_url: 'https://www.jvzoo.com/c/1/446851',
          commission_pct: 50,
        },
      ]

      const suggestion = buildJVZooSuggestion(mockProducts)
      expect(suggestion.estimatedRows).toBe(1)
      expect(suggestion.pageCategory).toContain('JVZoo')
      
      const fieldNames = suggestion.fields.map(f => f.name)
      expect(fieldNames).toContain('Título')
      expect(fieldNames).toContain('Precio')
      expect(fieldNames).toContain('Comisión %')
      expect(fieldNames).toContain('Vendor')
      expect(fieldNames).toContain('URL Detalle')
    })
  })

  describe('jvzooToStructured', () => {
    it('converts JVZooProduct to canonical StructuredProduct with extras', () => {
      const products: JVZooProduct[] = [
        {
          title: 'Cinematic Maker AI',
          price: '37.00',
          units_sold: 840,
          vendor: 'VideoFX Pros',
          image_url: 'https://cdn.jvzoo.com/cinematic.png',
          detail_url: 'https://www.jvzoo.com/b/114547/424623/2',
          commission_pct: 50,
        },
      ]

      const structured = jvzooToStructured(products)
      expect(structured.length).toBe(1)
      expect(structured[0].name).toBe('Cinematic Maker AI')
      expect(structured[0].price).toBe('37.00')
      expect(structured[0].currency).toBe('USD')
      expect(structured[0].source).toBe('jvzoo')
      expect(structured[0].brand).toBe('VideoFX Pros')
      expect(structured[0].extras?.units_sold).toBe('840')
      expect(structured[0].extras?.commission_pct).toBe('50')
      expect(structured[0].extractionStatus).toBe('complete')
    })
  })
})
