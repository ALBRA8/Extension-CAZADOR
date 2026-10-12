import { Sparkles, Wand2, X } from 'lucide-react'
import { useSidebarStore } from '@/store/sidebar-store'

/**
 * Banner que se muestra cuando el service worker detectó una plantilla
 * preconfigurada cuya `urlMatcher` encaja con la URL activa. Ofrece un
 * botón "Usar plantilla" que reemplaza las columnas sugeridas por la IA
 * por las columnas definidas en el seed de la plantilla.
 *
 * Se renderiza entre `<PageBanner />` y `<FieldList />` (ver Sidebar.tsx).
 * Si no hay plantilla matched, no renderiza nada.
 */
export function TemplateMatchBanner() {
  const { matchedTemplate, applyMatchedTemplate, setMatchedTemplate } =
    useSidebarStore()

  if (!matchedTemplate) return null

  const fieldCount = Array.isArray(matchedTemplate.fields)
    ? matchedTemplate.fields.length
    : 0

  return (
    <div className="cz-template-banner" role="status" aria-live="polite">
      <div className="cz-template-banner-icon">
        <Sparkles size={13} />
      </div>
      <div className="cz-template-banner-text">
        <div className="cz-template-banner-label">Plantilla detectada</div>
        <div className="cz-template-banner-name" title={matchedTemplate.name}>
          {matchedTemplate.name}
        </div>
        {fieldCount > 0 && (
          <div className="cz-template-banner-meta">
            {fieldCount} columna{fieldCount === 1 ? '' : 's'} ·{' '}
            <span className="cz-template-banner-cat">
              {matchedTemplate.category}
            </span>
          </div>
        )}
      </div>
      <div className="cz-template-banner-actions">
        <button
          type="button"
          className="cz-btn-primary cz-btn-sm"
          onClick={applyMatchedTemplate}
          title="Reemplazar las columnas sugeridas por las de la plantilla"
        >
          <Wand2 size={13} /> Usar plantilla
        </button>
        <button
          type="button"
          className="cz-icon-btn cz-icon-danger"
          onClick={() => setMatchedTemplate(null)}
          title="Descartar plantilla"
          aria-label="Descartar plantilla detectada"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  )
}
