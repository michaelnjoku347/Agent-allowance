import { useState } from 'react';
import { day, money, toUnits } from '../format.js';
import { status } from '../ledger.js';
import { SearchIcon } from '../icons.jsx';
import { merchantName } from '../ui/bits.jsx';
import { ActivityList } from './Home.jsx';

const FILTERS = [
  ['all', 'All'],
  ['paid', 'Paid'],
  ['waiting', 'Waiting'],
  ['blocked', 'Blocked'],
];

function sum(items) {
  return items.reduce((total, item) => total + (toUnits(item.amount) ?? 0n), 0n);
}

export default function Activity({ ledger, filter, setFilter, onOpen }) {
  const [query, setQuery] = useState('');
  const counts = { all: ledger.activity.length, paid: 0, waiting: 0, blocked: 0 };
  const byKey = { paid: [], waiting: [], blocked: [] };
  for (const item of ledger.activity) {
    const key = status(item).key;
    counts[key] = (counts[key] ?? 0) + 1;
    (byKey[key] ??= []).push(item);
  }
  const q = query.trim().toLowerCase();
  const shown = ledger.activity.filter((item) => (
    (filter === 'all' || status(item).key === filter)
    && (!q || `${merchantName(item)} ${item.task ?? ''} ${item.amount}`.toLowerCase().includes(q))
  ));
  const groups = [];
  for (const item of shown) {
    const label = day(item.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }

  return (
    <div className="activity-screen">
      <header className="screen-head">
        <p className="eyebrow">Every quote the agent saw</p>
        <h1>Activity</h1>
      </header>

      <dl className="tiles">
        <div className="tile ok">
          <dt>Paid</dt>
          <dd>
            {money(sum(byKey.paid))}
            <span className="tile-note">{counts.paid} purchase{counts.paid === 1 ? '' : 's'}</span>
          </dd>
        </div>
        <div className="tile warn">
          <dt>Waiting</dt>
          <dd>
            {money(sum(byKey.waiting))}
            <span className="tile-note">{counts.waiting} for you</span>
          </dd>
        </div>
        <div className="tile danger">
          <dt>Blocked</dt>
          <dd>
            {money(sum(byKey.blocked))}
            <span className="tile-note">{counts.blocked} declined</span>
          </dd>
        </div>
      </dl>

      <div className="filter-bar">
        <label className="search">
          <SearchIcon size={18} />
          <span className="sr-only">Search activity</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search merchant or task" />
        </label>
        <div className="segmented" role="group" aria-label="Filter activity">
          {FILTERS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={filter === id ? 'seg is-on' : 'seg'}
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
              <span className="seg-count">{counts[id]}</span>
            </button>
          ))}
        </div>
      </div>

      <p className="sr-only" role="status">{shown.length} result{shown.length === 1 ? '' : 's'}</p>
      {groups.length === 0 ? (
        <section className="panel">
          <p className="empty-copy">
            {q ? `Nothing matches “${query}”.` : filter === 'all' ? 'No purchases yet. Run the agent, or ask Eve what to do next.' : `Nothing is ${filter} right now.`}
          </p>
        </section>
      ) : groups.map((group) => (
        <section key={group.label} className="panel" aria-label={group.label}>
          <h2 className="group-title">{group.label}</h2>
          <ActivityList items={group.items} onOpen={onOpen} />
        </section>
      ))}
    </div>
  );
}
