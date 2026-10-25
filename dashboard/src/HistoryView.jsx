import { useId, useMemo } from 'react';
import { money } from './format.js';
import { downloadCsv, filterHistory, historyTotals, isFiltered, merchantOptions, normalizeFilters, PERIODS, STATUS_FILTERS } from './history.js';
import { IconReceipt } from './icons.jsx';
import { ActivityList, EmptyState } from './rows.jsx';

/**
 * Spending history with filters and CSV export. Filters live in the parent so
 * Eve can set them ("show blocked purchases from Market Desk").
 */
export default function HistoryView({ items, filters, onFilters, onOpen, flashId, onExported, onRun }) {
  const searchId = useId();
  const merchantId = useId();
  const periodId = useId();
  const f = normalizeFilters(filters);
  const shown = useMemo(() => filterHistory(items, f), [items, f.status, f.merchant, f.query, f.period]);
  const totals = historyTotals(shown);
  const allTotals = historyTotals(items);
  const merchants = merchantOptions(items);
  const filtered = isFiltered(f);
  const set = (patch) => onFilters({ ...f, ...patch });

  function onStatusKey(event) {
    const ids = STATUS_FILTERS.map(([id]) => id);
    const at = ids.indexOf(f.status);
    const next = event.key === 'ArrowRight' ? ids[(at + 1) % ids.length]
      : event.key === 'ArrowLeft' ? ids[(at - 1 + ids.length) % ids.length]
        : event.key === 'Home' ? ids[0]
          : event.key === 'End' ? ids[ids.length - 1]
            : null;
    if (!next) return;
    event.preventDefault();
    set({ status: next });
    event.currentTarget.querySelector(`[data-status="${next}"]`)?.focus();
  }

  function exportCsv() {
    const name = downloadCsv(shown);
    onExported?.(`${shown.length} row${shown.length === 1 ? '' : 's'} saved to ${name}.`);
  }

  const countFor = (id) => (id === 'all' ? allTotals.count : allTotals.counts[id]);

  return (
    <section className="card history activity-wide" aria-labelledby="page-title">
      <div className="history-bar">
        <div className="segmented" role="radiogroup" aria-label="Show" onKeyDown={onStatusKey}>
          {STATUS_FILTERS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              data-status={id}
              aria-checked={f.status === id}
              tabIndex={f.status === id ? 0 : -1}
              className={f.status === id ? 'seg is-on' : 'seg'}
              onClick={() => set({ status: id })}
            >
              <span>{label}</span>
              <span className="seg-count">{countFor(id)}</span>
            </button>
          ))}
        </div>
        <div className="history-fields">
          <label className="field field-search" htmlFor={searchId}>
            <span className="field-label">Search</span>
            <input
              id={searchId}
              type="search"
              placeholder="Merchant, task, reason, or tx hash"
              value={f.query}
              maxLength={120}
              onChange={(event) => set({ query: event.target.value })}
            />
          </label>
          <label className="field" htmlFor={merchantId}>
            <span className="field-label">Merchant</span>
            <select id={merchantId} value={f.merchant} onChange={(event) => set({ merchant: event.target.value })}>
              <option value="all">All merchants</option>
              {merchants.map((row) => (
                <option key={row.value} value={row.value}>{row.label} ({row.count})</option>
              ))}
            </select>
          </label>
          <label className="field" htmlFor={periodId}>
            <span className="field-label">When</span>
            <select id={periodId} value={f.period} onChange={(event) => set({ period: event.target.value })}>
              {PERIODS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="history-summary">
        <p aria-live="polite">
          <strong>{filtered ? `${totals.count} of ${allTotals.count}` : `${totals.count}`}</strong> purchase{totals.count === 1 ? '' : 's'}
          <span className="sum-sep" aria-hidden="true">·</span>
          <span className="sum-paid">{money(totals.paid)} paid</span>
          <span className="sum-sep" aria-hidden="true">·</span>
          <span className="sum-wait">{money(totals.waiting)} waiting</span>
          <span className="sum-sep" aria-hidden="true">·</span>
          <span className="sum-block">{money(totals.blocked)} blocked</span>
          <span className="sum-unit"> RLUSD</span>
        </p>
        <div className="history-actions">
          {filtered ? <button type="button" className="btn text" onClick={() => onFilters({ ...normalizeFilters({}) })}>Clear filters</button> : null}
          <button type="button" className="btn" onClick={exportCsv} disabled={shown.length === 0}>Export CSV</button>
        </div>
      </div>

      <ActivityList
        items={shown}
        flashId={flashId}
        onOpen={onOpen}
        empty={filtered ? (
          <EmptyState
            icon={<IconReceipt />}
            title="Nothing matches these filters"
            action={<button type="button" className="btn" onClick={() => onFilters(normalizeFilters({}))}>Clear filters</button>}
          >
            Try a different merchant, a longer time range, or fewer words.
          </EmptyState>
        ) : (
          <EmptyState
            icon={<IconReceipt />}
            title="No payments yet"
            action={onRun ? <button type="button" className="btn" onClick={onRun}>Run agent</button> : null}
          >
            Run the agent, or ask Eve what to do next.
          </EmptyState>
        )}
      />
    </section>
  );
}
