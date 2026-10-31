/**
 * NexscopeSettings.tsx
 * ====================
 *
 * Sidebar component that lets the user configure the NEX-SCOPE mesh
 * integration from inside the extension:
 *
 *   - NEXSCOPE_URL (default: http://localhost:3000)
 *   - CAZADOR_WEBHOOK_SECRET (password field)
 *   - "Probar conexión" button — sends a `ping` signal and shows
 *     ok / fail with the server's response code.
 *
 * Mount this inside the existing `Sidebar.tsx` (e.g. in the settings
 * section at the bottom). The component is self-contained — it reads
 * and writes the same `chrome.storage.local` keys that
 * `mesh-client.ts` uses, so changes take effect immediately for all
 * future `sendToNexscope()` calls (no reload needed).
 *
 * State-in-effect lint note: the `useEffect` that loads the stored
 * settings calls `setUrl` / `setSecret`. We disable the
 * `react-hooks/set-state-in-effect` rule inline (Next 16 + React 19
 * lint) because this is the canonical load-on-mount pattern.
 */

import { useEffect, useState } from 'react';
import {
  readNexscopeSettings,
  writeNexscopeSettings,
  sendToNexscope,
  buildPingPayload,
} from '../background/mesh-client';

const DEFAULT_URL = 'http://localhost:3000';

export default function NexscopeSettings(): JSX.Element {
  const [url, setUrl] = useState<string>(DEFAULT_URL);
  const [secret, setSecret] = useState<string>('');
  const [loaded, setLoaded] = useState<boolean>(false);
  const [testing, setTesting] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [saved, setSaved] = useState<boolean>(false);

  // Load saved values on mount — runs once.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await readNexscopeSettings();
        if (cancelled) return;
        setUrl(s.url || DEFAULT_URL);
        setSecret(s.secret);
      } catch (e) {
        console.warn('[NexscopeSettings] load failed', e);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave(): Promise<void> {
    setSaving(true);
    try {
      await writeNexscopeSettings({
        url: url.trim().replace(/\/+$/, ''),
        secret,
      });
      setSaved(true);
      // Auto-clear the "saved" badge after 2s.
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setTestResult(`Error al guardar: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(): Promise<void> {
    setTesting(true);
    setTestResult(null);
    try {
      // Persist first so the test uses the values the user just typed.
      await writeNexscopeSettings({
        url: url.trim().replace(/\/+$/, ''),
        secret,
      });
      const result = await sendToNexscope(buildPingPayload());
      if (result.ok) {
        setTestResult(
          `✅ Conectado (HTTP ${result.status}${result.signalId ? `, signal ${result.signalId.slice(0, 8)}` : ''})`,
        );
      } else {
        setTestResult(
          `❌ ${result.error}${result.status ? ` (HTTP ${result.status})` : ''}`,
        );
      }
    } catch (e) {
      setTestResult(`❌ Excepción: ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  }

  // Don't render the form until the stored values have loaded —
  // otherwise the user sees the defaults briefly before they get
  // overwritten by the async load.
  if (!loaded) {
    return (
      <div className="nexscope-settings" style={{ padding: '12px', opacity: 0.6 }}>
        Cargando ajustes…
      </div>
    );
  }

  return (
    <div
      className="nexscope-settings"
      style={{
        padding: '12px',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        marginTop: '12px',
        background: '#fafafa',
        fontSize: '13px',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: '8px' }}>
        🔗 Conexión NEX-SCOPE
      </div>

      <label style={{ display: 'block', marginBottom: '4px', color: '#374151' }}>
        URL de NEX-SCOPE
      </label>
      <input
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder={DEFAULT_URL}
        style={{
          width: '100%',
          padding: '6px 8px',
          border: '1px solid #d1d5db',
          borderRadius: '4px',
          marginBottom: '10px',
          fontSize: '13px',
          boxSizing: 'border-box',
        }}
      />

      <label style={{ display: 'block', marginBottom: '4px', color: '#374151' }}>
        CAZADOR_WEBHOOK_SECRET
      </label>
      <input
        type="password"
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        placeholder="(vacío = modo dev abierto)"
        style={{
          width: '100%',
          padding: '6px 8px',
          border: '1px solid #d1d5db',
          borderRadius: '4px',
          marginBottom: '10px',
          fontSize: '13px',
          boxSizing: 'border-box',
        }}
        autoComplete="off"
        spellCheck={false}
      />

      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={{
            flex: 1,
            padding: '6px 10px',
            background: '#111827',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: saving ? 'wait' : 'pointer',
            fontSize: '13px',
          }}
        >
          {saving ? 'Guardando…' : saved ? '✓ Guardado' : 'Guardar'}
        </button>
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          style={{
            flex: 1,
            padding: '6px 10px',
            background: '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: testing ? 'wait' : 'pointer',
            fontSize: '13px',
          }}
        >
          {testing ? 'Probando…' : 'Probar conexión'}
        </button>
      </div>

      {testResult && (
        <div
          style={{
            padding: '6px 8px',
            background: '#f3f4f6',
            borderRadius: '4px',
            fontSize: '12px',
            color: '#111827',
            wordBreak: 'break-word',
          }}
        >
          {testResult}
        </div>
      )}

      <div
        style={{
          marginTop: '8px',
          fontSize: '11px',
          color: '#6b7280',
          lineHeight: 1.4,
        }}
      >
        El secreto debe ser idéntico al <code>CAZADOR_WEBHOOK_SECRET</code> del
        <code> .env.local </code> de NEX-SCOPE. Logueate en NEX-SCOPE en este
        navegador para que la cookie JWT viaje con los requests.
      </div>
    </div>
  );
}
