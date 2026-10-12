import { CircleHelp, Plus } from 'lucide-react';
import { MODELS, type Session } from './data';

export default function UsagePage({ sessions, setModal }: { sessions: Session[]; setModal: (mode: string) => void }) {
  const completed = sessions.filter(session => session.completed).slice(0, 12);
  return <div className="page-view">
    <div className="page-heading"><div><div className="page-kicker">WORKSPACE</div><h1>Usage</h1><p>Relative model factors and completed research runs.</p></div><button className="outline-btn" onClick={() => setModal('buy')}><Plus size={14}/>Add demo capacity</button></div>
    <div className="section-heading"><div><h2>Research history</h2><p>Usage is shown as a relative model factor; no raw allowance totals are displayed.</p></div></div>
    <div className="usage-table">
      <div className="usage-head"><span>INVESTIGATION</span><span>MODEL</span><span>MODE</span><span>DATE</span><span>FACTOR</span></div>
      {completed.length ? completed.map(session => {
        const model = MODELS.find(item => item.id === session.modelId)!;
        return <div className="usage-row" key={session.id}><span><b>{session.title}</b><small>{session.id}</small></span><span>{model.name}</span><span>{session.mode}</span><span>{session.date}</span><code>× {model.multiplier}</code></div>;
      }) : <div className="usage-empty">Completed investigations will appear here.</div>}
    </div>
    <p className="small-disclaimer"><CircleHelp size={13}/> Multipliers compare model profiles. The final effort also depends on research mode and verification.</p>
  </div>;
}
