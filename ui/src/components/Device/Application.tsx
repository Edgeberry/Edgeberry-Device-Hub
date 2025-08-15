import React from 'react';

export default function Application(props:{ info:any, onRestart:()=>void, onStop:()=>void, onRefresh:()=>void, busy?:boolean }){
  const { info, onRestart, onStop, onRefresh, busy } = props;
  const state = info?.payload?.state || 'unknown';
  const version = info?.payload?.version || info?.version || 'n/a';
  return (
    <div>
      <div className="mb-2 d-flex align-items-center gap-2">
        <button className="btn btn-sm btn-outline-primary" onClick={onRestart} disabled={!!busy}>Restart App</button>
        <button className="btn btn-sm btn-outline-secondary" onClick={onStop} disabled={!!busy}>Stop App</button>
        <button className="btn btn-sm btn-outline-success" onClick={onRefresh} disabled={!!busy}>Refresh Info</button>
      </div>
      <div className="mb-2">
        <strong>State:</strong> {state} &nbsp; | &nbsp; <strong>Version:</strong> {version}
      </div>
      <pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(info || { message:'No app info' }, null, 2)}</pre>
    </div>
  );
}
