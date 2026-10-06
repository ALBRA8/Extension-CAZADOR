// Content script injected into the active tab by the background service worker.
// It produces a compact, LLM-friendly text snapshot of the visible page.

interface ExtractedPage {
  url: string
  title: string
  pageText: string
  detectedItems: number
}

function isVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false
  const style = window.getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * Heuristic to estimate how many "items" the page contains.
 * Looks for repeated structural blocks: list items, article cards, table rows.
 */
function detectItems(): number {
  const candidates = [
    'article',
    '[class*="card"]',
    '[class*="Card"]',
    '[class*="product"]',
    '[class*="Product"]',
    '[class*="item"]',
    '[class*="Item"]',
    '[class*="listing"]',
    '[class*="Listing"]',
    '[data-testid*="card"]',
    '[data-testid*="item"]',
    'li[class]',
    'tr[class]',
  ]
  let max = 0
  for (const sel of candidates) {
    const nodes = Array.from(document.querySelectorAll(sel)).filter(isVisible)
    if (nodes.length > max) max = nodes.length
  }
  // Fallback: count list items and table rows.
  if (max === 0) {
    const lis = document.querySelectorAll('ul > li, table tbody tr')
    max = Array.from(lis).filter(isVisible).length
  }
  return Math.min(max, 500)
}

/**
 * Build a compact text snapshot of the page that the LLM can reason about
 * without receiving the full DOM (cost & privacy friendly).
 *
 * Strategy:
 * 1. Take the <title>, <meta description>, <h1>/<h2>/<h3> for context.
 * 2. Walk the main content containers (main, article, body) and emit visible
 *    text in document order, capped to a token budget.
 * 3. Annotate repeated blocks (cards/products) with a marker so the model
 *    understands the page is a listing.
 */
function buildPageText(): string {
  const parts: string[] = []
  const title = document.title
  const desc = document.querySelector('meta[name="description"]')?.getAttribute('content') || ''
  parts.push(`TITLE: ${title}`)
  if (desc) parts.push(`META: ${cleanText(desc)}`)
  parts.push(`URL: ${location.href}`)

  // Headings for context.
  const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
    .filter(isVisible)
    .slice(0, 12)
    .map((h) => `<${h.tagName.toLowerCase()}>${cleanText(h.textContent || '')}</${h.tagName.toLowerCase()}>`)
  if (headings.length) parts.push(`HEADINGS:\n${headings.join('\n')}`)

  // Look for the largest repeating block to detect listings.
  const listingSelector = findListingSelector()
  if (listingSelector) {
    const items = Array.from(document.querySelectorAll(listingSelector)).filter(isVisible).slice(0, 25)
    parts.push(`LISTING_DETECTED (selector="${listingSelector}", items=${items.length})`)
    parts.push('--- SAMPLE ITEMS ---')
    items.forEach((item, i) => {
      const text = cleanText(item.textContent || '').slice(0, 600)
      const links = Array.from(item.querySelectorAll('a'))
        .map((a) => a.getAttribute('href'))
        .filter(Boolean)
        .slice(0, 3)
        .join(' | ')
      const imgs = Array.from(item.querySelectorAll('img'))
        .map((img) => img.getAttribute('src'))
        .filter(Boolean)
        .slice(0, 2)
        .join(' | ')
      parts.push(`[ITEM ${i + 1}]\n  TEXT: ${text}\n  LINKS: ${links}\n  IMGS: ${imgs}`)
    })
  } else {
    // Fallback: emit main visible text.
    const main = document.querySelector('main, article, [role="main"]') || document.body
    const text = cleanText(main.textContent || '').slice(0, 8000)
    parts.push(`PAGE_TEXT:\n${text}`)
  }

  return parts.join('\n\n').slice(0, 16000)
}

function findListingSelector(): string | null {
  const candidates = [
    'article',
    '[class*="card"]',
    '[class*="Card"]',
    '[class*="product"]',
    '[class*="Product"]',
    '[class*="item"]',
    '[class*="Item"]',
    '[class*="listing"]',
    '[class*="Listing"]',
    'li[class]',
    'tr[class]',
  ]
  for (const sel of candidates) {
    const nodes = Array.from(document.querySelectorAll(sel)).filter(isVisible)
    if (nodes.length >= 2) return sel
  }
  return null
}

function extract(): ExtractedPage {
  return {
    url: location.href,
    title: document.title,
    pageText: buildPageText(),
    detectedItems: detectItems(),
  }
}

// Listen for messages from the background / sidebar.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'EXTRACT_PAGE') {
    try {
      sendResponse({ ok: true, data: extract() })
    } catch (e) {
      sendResponse({ ok: false, error: (e as Error).message })
    }
    return true // async
  }
})
