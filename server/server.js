/**
 * Backend local para la extensión Cazador.
 *
 * Endpoints:
 *   POST /api/suggest-fields  → sugiere columnas a partir del texto de la página
 *   POST /api/scrape          → extrae datos estructurados según las columnas
 *   POST /api/health          → ping
 *
 * Usa el SDK de z-ai-web-dev-sdk (GLM) instalado en este proyecto.
 */

import http from 'node:http'
import ZAI from 'z-ai-web-dev-sdk'

const PORT = process.env.PORT || 8787
let sdk = null

async function getSdk() {
  if (!sdk) sdk = await ZAI.create()
  return sdk
}

// ─── HTTP server ─────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // CORS para que la extensión (chrome-extension://…) pueda llamarlo.
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'GET' && req.url === '/api/health') {
    return json(res, 200, { ok: true, model: 'glm', ts: Date.now() })
  }

  if (req.method === 'POST' && req.url === '/api/suggest-fields') {
    return handleSuggestFields(req, res)
  }

  if (req.method === 'POST' && req.url === '/api/scrape') {
    return handleScrape(req, res)
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

server.listen(PORT, () => {
  console.log(`[cazador-server] Listening on http://localhost:${PORT}`)
})

// ─── Handlers ────────────────────────────────────────────────────────────────
async function handleSuggestFields(req, res) {
  try {
    const body = await readJson(req)
    const prompt = buildSuggestPrompt(body)
    const zai = await getSdk()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 1200,
    })
    const text = completion.choices?.[0]?.message?.content || ''
    const parsed = parseJsonLoose(text)
    const fields = (parsed.fields || []).map((f, i) => ({
      id: `f_${i}_${slug(f.name)}`,
      name: String(f.name || '').slice(0, 60),
      type: validType(f.type) || 'text',
      hint: f.hint ? String(f.hint).slice(0, 120) : undefined,
      source: 'ai',
    }))
    return json(res, 200, {
      fields,
      pageCategory: String(parsed.pageCategory || 'listado').slice(0, 60),
      estimatedRows: Number(parsed.estimatedRows || body.detectedItems || 10),
      reasoning: parsed.reasoning,
    })
  } catch (e) {
    console.error('[suggest-fields] error', e)
    return json(res, 500, { error: e.message })
  }
}

async function handleScrape(req, res) {
  const started = Date.now()
  try {
    const body = await readJson(req)
    const prompt = buildScrapePrompt(body)
    const zai = await getSdk()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 6000,
    })
    const text = completion.choices?.[0]?.message?.content || ''
    const parsed = parseJsonLoose(text)
    let rows = Array.isArray(parsed.rows) ? parsed.rows : []
    // Filter out rows where ALL fields are empty (model shouldn't have produced them).
    rows = rows.filter((r) => Object.values(r).some((v) => String(v || '').trim() !== ''))
    const confidence = Array.isArray(parsed.confidence)
      ? parsed.confidence.map((c) => ({
          fieldId: String(c.fieldId),
          score: Math.max(0, Math.min(1, Number(c.score) || 0)),
          note: c.note ? String(c.note) : undefined,
        }))
      : []

    // Cost in credits: 1 per row + 0.5 per extra field beyond 6.
    const extraFields = Math.max(0, body.fields.length - 6)
    const credits = Math.max(1, Math.round(rows.length * (1 + extraFields * 0.5)))

    return json(res, 200, {
      rows,
      rowCount: rows.length,
      confidence,
      creditsCost: credits,
      elapsedMs: Date.now() - started,
    })
  } catch (e) {
    console.error('[scrape] error', e)
    return json(res, 500, { error: e.message })
  }
}

// ─── Prompts ────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres un scraper de web basado en IA, parte de una extensión de Chrome llamada Cazador.

Tu única salida SIEMPRE es un objeto JSON válido, sin texto adicional, sin explicaciones, sin markdown. Si necesitas pensar, lo haces internamente.

