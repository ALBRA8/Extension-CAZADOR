# ⚡ Thunderbit Clone

Una recreación open-source y mejorada de [Thunderbit](https://thunderbit.com): la extensión de Chrome que scrapea cualquier web con IA en 2 clics.

## 🎯 Qué incluye

| Pieza | Carpeta | Stack |
|---|---|---|
| **Extensión Chrome** (sidebar + AI scraper) | `extension/` | Vite + React + TypeScript + Manifest V3 |
| **Backend IA local** (GLM vía z-ai-web-dev-sdk) | `server/` | Node.js HTTP + z-ai-web-dev-sdk |
| **Landing page** | `landing/` | Vite + React + TypeScript |
| **Dashboard web** | `dashboard/` | Vite + React + TypeScript + Recharts |

## ✨ Features implementadas

### Extensión
- ✅ Sidebar lateral integrado (sidePanel API de Chrome)
- ✅ **AI Suggest Fields**: la IA escanea la página y sugiere columnas automáticamente
- ✅ Editor de columnas con tipos (texto, número, precio, fecha, URL, email, teléfono, imagen)
- ✅ **Cost estimator transparente** — ves los créditos ANTES de scrapear (mejora vs original)
- ✅ Score de confianza por columna (anti-alucinación)
- ✅ Export a **CSV** y **Excel (.xlsx real)**
- ✅ Historial persistente en `chrome.storage.local`
- ✅ UI 100% en español
- ✅ Iconos con degradado de marca (verde → cian → amarillo → naranja)
- ✅ Manifest V3 con `sidePanel`, `scripting`, `activeTab`, `storage` permissions

### Backend
- ✅ `POST /api/suggest-fields` — GLM sugiere columnas
- ✅ `POST /api/scrape` — GLM extrae datos estructurados
- ✅ Filtra filas vacías automáticamente
- ✅ CORS habilitado para la extensión
- ✅ Prompts en español con reglas anti-alucinación

### Landing page
- ✅ Hero con mockup interactivo de la extensión
- ✅ Features (6 tarjetas)
- ✅ Cómo funciona (3 pasos)
- ✅ Tabla comparativa Clone vs. original
- ✅ Pricing (4 planes)
- ✅ Testimonios
- ✅ CTA + Footer

### Dashboard
- ✅ Overview con stats, gráficos (área + pie), tabla de scrapes recientes
- ✅ Mis scrapes (con filtros por estado y búsqueda)
- ✅ Programados (scheduled jobs con pausar/reanudar)
- ✅ Plantillas (grid con categorías y búsqueda)
- ✅ API Keys (con ejemplo curl)
- ✅ Ajustes (5 tabs: Cuenta, Facturación, Integraciones, Notificaciones, Avanzado)

## 🚀 Cómo instalar y probar

### 1. Backend IA
```bash
cd server
npm install
npm start
# → http://localhost:8787
```

Verifica que responde:
```bash
curl http://localhost:8787/api/health
# {"ok":true,"model":"glm","ts":...}
```

### 2. Extensión Chrome
```bash
cd extension
npm install
npm run build
# → genera dist/
```

Cargar en Chrome:
1. Abre `chrome://extensions`
2. Activa **Modo desarrollador** (arriba a la derecha)
3. **Cargar descomprimida** → selecciona `extension/dist/`
4. Pinea el icono ⚡ en la toolbar
5. Navega a cualquier web con listados (Amazon, MercadoLibre, Zillow, una tienda…)
6. Click en el icono ⚡ → se abre el sidebar
7. Click en **"Analizar página"** → la IA sugiere columnas
8. Click en **"Estimar costo y scrapear"** → ves los créditos
9. **Confirmar y scrapear** → descarga CSV/Excel

### 3. Landing page (demo)
```bash
cd landing
npm install
npm run dev    # desarrollo
npm run build  # producción → dist/
```

### 4. Dashboard (demo)
```bash
cd dashboard
npm install
npm run dev    # desarrollo
npm run build  # producción → dist/
```

## 🔌 Arquitectura

```
┌──────────────────┐         ┌──────────────────┐
│  Pestaña activa  │         │   Sidebar React  │
│  (cualquier web) │         │  (sidePanel API) │
└────────┬─────────┘         └────────┬─────────┘
         │                            │
         │ chrome.scripting           │ chrome.runtime.sendMessage
         │ .executeScript             │
         ▼                            ▼
┌──────────────────────────────────────────────────┐
│        Background Service Worker (MV3)           │
│  - Extrae texto compacto de la página            │
│  - Llama al backend IA                           │
│  - Persiste historial en chrome.storage          │
└────────────────────┬─────────────────────────────┘
                     │ fetch HTTP
                     ▼
┌──────────────────────────────────────────────────┐
│      Backend local (Node.js, puerto 8787)        │
│  - /api/suggest-fields  → GLM sugiere columnas   │
│  - /api/scrape          → GLM extrae filas       │
│  - z-ai-web-dev-sdk (GLM)                        │
└──────────────────────────────────────────────────┘
```

## 💡 Mejoras clave vs. Thunderbit original

| Problema del original | Solución del clone |
|---|---|
| 🔥 Créditos se consumen sin avisar | ✅ Estimador de costo ANTES del scrape |
| 🔥 No hay cancelación self-service | ✅ Botón "Cancelar suscripción" en settings |
| 🔥 Historial se pierde al cerrar browser | ✅ Persistencia en `chrome.storage.local` |
| 🔥 No sabes si la IA inventó datos | ✅ Score de confianza por columna |
| 🔥 Stack cerrado, no auditable | ✅ Open source, todo el código disponible |
| 🔥 Defaultea a plan anual | ✅ Sin defaults engañosos |

## 🛠️ Stack técnico

- **Frontend extensión**: Vite 5 + React 18 + TypeScript 5 + Zustand
- **Backend**: Node.js HTTP server + z-ai-web-dev-sdk (GLM)
- **Landing & Dashboard**: Vite + React + TypeScript
- **Charts dashboard**: Recharts
- **Icons**: lucide-react
- **Estilos**: CSS puro con variables CSS (sin framework)
- **Build**: Rollup (vía Vite) → bundle final <180 KB gzipped

## 📁 Estructura

```
cazador/
├── extension/
│   ├── public/
│   │   ├── manifest.json       # MV3 manifest
│   │   └── icons/              # PNG generados (16/48/128)
│   ├── src/
│   │   ├── background/         # Service worker
│   │   ├── content/            # Page extractor
│   │   ├── sidebar/            # React UI (sidePanel)
│   │   ├── components/         # Header, FieldList, CostEstimator, etc.
│   │   ├── store/              # Zustand
│   │   ├── lib/                # exporters.ts (CSV/XLSX), messaging
│   │   ├── types/              # Shared TypeScript types
│   │   └── styles/             # globals + components CSS
│   ├── scripts/
│   │   └── gen-icons.mjs       # Genera iconos PNG con rayo ⚡
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── server/
│   ├── server.js               # Node HTTP + z-ai-web-dev-sdk
│   └── package.json
├── landing/
│   ├── src/
│   │   ├── sections/           # Navbar, Hero, Features, Pricing…
│   │   ├── styles/             # globals + components CSS
│   │   └── Landing.tsx
│   └── package.json
├── dashboard/
│   ├── src/
│   │   ├── pages/              # Overview, Jobs, Scheduled, Templates, ApiKeys, Settings
│   │   ├── lib/                # mock-data.ts
│   │   ├── styles/             # globals.css
│   │   └── Dashboard.tsx
│   └── package.json
└── README.md
```

## ⚠️ Limitaciones conocidas del MVP

- La IA es GLM (vía z-ai-web-dev-sdk). No hay routing multi-modelo (Claude+GPT+Gemini) como el original.
- No hay subpage scraping, pagination, ni bulk URLs en este hito.
- No hay scheduled scraping en el backend (solo UI en el dashboard).
- El dashboard usa datos mock. Para producción conectar a una API real.
- Solo soporta Chrome (no Firefox/Safari).

## 🗺️ Roadmap sugerido

1. **Subpage scraping** — entrar a cada link y extraer datos de detalle
2. **Pagination automática** — auto-click en "Siguiente" / infinite scroll
3. **Plantillas 1-click** — para Amazon, LinkedIn, Zillow, Google Maps
4. **Integraciones** — Google Sheets, Notion, Airtable (vía OAuth)
5. **Auth real** — Supabase / Clerk para el dashboard
6. **Backend multi-modelo** — routing entre GLM / Claude / GPT
7. **API REST pública** — además del SDK

## 📝 Licencia

Proyecto de demostración. Código abierto para fines educativos.
