import React, { useEffect, useState } from 'react';
import { Button, Modal, Tab, Tabs, Alert, Spinner } from 'react-bootstrap';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLocationDot, faPowerOff } from '@fortawesome/free-solid-svg-icons';
import { getDevice, getDeviceEvents, decommissionDevice, deleteWhitelistByDevice } from '../api/devicehub';
import StatusIndicator from './StatusIndicator';
import ApplicationPanel from './Device/Application';
import ConnectionPanel from './Device/Connection';
import SystemPanel from './Device/System';
import {
  direct_identifySystem,
  direct_restartSystem,
  direct_restartApplication,
  direct_stopApplication,
  direct_reconnect,
  direct_reprovision,
  direct_getApplicationInfo,
  direct_getSystemApplicationInfo,
  direct_getSystemNetworkInfo,
  direct_getConnectionParameters,
  direct_updateConnectionParameters,
  direct_getProvisioningParameters,
  direct_updateProvisioningParameters
} from '../api/directMethods';

export default function DeviceDetailModal(props:{
  deviceId: string,
  show: boolean,
  onClose: ()=>void,
}){
  const { deviceId, show, onClose } = props;
  const [device, setDevice] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{text:string,type:'success'|'danger'|''}>({text:'',type:''});
  const [info, setInfo] = useState<any>(null);
  const [disabled, setDisabled] = useState(false);

  useEffect(()=>{
    let mounted = true;
    (async()=>{
      if(!deviceId) return;
      try{ const d = await getDevice(deviceId); if(mounted) setDevice(d); }catch{}
      try{ const e = await getDeviceEvents(deviceId); if(mounted) setEvents(Array.isArray(e?.events)? e.events : []); }catch{}
    })();
    return ()=>{ mounted=false; };
  },[deviceId, show]);

  useEffect(()=>{
    if(!msg.text) return; const t = setTimeout(()=> setMsg({text:'',type:''}), 3000); return ()=> clearTimeout(t);
  },[msg]);

  async function onIdentify(){
    try{
      setBusy(true);
      const r = await direct_identifySystem(deviceId);
      setMsg({ text: r?.message || 'Identify requested', type: r?.ok===false ? 'danger' : 'success' });
    }catch(err:any){ setMsg({ text: err?.toString?.()||'Failed to identify', type:'danger'});} finally{ setBusy(false); }
  }
  async function onReboot(){
    if(!window.confirm('Restart system?')) return;
    try{
      setBusy(true); setDisabled(true);
      const r = await direct_restartSystem(deviceId);
      setMsg({ text: r?.message || 'Restart requested', type: r?.ok===false ? 'danger' : 'success' });
    }catch(err:any){ setMsg({ text: err?.toString?.()||'Failed to restart', type:'danger'});} finally{ setBusy(false); setDisabled(false); }
  }

  // auto fetch info when opening
  useEffect(()=>{ if(show && deviceId){ onFetchInfos(); } }, [show, deviceId]);

  async function onRestartApp(){
    try{ setBusy(true); const r = await direct_restartApplication(deviceId); setMsg({ text:r?.message||'App restart requested', type: r?.ok===false?'danger':'success' }); }
    catch(err:any){ setMsg({ text: err?.toString?.()||'Failed to restart app', type:'danger'});} finally{ setBusy(false); }
  }
  async function onStopApp(){
    try{ setBusy(true); const r = await direct_stopApplication(deviceId); setMsg({ text:r?.message||'App stop requested', type: r?.ok===false?'danger':'success' }); }
    catch(err:any){ setMsg({ text: err?.toString?.()||'Failed to stop app', type:'danger'});} finally{ setBusy(false); }
  }
  async function onReconnect(){
    try{ setBusy(true); const r = await direct_reconnect(deviceId); setMsg({ text:r?.message||'Reconnect requested', type: r?.ok===false?'danger':'success' }); }
    catch(err:any){ setMsg({ text: err?.toString?.()||'Failed to reconnect', type:'danger'});} finally{ setBusy(false); }
  }
  async function onReprovision(){
    if(!window.confirm('Reprovision device?')) return;
    try{ setBusy(true); const r = await direct_reprovision(deviceId); setMsg({ text:r?.message||'Reprovision requested', type: r?.ok===false?'danger':'success' }); }
    catch(err:any){ setMsg({ text: err?.toString?.()||'Failed to reprovision', type:'danger'});} finally{ setBusy(false); }
  }
  async function onFetchInfos(){
    try{
      setBusy(true);
      const [app, sys, net, conn, prov] = await Promise.all([
        direct_getApplicationInfo(deviceId),
        direct_getSystemApplicationInfo(deviceId),
        direct_getSystemNetworkInfo(deviceId),
        direct_getConnectionParameters(deviceId),
        direct_getProvisioningParameters(deviceId)
      ]);
      setInfo({ app, sys, net, conn, prov });
      setMsg({ text:'Info fetched', type:'success' });
    }catch(err:any){ setMsg({ text: err?.toString?.()||'Failed to fetch info', type:'danger'});} finally{ setBusy(false); }
  }

  async function onUpdateConnection(parameters:any){
    try{
      setBusy(true);
      const r = await direct_updateConnectionParameters(deviceId, parameters);
      setMsg({ text: r?.message || 'Connection parameters updated', type: r?.ok===false?'danger':'success' });
      await onFetchInfos();
    }catch(err:any){ setMsg({ text: err?.toString?.()||'Failed to update connection', type:'danger'});} finally{ setBusy(false); }
  }

  async function onUpdateProvisioning(parameters:any){
    try{
      setBusy(true);
      const r = await direct_updateProvisioningParameters(deviceId, parameters);
      setMsg({ text: r?.message || 'Provisioning parameters updated', type: r?.ok===false?'danger':'success' });
      await onFetchInfos();
    }catch(err:any){ setMsg({ text: err?.toString?.()||'Failed to update provisioning', type:'danger'});} finally{ setBusy(false); }
  }

  async function onDecommission(){
    if(!window.confirm('Decommission this device? This will remove it from the device list.')) return;
    try{
      setBusy(true); setDisabled(true);
      const res:any = await decommissionDevice(deviceId);
      const wlCount = Number(res?.whitelist_entries || 0);
      if (wlCount > 0) {
        const doWipe = window.confirm(`There are ${wlCount} whitelist entr${wlCount===1?'y':'ies'} for this device. Remove them now?`);
        if (doWipe) {
          await deleteWhitelistByDevice(deviceId);
        }
      }
      // Close the modal after successful decommission
      onClose();
    }catch(err:any){
      setMsg({ text: err?.toString?.() || 'Failed to decommission device', type: 'danger' });
    } finally{
      setBusy(false); setDisabled(false);
    }
  }

  return (
    <Modal show={show} onHide={onClose} size="xl" centered scrollable>
      <Modal.Header closeButton>
        <div style={{ width: '100%' }}>
          <div style={{ float: 'right' }}>
            <Button variant={'primary'} className="mb-2 me-2" onClick={onIdentify} disabled={disabled}>
              <FontAwesomeIcon icon={faLocationDot} />
            </Button>
            <Button variant={'danger'} className="mb-2" onClick={onReboot} disabled={disabled}>
              <FontAwesomeIcon icon={faPowerOff} />
            </Button>
          </div>
          <Modal.Title>{device?.name || deviceId}</Modal.Title>
          {device?.uuid && device?.uuid !== deviceId && (
            <div className="text-muted small">UUID: {device.uuid}</div>
          )}
          <div className="text-subtitle">{info?.sys?.payload?.platform || 'No hardware platform'}</div>
        </div>
      </Modal.Header>
      <Modal.Body>
        {msg.text && (<Alert variant={msg.type==='danger'?'danger':'success'}>{msg.text}</Alert>)}
        {!device && (<div className="text-center p-4"><Spinner animation="border" size="sm"/> Loading...</div>)}
        <Tabs defaultActiveKey="application" className="mb-3">
          <Tab eventKey="application" title={<><StatusIndicator noText type={(info?.app?.payload?.state==='ok')?'success':'secondary'} /> Application</>}>
            <ApplicationPanel info={info?.app} onRestart={onRestartApp} onStop={onStopApp} onRefresh={onFetchInfos} busy={busy} />
          </Tab>
          <Tab eventKey="connection" title={<><StatusIndicator noText type={(device?.online)?'success':'secondary'} /> Connection</>}>
            <ConnectionPanel online={device?.online} connectionInfo={info?.conn} onReconnect={onReconnect} onRefresh={onFetchInfos} onUpdate={onUpdateConnection} busy={busy} />
          </Tab>
          <Tab eventKey="system" title={<><StatusIndicator noText type={'success'} /> System</>}>
            <SystemPanel info={info?.sys} provisioning={info?.prov} onReprovision={onReprovision} onRefresh={onFetchInfos} onUpdate={onUpdateProvisioning} busy={busy} />
            <hr/>
            <h6>Raw Device</h6>
            <pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(device, null, 2)}</pre>
            <h6>Events ({events.length||0})</h6>
            <div>
              {(events||[]).slice().reverse().map((e:any, i:number)=> (
                <pre key={i} className="mb-2" style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(e,null,2)}</pre>
              ))}
              {!events?.length && <div className="text-muted">No events</div>}
            </div>
          </Tab>
        </Tabs>
      </Modal.Body>
      <Modal.Footer>
        <Button variant={'outline-danger'} onClick={onDecommission} disabled={disabled || busy}>Decommission</Button>
        <Button variant={'secondary'} onClick={onClose} disabled={disabled}>Close</Button>
      </Modal.Footer>
    </Modal>
  );
}
