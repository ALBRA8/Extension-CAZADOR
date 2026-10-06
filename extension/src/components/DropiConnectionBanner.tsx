import { useEffect, useState, useCallback } from 'react'
import {
  ShieldCheck,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Package,
} from 'lucide-react'
import { sendMessage } from '@/lib/messaging'

// State shape returned by the background's DROPI_GET_STATE handler.
interface DropiState {
  jwt: string | null
  jwtExpiresAt: number | null
  jwtValid: boolean
  jwtExpiresSoon: boolean
  productsCount: number
  lastCapture: number | null
}

const EMPTY: DropiState = {
  jwt: null,
  jwtExpiresAt: null,
  jwtValid: false,
  jwtExpiresSoon: false,
  productsCount: 0,
  lastCapture: null,
}

function fmtTime(ts: number | null): string {
  if (!ts) return '--:--'
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/**
 * Banner shown in the sidebar when the active tab is on app.dropi.*.
 *
 * On mount (and every 60s) it asks the background for the live Dropi state
 * (captured JWT + cached product count) and renders one of three variants:
 *   • green   — JWT valid and not expiring soon
 *   • yellow  — no JWT / JWT expired / JWT expiring in <30min
 *   • info    — initial loading
 */
export function DropiConnectionBanner() {
  const [state, setState] = useState<DropiState>(EMPTY)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await sendMessage({ type: 'DROPI_GET_STATE' })
      if (res?.ok && res.data) {
        setState(res.data)
      } else {
        setState(EMPTY)
      }
    } catch {
      // Background or content script unavailable — show the "needs login" state.
      setState(EMPTY)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    // Refresh every 60s so the "expira pronto" warning flips in real time.
    const id = setInterval(refresh, 60_000)
    return () => clearInterval(id)
  }, [refresh])

  // --- Loading -------------------------------------------------------------
  if (loading) {
    return (
      <div
        className="cz-dropi-banner cz-dropi-banner-info"
        role="status"
        aria-live="polite"
      >
        <Loader2 size={14} className="spin" />
        <span>Consultando Dropi…</span>
      </div>
    )
  }

  // --- No JWT captured → needs login --------------------------------------
  if (!state.jwt) {
    return (
      <div
        className="cz-dropi-banner cz-dropi-banner-warning"
        role="status"
        aria-live="polite"
      >
        <AlertTriangle size={14} />
        <span>
          Para scrapear Dropi: inicia sesión en{' '}
          <strong>app.dropi.co</strong> y vuelve. Dropi requiere login (gratis).
        </span>
      </div>
    )
  }

  // --- JWT captured but already expired ------------------------------------
  if (!state.jwtValid) {
    return (
      <div
        className="cz-dropi-banner cz-dropi-banner-warning"
        role="status"
        aria-live="polite"
      >
        <AlertTriangle size={14} />
        <span>
          Tu sesión de Dropi expiró. Recarga <strong>app.dropi.co</strong> para
          renovarla.
        </span>
        <button
          className="cz-dropi-refresh"
          onClick={refresh}
          title="Revisar de nuevo"
        >
          <RefreshCw size={12} />
        </button>
      </div>
    )
  }

  // --- JWT valid but expiring in <30min ------------------------------------
  if (state.jwtExpiresSoon) {
    return (
      <div
        className="cz-dropi-banner cz-dropi-banner-warning"
        role="status"
        aria-live="polite"
      >
        <AlertTriangle size={14} />
        <span>
          Tu sesión de Dropi expira pronto. Recarga{' '}
          <strong>app.dropi.co</strong> para renovarla.
        </span>
        <button
          className="cz-dropi-refresh"
          onClick={refresh}
          title="Revisar de nuevo"
        >
          <RefreshCw size={12} />
        </button>
      </div>
    )
  }

  // --- All green -----------------------------------------------------------
  return (
    <div
      className="cz-dropi-banner cz-dropi-banner-success"
      role="status"
      aria-live="polite"
    >
      <ShieldCheck size={14} />
      <span>
        Dropi conectado · <strong>{state.productsCount}</strong> productos
        cacheados · JWT válido hasta{' '}
        <strong>{fmtTime(state.jwtExpiresAt)}</strong>
      </span>
      <span className="cz-dropi-chip">
        <Package size={11} /> cache
      </span>
      <button
        className="cz-dropi-refresh"
        onClick={refresh}
        title="Revisar de nuevo"
      >
        <RefreshCw size={12} />
      </button>
    </div>
  )
}
