// Content script: Muncheye launch-calendar specialized extractor.
// Injected by the background service worker only on muncheye.com pages.
// Bundled as a classic (import-free) script for chrome.scripting.executeScript.
//
// Selectors verified against https://muncheye.com/ live HTML:
//   - Launch item container:  div.item.clearfix   (with optional class `mega_item`)
//   - Date block:              div.date > span.day  + span.month  ("6" + "Oct")
//   - Title link:              div.item_info > a[rel="bookmark"]
//   - Price/commission:        span.item_details  ("$27 at 50%"  or  "37.00 at 50%")
//   - Schema.org metadata:     meta[itemprop="releaseDate"] / meta[itemprop="price"]
//                              meta[itemprop="name"]  (canonical product name)
//
// Each launch's link (a[href]) is the JV page (e.g. /seyi-adeleke-omnibrain).
// The title anchor text often follows "Vendor: Product Name".

interface MuncheyeLaunch {
  title: string
  vendor: string
  launch_date: string
  jv_url: string
  price: string
  commission: string
}

interface MuncheyeExtractResult {
  url: string
  title: string
  pageText: string
  detectedItems: number
  muncheyeLaunches: MuncheyeLaunch[]
}

function isMuncheyeHost(): boolean {
  const host = location.hostname.toLowerCase()
  return host === 'muncheye.com' || host.endsWith('.muncheye.com')
}

function cleanText(s: string): string {
  return (s || '').replace(/\s+/g, ' ').trim()
}

function absolutize(href: string): string {
  if (!href) return ''
  try {
    return new URL(href, location.href).toString()
  } catch {
    return href
  }
}

function metaContent(scope: Element, name: string): string {
  const m = scope.querySelector(`meta[itemprop="${name}"]`)
  return cleanText(m?.getAttribute('content') || '')
}

function parsePriceAndCommission(text: string): { price: string; commission: string } {
  // Examples:  "$27 at 50%"  /  "37.00 at 50%"  /  "9.97 at 100%"
  let price = ''
  let commission = ''
  const m = text.match(/([\$\d.,]+)\s+at\s+(\d+)\s*%/i)
  if (m) {
    price = m[1].replace(/\$/g, '').replace(/,/g, '').trim()
    commission = `${m[2]}%`
  } else {
    const p = text.match(/([\$\d.,]+)/)
    if (p) price = p[1].replace(/\$/g, '').replace(/,/g, '').trim()
    const c = text.match(/at\s+(\d+)\s*%/i)
    if (c) commission = `${c[1]}%`
  }
  return { price, commission }
}

function parseDateFromBlock(dateBlock: Element | null, schemaDate: string): string {
  // Prefer schema.org ISO date if present.
  if (schemaDate) {
    const d = new Date(schemaDate)
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
    return schemaDate
  }
  if (!dateBlock) return ''
  const day = cleanText(dateBlock.querySelector('span.day')?.textContent || '')
  const month = cleanText(dateBlock.querySelector('span.month')?.textContent || '').replace(/&nbsp;/gi, '')
  const year = new Date().getFullYear()
  // If the launch month already passed this year, assume next year (calendar is forward-looking).
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const mIdx = months.findIndex((m) => m.toLowerCase() === month.toLowerCase())
  if (mIdx === -1) return `${day} ${month} ${year}`
  let yr = year
  if (mIdx < new Date().getMonth()) yr = year + 1
  const dd = String(day).padStart(2, '0')
  const mm = String(mIdx + 1).padStart(2, '0')
  return `${yr}-${mm}-${dd}`
}

function splitVendorAndTitle(rawTitle: string): { title: string; vendor: string } {
  // Convention: "Vendor: Product Name"
  const parts = rawTitle.split(/\s*:\s*/)
  if (parts.length >= 2) {
    const vendor = cleanText(parts[0])
    const title = cleanText(parts.slice(1).join(':'))
    return { vendor, title }
  }
  return { title: rawTitle, vendor: '' }
}

function extractLaunch(item: Element): MuncheyeLaunch | null {
  try {
    const titleAnchor = item.querySelector<HTMLAnchorElement>('div.item_info a[rel="bookmark"], div.item_info a[href]')
    const rawTitle = cleanText(titleAnchor?.textContent || '')
    const jvUrl = absolutize(titleAnchor?.getAttribute('href') || '')
    const { title, vendor } = splitVendorAndTitle(rawTitle)

    const schemaDate = metaContent(item, 'releaseDate')
    const dateBlock = item.querySelector('div.date')
    const launchDate = parseDateFromBlock(dateBlock, schemaDate)

    // Prefer schema.org price (canonical) over the visible item_details text.
    const schemaPrice = metaContent(item, 'price')
    const detailsText = cleanText(item.querySelector('span.item_details')?.textContent || '')
    const parsed = parsePriceAndCommission(detailsText)
    const price = schemaPrice || parsed.price
    const commission = parsed.commission

    // Fallback vendor: schema.org product "name" doesn't include vendor, so use
    // the title anchor's text. If still empty, try the brand image title attr.
    let finalVendor = vendor
    if (!finalVendor) {
      const brand = item.querySelector<HTMLImageElement>('img.brand')
      const brandTitle = brand?.getAttribute('title') || ''
      if (brandTitle) finalVendor = brandTitle // e.g. "JVZoo" — not a vendor, better than empty
    }

    return {
      title,
      vendor: finalVendor,
      launch_date: launchDate,
      jv_url: jvUrl,
      price,
      commission,
    }
  } catch {
    return null
  }
}

function extractLaunches(): MuncheyeLaunch[] {
  // Both "Big Launches" (mega_item) and "All Launches" lists share the same
  // item shape. Deduplicate by jv_url to avoid listing each mega-launch twice.
  const items = Array.from(document.querySelectorAll('div.item.clearfix'))
  const launches: MuncheyeLaunch[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const l = extractLaunch(item)
    if (!l || !l.jv_url) continue
    if (seen.has(l.jv_url)) continue
    seen.add(l.jv_url)
    launches.push(l)
  }
  return launches
}

function buildPageText(launches: MuncheyeLaunch[]): string {
  const parts: string[] = []
  parts.push(`TITLE: ${document.title}`)
  parts.push(`URL: ${location.href}`)
  parts.push(`SITE: muncheye.com (specialized extractor)`)
  parts.push(`MUNCHEYE_LAUNCHES_DETECTED: ${launches.length}`)
  if (launches.length) {
    parts.push('--- STRUCTURED LAUNCHES ---')
    launches.slice(0, 30).forEach((l, i) => {
      parts.push(
        `[LAUNCH ${i + 1}] title="${l.title}" vendor="${l.vendor}" date="${l.launch_date}" price="${l.price}" commission="${l.commission}" jv_url="${l.jv_url}"`,
      )
    })
  }
  return parts.join('\n').slice(0, 16000)
}

function extract(): MuncheyeExtractResult {
  const launches = extractLaunches()
  return {
    url: location.href,
    title: document.title,
    pageText: buildPageText(launches),
    detectedItems: launches.length,
    muncheyeLaunches: launches,
  }
}

// Listen for messages from the background service worker.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'EXTRACT_MUNCHEYE') {
    if (!isMuncheyeHost()) {
      sendResponse({ ok: false, error: 'No es muncheye.com' })
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