Reglas:
- Hablas español.
- Detectas el tipo de página (listado de productos, inmobiliaria, profesionales, contactos, artículos, etc.).
- Sugieres columnas con nombre en español, corto, claro (ej. "Nombre", "Precio", "Email", "Imagen", "Teléfono", "Valoración", "Ubicación").
- El tipo de cada columna debe ser uno de: text, number, price, date, url, email, phone, image, longtext.
- Cuando extraes, DEVUELVES los valores EXACTAMENTE como aparecen en la página. No inventes. Si un campo no aparece para un item, devuelve "" (cadena vacía) y reporta baja confianza para esa columna.`

function buildSuggestPrompt(body) {
  return `Analiza la siguiente página web y sugiere las columnas más útiles para scrapearla.

URL: ${body.url}
Título: ${body.title}
Items detectados (heurística): ${body.detectedItems}

=== SNAPSHOT DE LA PÁGINA (texto compacto) ===
${(body.pageText || '').slice(0, 12000)}
=== FIN SNAPSHOT ===

Devuelve EXCLUSIVAMENTE este JSON:
{
  "pageCategory": "<categoría corta, ej. 'Listado de productos'>",
  "estimatedRows": <número estimado de filas extraíbles>,
  "reasoning": "<breve explicación>",
  "fields": [
    { "name": "<Nombre columna>", "type": "<text|number|price|date|url|email|phone|image|longtext>", "hint": "<pista opcional para la IA>" }
  ]
}

Devuelve entre 4 y 8 columnas. Prioriza los campos que aparecen repetidos en cada item.`
}

function buildScrapePrompt(body) {
  const fieldsDesc = body.fields
    .map((f, i) => `  ${i + 1}. "${f.name}" (tipo: ${f.type})${f.hint ? ` — pista: ${f.hint}` : ''}`)
    .join('\n')
  const fieldIds = body.fields.map((f) => f.id)

  return `Extrae los datos de la siguiente página según las columnas indicadas.

URL: ${body.url}
Título: ${body.title}
Máximo de filas a extraer: ${body.maxRows}

=== COLUMNAS ===
${fieldsDesc}

=== SNAPSHOT DE LA PÁGINA (texto compacto) ===
${(body.pageText || '').slice(0, 12000)}
=== FIN SNAPSHOT ===

Devuelve EXCLUSIVAMENTE este JSON:
{
  "rows": [
    { "${fieldIds[0]}": "valor", ${fieldIds.slice(1).map((id) => `"${id}": "valor"`).join(', ')} }
  ],
  "confidence": [
    { "fieldId": "<id columna>", "score": <0..1>, "note": "<motivo si es bajo>" }
  ]
}

Reglas críticas:
- Devuelve EXACTAMENTE una fila por cada item detectado en la página. NO agregues filas extra vacías para llegar a "maxRows".
- Si la página sólo tiene 3 items, devuelve 3 filas, no 5.
- No inventes valores. Si no aparece, usa "".
- Para tipo "price" devuelve sólo el número (ej. "1299.99").
- Para tipo "image" devuelve la URL absoluta de la imagen.
- Para tipo "url" devuelve la URL absoluta.
- Para tipo "phone" normaliza a formato E.164 si es posible.
- confidence.score < 0.6 si los valores de esa columna son inferidos o faltan en más del 30% de las filas.`
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let chunks = ''
    req.on('data', (c) => (chunks += c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(chunks || '{}'))
      } catch (e) {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function parseJsonLoose(s) {
  // LLMs sometimes wrap JSON in ```json … ``` or add prose. Be forgiving.
  if (!s) return {}
  let t = s.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  const firstBrace = t.indexOf('{')
  const lastBrace = t.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    t = t.slice(firstBrace, lastBrace + 1)
  }
  try {
    return JSON.parse(t)
  } catch {
    return {}
  }
}

function validType(t) {
  const allowed = ['text', 'number', 'price', 'date', 'url', 'email', 'phone', 'image', 'longtext']
  return allowed.includes(t) ? t : null
}

function slug(s) {
  return String(s || 'field')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20) || 'field'
}
