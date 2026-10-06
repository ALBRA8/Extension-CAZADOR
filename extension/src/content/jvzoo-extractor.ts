// Content script: JVZoo marketplace specialized extractor.
// Injected by the background service worker only on jvzoomarket.com pages.
// It is bundled as a classic (import-free) script so chrome.scripting.executeScript
// can inject it via `files: ['jvzoo-extractor.js']`.
//
// Selectors verified against the live https://www.jvzoomarket.com/ HTML:
//   - Product card:    div.home-review-card
//   - Detail URL link: a[href*="/productlibrary/review/"]   (first one wraps the cover image)
//   - Cover image:     img.card-img-top  (inside that anchor)
//   - Units sold:      div.badge.badge-pill.badge-light  -> "1103 Sold"
//   - Price:           div.float-right.font-weight-bold  -> "$24.95"
//   - Vendor:          div.font-weight-bold > a[href*="search="]  (preceded by literal "Sold By ")

interface JVZooProduct {
  title: string
  price: string
  units_sold: number
  vendor: string
  image_url: string
  detail_url: string
}

interface JVZooExtractResult {
  url: string
  title: string
  pageText: string
  detectedItems: number
  jvzooProducts: JVZooProduct[]
}

function isJVZooHost(): boolean {
  const host = location.hostname.toLowerCase()
  return host === 'jvzoomarket.com' || host.endsWith('.jvzoomarket.com')
}

function cleanText(s: string): string {
  return (s || '').replace(/\s+/g, ' ').trim()
}

function parseUnitsSold(text: string): number {
  if (!text) return 0
  // Match the first integer found in the badge ("1103 Sold" -> 1103).
  const m = text.replace(/[,.\s]/g, '').match(/(\d+)/)
  return m ? parseInt(m[1], 10) || 0 : 0
}

function parsePrice(text: string): string {
  if (!text) return ''
  // Normalise "$24.95" -> "24.95". If no $ prefix, return the raw text trimmed.
  const m = text.match(/(\$\s?\d[\d,]*\.?\d{0,2})/)
  if (m) return m[1].replace(/\$\s?/, '').replace(/,/g, '').trim()
  return cleanText(text)
}

function extractVendorFromAnchor(a: HTMLAnchorElement | null): string {
  if (!a) return ''
  return cleanText(a.textContent || '')
}

function extractTitle(card: Element): string {
  // JVZoo cards don't expose a product title; the most descriptive text is the
  // "card-text" paragraph. We use it as a stand-in for the title, truncated.
  const desc = card.querySelector('p.card-text, .jvz-font-8rem, .card-text')
  const text = cleanText(desc?.textContent || '')
  if (text) return text.slice(0, 120)
  // Fallback: vendor + a small hint.
  const vendor = extractVendorFromAnchor(
    card.querySelector<HTMLAnchorElement>('div.font-weight-bold a[href*="search="]'),
  )
  return vendor ? `${vendor} (producto JVZoo)` : 'Producto JVZoo'
}

function extractCard(card: Element): JVZooProduct | null {
  try {
    const detailAnchor = card.querySelector<HTMLAnchorElement>('a[href*="/productlibrary/review/"]')
    const detailUrl = detailAnchor?.getAttribute('href') || ''

    const img = card.querySelector<HTMLImageElement>('img.card-img-top, img[src]')
    const imageUrl = img?.getAttribute('src') || img?.getAttribute('data-src') || ''

    const unitsEl = card.querySelector('div.badge.badge-pill.badge-light')
    const unitsSold = parseUnitsSold(unitsEl?.textContent || '')

    const priceEl = card.querySelector('div.float-right.font-weight-bold')
    const price = parsePrice(priceEl?.textContent || '')

    const vendorAnchor = card.querySelector<HTMLAnchorElement>(
      'div.font-weight-bold a[href*="search="]',
    )
    const vendor = extractVendorFromAnchor(vendorAnchor)

    const title = extractTitle(card)

    return {
      title,
      price,
      units_sold: unitsSold,
      vendor,
      image_url: imageUrl,
      detail_url: detailUrl,
    }
  } catch {
    return null
  }
}

function extractJVZooProducts(): JVZooProduct[] {
  const cards = Array.from(document.querySelectorAll('div.home-review-card'))
  const products: JVZooProduct[] = []
  for (const card of cards) {
    const p = extractCard(card)
    if (p) products.push(p)
  }
  return products
}

function buildPageText(products: JVZooProduct[]): string {
  const parts: string[] = []
  parts.push(`TITLE: ${document.title}`)
  parts.push(`URL: ${location.href}`)
  parts.push(`SITE: jvzoomarket.com (specialized extractor)`)
  parts.push(`JVZOO_PRODUCTS_DETECTED: ${products.length}`)
  if (products.length) {
    parts.push('--- STRUCTURED PRODUCTS ---')
    products.slice(0, 25).forEach((p, i) => {
      parts.push(
        `[PRODUCT ${i + 1}] title="${p.title}" price="${p.price}" units_sold=${p.units_sold} vendor="${p.vendor}" image="${p.image_url}" detail="${p.detail_url}"`,
      )
    })
  }
  return parts.join('\n').slice(0, 16000)
}

function extract(): JVZooExtractResult {
  const products = extractJVZooProducts()
  return {
    url: location.href,
    title: document.title,
    pageText: buildPageText(products),
    detectedItems: products.length,
    jvzooProducts: products,
  }
}

// Listen for messages from the background service worker.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'EXTRACT_JVZOO') {
    if (!isJVZooHost()) {
      sendResponse({ ok: false, error: 'No es jvzoomarket.com' })
      return false
    }
    try {
      sendResponse({ ok: true, data: extract() })
    } catch (e) {
      sendResponse({ ok: false, error: (e as Error).message })
    }
    return true
  }
  return false
})
