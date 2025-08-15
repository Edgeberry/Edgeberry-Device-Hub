import React, { useEffect, useState } from 'react';

export default function Connection(props:{ online?: boolean, connectionInfo?: any, onReconnect:()=>void, onRefresh:()=>void, onUpdate:(parameters:any)=>void, busy?: boolean }){
  const { online, connectionInfo, onReconnect, onRefresh, onUpdate, busy } = props;
  const [broker, setBroker] = useState('');
  const [clientId, setClientId] = useState('');

  useEffect(()=>{
    const payload = connectionInfo?.payload || connectionInfo || {};
    if(typeof payload.broker === 'string') setBroker(payload.broker);
    if(typeof payload.clientId === 'string') setClientId(payload.clientId);
  },[connectionInfo]);

  const onSave = (e:React.FormEvent)=>{ e.preventDefault(); onUpdate({ broker, clientId }); };

  return (
    <div>
      <div className="mb-3 d-flex align-items-center gap-2">
        <span className={`badge bg-${online ? 'success' : 'secondary'}`}>{online ? 'Online' : 'Offline'}</span>
        <button className="btn btn-sm btn-secondary" onClick={onReconnect} disabled={!!busy}>Reconnect</button>
        <button className="btn btn-sm btn-outline-success" onClick={onRefresh} disabled={!!busy}>Refresh Info</button>
      </div>

      <form onSubmit={onSave} className="mb-2">
        <div className="row g-3 align-items-end">
          <div className="col-sm-6">
            <label className="form-label">Broker</label>
            <input className="form-control" value={broker} onChange={e=> setBroker(e.target.value)} placeholder="mqtt://host:1883" />
          </div>
          <div className="col-sm-6">
            <label className="form-label">Client ID</label>
            <input className="form-control" value={clientId} onChange={e=> setClientId(e.target.value)} placeholder="device-123" />
          </div>
          <div className="col-12">
            <button type="submit" className="btn btn-primary btn-sm" disabled={!!busy}>Save Connection</button>
          </div>
        </div>
      </form>

      <details>
        <summary>Raw Connection Response</summary>
        <pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(connectionInfo || { message:'No connection info' }, null, 2)}</pre>
      </details>
    </div>
  );
}
