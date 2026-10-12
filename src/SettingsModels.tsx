import { Check, CircleHelp } from 'lucide-react';
import { MODELS, type ModelId } from './data';

export default function SettingsModels({ modelId, setModelId, notify }: { modelId: ModelId; setModelId: (id: ModelId) => void; notify: (message: string) => void }) {
  return <section className="settings-section settings-models">
    <div className="settings-heading"><h2>Models</h2><p>Choose a default model profile. Multipliers show relative usage.</p></div>
    <div className="model-table">
      <div className="model-table-head"><span>MODEL / ROLE</span><span>PROFILE</span><span>SPEED / DEPTH</span><span>MULTIPLIER</span><span/></div>
      {MODELS.map(model => <div className={`model-table-row ${modelId === model.id ? 'model-selected' : ''}`} key={model.id}>
        <div className="model-identity"><span className={`gem gem-${model.tone}`}>◆</span><span><b>{model.name}</b><small>{model.role}</small></span></div>
        <div className="model-description">{model.description}<div className="capability-tags">{model.harness.slice(0, 3).map(item => <span key={item}>{item}</span>)}</div></div>
        <div className="model-speed"><b>{model.speed}</b><small>{model.depth}</small></div>
        <div className="model-cost">× {model.multiplier}<small>relative usage</small></div>
        <button className={modelId === model.id ? 'outline-btn compact' : 'select-model-btn'} onClick={() => { setModelId(model.id); notify(`${model.name} selected as default`); }}>{modelId === model.id ? <><Check size={13}/>Selected</> : 'Select'}</button>
      </div>)}
    </div>
    <p className="small-disclaimer"><CircleHelp size={13}/>Profiles describe intended specializations. They are not measured performance claims.</p>
  </section>;
}
