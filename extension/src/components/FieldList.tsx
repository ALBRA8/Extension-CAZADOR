import { Plus, Trash2, Wand2, Loader2, Sparkles, Play } from 'lucide-react'
import { useSidebarStore } from '@/store/sidebar-store'
import { sendMessage } from '@/lib/messaging'
import type { FieldDefinition, FieldType } from '@/types'
import { useState } from 'react'

const TYPE_LABELS: Record<FieldType, string> = {
  text: 'Texto',
  number: 'Número',
  price: 'Precio',
  date: 'Fecha',
  url: 'URL',
  email: 'Email',
  phone: 'Teléfono',
  image: 'Imagen',
  longtext: 'Texto largo',
  boolean: 'Booleano',
  score: 'Score (0-100)',
}

export function FieldList() {
  const { fields, addField, removeField, updateField, url, title, pageText, detectedItems } =
    useSidebarStore()
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<FieldType>('text')
  const [reSuggesting, setReSuggesting] = useState(false)

  const handleAdd = () => {
    if (!newName.trim()) return
    const field: FieldDefinition = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      type: newType,
      source: 'user',
    }
    addField(field)
    setNewName('')
  }

  const handleReSuggest = async () => {
    setReSuggesting(true)
    await sendMessage({
      type: 'SUGGEST_FIELDS',
      payload: { url, title, pageText, detectedItems },
    })
    setReSuggesting(false)
  }

  const handleScrape = async () => {
    // Ask background to estimate cost first; user then confirms in CostEstimator.
    await sendMessage({
      type: 'ESTIMATE_COST',
      payload: { fieldCount: fields.length, requestedRows: Math.min(detectedItems || 10, 50) },
    })
  }

  return (
    <section className="cz-section">
      <div className="cz-section-head">
        <h2 className="cz-section-title">
          <Sparkles size={14} /> Columnas a extraer
        </h2>
        <button
          className="cz-btn-ghost cz-btn-sm"
          onClick={handleReSuggest}
          disabled={reSuggesting}
          title="Volver a sugerir columnas con IA"
        >
          {reSuggesting ? <Loader2 size={13} className="spin" /> : <Wand2 size={13} />}
          Re-sugerir
        </button>
      </div>

      <div className="cz-fields">
        {fields.map((f) => (
          <div key={f.id} className={`cz-field ${f.source === 'ai' ? 'cz-field-ai' : 'cz-field-user'}`}>
            <input
              className="cz-field-name"
              value={f.name}
              onChange={(e) => updateField(f.id, { name: e.target.value })}
              placeholder="Nombre de columna"
            />
            <select
              className="cz-field-type"
              value={f.type}
              onChange={(e) => updateField(f.id, { type: e.target.value as FieldType })}
            >
              {Object.entries(TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <input
              className="cz-field-hint"
              value={f.hint || ''}
              onChange={(e) => updateField(f.id, { hint: e.target.value })}
              placeholder="pista opcional (ej. 'sin símbolo $')"
              title="Pista opcional para la IA"
            />
            <button
              className="cz-icon-btn cz-icon-danger"
              onClick={() => removeField(f.id)}
              title="Quitar columna"
            >
              <Trash2 size={13} />
            </button>
            {f.source === 'ai' && <span className="cz-field-badge">IA</span>}
          </div>
        ))}
      </div>

      {/* Add new field */}
      <div className="cz-field-add">
        <input
          className="cz-field-name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="Nueva columna…"
        />
        <select
          className="cz-field-type"
          value={newType}
          onChange={(e) => setNewType(e.target.value as FieldType)}
        >
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <button className="cz-btn-ghost cz-btn-sm" onClick={handleAdd}>
          <Plus size={14} /> Añadir
        </button>
      </div>

      <button
        className="cz-btn-primary cz-btn-block"
        onClick={handleScrape}
        disabled={fields.length === 0}
      >
        <Play size={14} fill="currentColor" /> Estimar costo y scrapear
      </button>
    </section>
  )
}
