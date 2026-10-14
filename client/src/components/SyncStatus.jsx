export default function SyncStatus({ status, error, onSync, disabled = false }) {
  const label = status === 'syncing' ? 'Syncing…' : status === 'success' ? 'Synced' : 'Sync sources';
  return (
    <div className="sync-area">
      <div className={`sync-status sync-status-${status}`} role={status === 'error' ? 'alert' : undefined}><span className="sync-indicator" aria-hidden="true" /><span>{label}</span></div>
      {error && <p className="sync-error">{error.message}</p>}
      {disabled && <p className="sync-unavailable">Source sync is unavailable in this deployment.</p>}
      <div className="sync-actions">
        {!disabled && <>
          <button type="button" onClick={() => onSync('canvas')} disabled={status === 'syncing'}>Sync Canvas</button>
          <button type="button" onClick={() => onSync('googleCalendar')} disabled={status === 'syncing'}>Sync Calendar</button>
        </>}
      </div>
    </div>
  );
}
