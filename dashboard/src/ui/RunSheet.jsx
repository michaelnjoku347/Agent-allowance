import { useState } from 'react';
import { runAgent } from '../api.js';
import { money } from '../format.js';
import { BoltIcon, PlayIcon, ShieldIcon } from '../icons.jsx';
import Sheet from './Sheet.jsx';

const PRESETS = [
  'Buy the morning market brief',
  'Get route weather for the field team',
  'Pull a market data snapshot',
];

/** Pick a task and start the agent. The agent decides; this only starts it. */
export default function RunSheet({ open, onClose, ledger, onStarted }) {
  const [task, setTask] = useState(PRESETS[0]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  async function start(event) {
    event.preventDefault();
    const text = task.trim();
    if (!text) return;
    setBusy(true);
    setProblem(null);
    try {
      const body = await runAgent(text);
      if (body.ok) {
        onStarted(body.task || text);
        onClose();
      } else {
        setProblem({ demo: Boolean(body.demo), text: body.error || 'The agent did not start.' });
      }
    } catch (error) {
      setProblem({ demo: false, text: error.message || 'Could not start the agent.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Run the agent" subtitle="It only pays if the quote fits your rules.">
      <form className="run-form" onSubmit={start}>
        <fieldset className="presets">
          <legend className="mini-h">Pick a task</legend>
          {PRESETS.map((preset) => (
            <label key={preset} className={task === preset ? 'preset is-on' : 'preset'}>
              <input type="radio" name="task" value={preset} checked={task === preset} onChange={() => setTask(preset)} />
              <BoltIcon size={18} />
              <span>{preset}</span>
            </label>
          ))}
        </fieldset>
        <label className="field">
          <span className="mini-h">Or describe it</span>
          <input value={task} onChange={(event) => setTask(event.target.value)} maxLength={180} placeholder="What should the agent buy?" />
        </label>

        <div className="guard">
          <ShieldIcon size={20} />
          <p>
            Up to <strong>{money(ledger.cap)}</strong> per purchase, <strong>{money(ledger.left)}</strong> left.
            Anything over the cap, from a merchant not on the list, or flagged by Jev waits for you.
          </p>
        </div>

        {problem ? (
          <div className={problem.demo ? 'banner info' : 'banner warn'} role="alert">
            <p>
              {problem.demo ? <strong>Wallet not set up yet. </strong> : null}
              {problem.text}
            </p>
          </div>
        ) : null}

        <button type="submit" className="btn primary big" disabled={busy || !task.trim()}>
          <PlayIcon size={20} /> {busy ? 'Starting…' : 'Start agent'}
        </button>
      </form>
    </Sheet>
  );
}
