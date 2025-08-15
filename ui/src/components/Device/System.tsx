import React, { useEffect, useState } from 'react';

export default function System(props:{ info:any, provisioning?: any, onReprovision:()=>void, onRefresh:()=>void, onUpdate:(parameters:any)=>void, busy?:boolean }){
  const { info, provisioning, onReprovision, onRefresh, onUpdate, busy } = props;
  const platform = info?.payload?.platform || info?.platform || 'unknown';
  const state = info?.payload?.state || info?.state || 'unknown';

  const [endpoint, setEndpoint] = useState('');
  const [thingName, setThingName] = useState('');

  useEffect(()=>{
    const payload = provisioning?.payload || provisioning || {};
    if(typeof payload.endpoint === 'string') setEndpoint(payload.endpoint);
    if(typeof payload.thingName === 'string') setThingName(payload.thingName);
  },[provisioning]);

  const onSave = (e:React.FormEvent)=>{ e.preventDefault(); onUpdate({ endpoint, thingName }); };

  return (
    <div>
      <div className="mb-2 d-flex align-items-center gap-2">
        <button className="btn btn-sm btn-warning" onClick={onReprovision} disabled={!!busy}>Reprovision</button>
        <button className="btn btn-sm btn-outline-success" onClick={onRefresh} disabled={!!busy}>Refresh Info</button>
      </div>

      <div className="mb-2">
        <strong>Platform:</strong> {platform} &nbsp; | &nbsp; <strong>State:</strong> {state}
      </div>

      <h6>Provisioning Parameters</h6>
      <form onSubmit={onSave} className="mb-2">
        <div className="row g-3 align-items-end">
          <div className="col-sm-6">
            <label className="form-label">Endpoint</label>
            <input className="form-control" value={endpoint} onChange={e=> setEndpoint(e.target.value)} placeholder="a1b23c4d5e.iot.region.amazonaws.com" />
          </div>
          <div className="col-sm-6">
            <label className="form-label">Thing Name</label>
            <input className="form-control" value={thingName} onChange={e=> setThingName(e.target.value)} placeholder="device-123" />
          </div>
          <div className="col-12">
            <button type="submit" className="btn btn-primary btn-sm" disabled={!!busy}>Save Provisioning</button>
          </div>
        </div>
      </form>

      <details>
        <summary>Raw System Response</summary>
        <pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(info || { message:'No system info' }, null, 2)}</pre>
      </details>
      <details>
        <summary>Raw Provisioning Response</summary>
        <pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(provisioning || { message:'No provisioning info' }, null, 2)}</pre>
      </details>
    </div>
  );
}
