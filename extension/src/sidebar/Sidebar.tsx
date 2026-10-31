import { useEffect } from 'react'
import { useSidebarStore } from '@/store/sidebar-store'
import { sendMessage } from '@/lib/messaging'
import { Header } from '@/components/Header'
import { PageBanner } from '@/components/PageBanner'
import { FieldList } from '@/components/FieldList'
import { CostEstimator } from '@/components/CostEstimator'
import { ResultsTable } from '@/components/ResultsTable'
import { ProgressOverlay } from '@/components/ProgressOverlay'
import { HistoryDrawer } from '@/components/HistoryDrawer'
import { EmptyState } from '@/components/EmptyState'
import { ErrorBanner } from '@/components/ErrorBanner'
import { TemplateMatchBanner } from '@/components/TemplateMatchBanner'
import { DropiConnectionBanner } from '@/components/DropiConnectionBanner'
import NexscopeSettings from '@/sidebar/NexscopeSettings'
import { useState } from 'react'

// Matches https://app.dropi.<LATAM-TLD>/ — the SPA hosts where the
// dropi-interceptor content script is declared.
const DROPI_TAB_URL_RE =
  /^https:\/\/app\.dropi\.(co|mx|pe|cl|ec|ar|com\.py|com\.ve|gt|cr|pa)\//

export function Sidebar() {
  const {
    status,
    url,
    fields,
    rows,
    progress,
    error,
    setProgress,
    setError,
  } = useSidebarStore()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [activeTabUrl, setActiveTabUrl] = useState<string>('')

  // Track the active tab URL so we can render the Dropi banner only when
  // the user is actually on app.dropi.*.
  useEffect(() => {
    const update = async () => {
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        })
        setActiveTabUrl(tab?.url || '')
      } catch {
        /* ignore — tabs API not ready yet */
      }
    }
    update()
    const onActivated = () => update()
    const onUpdated = (
      _id: number,
      info: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab,
    ) => {
      if (tab.active && (info.url || info.status === 'complete')) update()
    }
    const onFocused = (_wid: number) => update()
    chrome.tabs.onActivated.addListener(onActivated)
    chrome.tabs.onUpdated.addListener(onUpdated)
    chrome.windows.onFocusChanged.addListener(onFocused)
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated)
      chrome.tabs.onUpdated.removeListener(onUpdated)
      chrome.windows.onFocusChanged.removeListener(onFocused)
    }
  }, [])

  const isDropiTab = DROPI_TAB_URL_RE.test(activeTabUrl)

  // Listen for messages from the background service worker.
  useEffect(() => {
    const listener = (msg: any) => {
      if (!msg || !msg.type) return
      const store = useSidebarStore.getState()
      switch (msg.type) {
        case 'PAGE_EXTRACTED':
          store.setPage(msg.payload)
          // Auto-trigger AI Suggest Fields right after extraction.
          sendMessage({ type: 'SUGGEST_FIELDS', payload: msg.payload })
          store.setStatus('suggesting-fields')
          break
        case 'TEMPLATE_MATCH':
          // El service worker ya matcheó la URL activa contra los templates
          // y encontró una plantilla preconfigurada. La precargamos en el
          // store para que el banner pueda ofrecer "Usar plantilla"; el
          // reemplazo real de columnas lo dispara el usuario con el botón.
          store.setMatchedTemplate(msg.payload?.template ?? null)
          break
        case 'SUGGEST_FIELDS_RESULT':
          store.setFields(msg.payload.fields, msg.payload.pageCategory, msg.payload.estimatedRows)
          break
        case 'ESTIMATE_COST_RESULT':
          store.setCost(msg.payload)
          break
        case 'SCRAPE_PROGRESS':
          store.setProgress(msg.payload)
          store.setStatus('scraping')
          break
        case 'SCRAPE_RESULT':
          store.setRows(msg.payload.rows, msg.payload.confidence)
          break
        case 'ERROR':
          store.setError(msg.payload.message)
          break
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  return (
    <div className="cz-app">
      <Header onOpenHistory={() => setHistoryOpen(true)} />

      <main className="cz-main">
        {isDropiTab && <DropiConnectionBanner />}

        {!url && <EmptyState />}

        {url && (
          <>
            <PageBanner />
            <TemplateMatchBanner />
            <ErrorBanner error={error} onClose={() => setError(null)} />

            {fields.length > 0 && <FieldList />}

            {fields.length > 0 && status !== 'done' && <CostEstimator />}

            {rows.length > 0 && <ResultsTable />}

            {progress && <ProgressOverlay phase={progress.phase} progress={progress.progress} />}
          </>
        )}
      </main>

      <details className="cz-nexscope-settings" style={{ marginTop: '12px', padding: '8px', borderTop: '1px solid var(--cz-border)' }}>
        <summary style={{ cursor: 'pointer', fontSize: '12px', color: 'var(--cz-muted)' }}>
          ⚙️ Conexión NEX-SCOPE
        </summary>
        <NexscopeSettings />
      </details>

      {historyOpen && <HistoryDrawer onClose={() => setHistoryOpen(false)} />}
    </div>
  )
}
