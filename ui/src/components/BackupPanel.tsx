/**
 * Export/import of {secretKey, runs} — losing the nonce makes a sealed score
 * unrevealable forever, so "Back up your reveals" is a first-class feature.
 */

import { useState } from 'react';
import { LS_RUNS, LS_SECRET_KEY } from '../config';

export const BackupPanel = () => {
  const [blob, setBlob] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const doExport = () => {
    const payload = {
      v: 1,
      secretKey: localStorage.getItem(LS_SECRET_KEY),
      runs: JSON.parse(localStorage.getItem(LS_RUNS) ?? '{}'),
      exportedAt: new Date().toISOString(),
    };
    const text = JSON.stringify(payload, null, 2);
    setBlob(text);
    navigator.clipboard?.writeText(text).catch(() => undefined);
    setMsg({ ok: true, text: 'Backup copied to clipboard (and shown below). Store it somewhere safe.' });
  };

  const doImport = () => {
    try {
      const parsed = JSON.parse(blob);
      if (!parsed.secretKey || typeof parsed.secretKey !== 'string' || parsed.secretKey.length !== 64) {
        throw new Error('backup is missing a valid secretKey');
      }
      const existing = localStorage.getItem(LS_SECRET_KEY);
      if (existing && existing !== parsed.secretKey) {
        if (
          !window.confirm(
            'This backup contains a DIFFERENT identity than the one on this device. ' +
              'Importing replaces your current secret key — any un-backed-up sealed runs on the ' +
              'current identity become unrevealable. Continue?',
          )
        ) {
          return;
        }
      }
      localStorage.setItem(LS_SECRET_KEY, parsed.secretKey);
      localStorage.setItem(LS_RUNS, JSON.stringify(parsed.runs ?? {}));
      setMsg({ ok: true, text: 'Backup imported. Reload the page to use the restored identity.' });
    } catch (err) {
      setMsg({ ok: false, text: `Import failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  };

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="row">
        <strong>Back up your reveals</strong>
        <span className="spacer" />
        <button className="btn small" onClick={doExport}>
          Export
        </button>
        <button className="btn small ghost" onClick={doImport}>
          Import
        </button>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Your secret key and per-tournament reveal nonces live only in this browser. If they're
        lost, sealed scores can never be revealed or turned into badges. Export before clearing
        storage or switching devices.
      </p>
      <textarea
        className="backup"
        placeholder="Exported backup appears here — or paste one to import."
        value={blob}
        onChange={(e) => setBlob(e.target.value)}
        spellCheck={false}
      />
      {msg && <div className={msg.ok ? 'ok-banner' : 'error-banner'}>{msg.text}</div>}
    </div>
  );
};
