import { useEffect, useState } from 'react';
import { AlertTriangle, CircleHelp, LoaderCircle } from 'lucide-react';
import { MODELS } from '../shared/models';
import type { UsageDTO } from '../shared/types';
import { api } from './api';

export default function UsagePage() {
  const [usage, setUsage] = useState<UsageDTO | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .getUsage()
      .then(response => {
        if (!cancelled) setUsage(response.usage);
      })
      .catch(caught => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load usage.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <div className="error-banner"><AlertTriangle size={15} /> {error}</div>;
  }

  if (!usage) {
    return <div className="loading-card"><LoaderCircle size={16} className="spin" /> Loading usage…</div>;
  }

  return (
    <div className="settings-section">
      <div className="section-heading">
        <div>
          <h2>Research history</h2>
          <p>Usage is tracked from provider token counts. No credit balance is displayed.</p>
        </div>
        {usage.totals.estimated && <span className="demo-chip">SOME TOKENS ESTIMATED</span>}
      </div>
      <div className="usage-stats">
        <div><span>Runs</span><b>{usage.totals.runs.toLocaleString()}</b></div>
        <div><span>Total tokens</span><b>{usage.totals.totalTokens.toLocaleString()}</b></div>
        <div><span>Input</span><b>{usage.totals.promptTokens.toLocaleString()}</b></div>
        <div><span>Output</span><b>{usage.totals.completionTokens.toLocaleString()}</b></div>
        <div><span>Search calls</span><b>{usage.totals.searchCount.toLocaleString()}</b></div>
      </div>
      {usage.byModel.length > 0 && (
        <div className="usage-model-grid">
          {usage.byModel.map(row => {
            const model = MODELS.find(item => item.id === row.modelId);
            return (
              <div className="usage-model-card" key={row.modelId}>
                <span className={`gem gem-${model?.tone ?? 'silver'}`}>◆</span>
                <span>
                  <b>{model?.name ?? row.modelId}</b>
                  <small>{row.runs} runs · {row.searchCount} searches</small>
                </span>
                <code>{row.totalTokens.toLocaleString()} tokens</code>
              </div>
            );
          })}
        </div>
      )}
      <div className="usage-table">
        <div className="usage-head">
          <span>INVESTIGATION</span><span>MODEL</span><span>MODE</span><span>DATE</span><span>TOKENS</span>
        </div>
        {usage.sessions.length ? (
          usage.sessions.map(session => {
            const model = MODELS.find(item => item.id === session.modelId);
            return (
              <div className="usage-row" key={session.id}>
                <span><b>{session.title}</b><small>{session.id}</small></span>
                <span>{model?.name ?? session.modelId}</span>
                <span>{session.mode}</span>
                <span>{session.date}</span>
                <code>{session.totalTokens.toLocaleString()}{session.estimated ? ' est.' : ''}</code>
              </div>
            );
          })
        ) : (
          <div className="usage-empty">Completed investigations will appear here.</div>
        )}
      </div>
      <p className="small-disclaimer">
        <CircleHelp size={13} /> Token counts come from provider responses when available. Estimated counts are clearly
        marked and are not provider invoices.
      </p>
    </div>
  );
}
