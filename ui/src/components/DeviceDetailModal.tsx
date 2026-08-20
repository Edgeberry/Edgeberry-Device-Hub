import React, { useEffect, useState } from 'react';
import { Button, Modal, Alert, Spinner } from 'react-bootstrap';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMicrochip } from '@fortawesome/free-solid-svg-icons';
import { getDevice, getDeviceEvents, decommissionDevice, deleteWhitelistByDevice } from '../api/devicehub';

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

  async function onDecommission(){
    if(!window.confirm('Decommission this device? This will remove it from the device list.')) return;
    try{
      setBusy(true);
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
      setBusy(false);
    }
  }

  return (
    <Modal show={show} onHide={onClose} size="lg" centered scrollable contentClassName="eb-modal-content">
      {/* Header is a bare Modal.Title, like every other modal here. It used to
          wrap the title in a div with the Hardware ID beneath it, which made
          this one header two lines tall while the rest were one - the identity
          line moved into the body instead.

          No role assigned yet: the hardware uuid is the only identity there is
          to show, so it takes the title rather than a vague "Unassigned"
          placeholder (that's fine in a table row of many devices, but this is
          the one place looking at a single device). */}
      <Modal.Header closeButton closeVariant="white">
        <Modal.Title><FontAwesomeIcon icon={faMicrochip} />{device ? (device.role || device.uuid) : deviceId}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {msg.text && (<Alert variant={msg.type==='danger'?'danger':'success'}>{msg.text}</Alert>)}
        {device?.uuid && (
          <div className="text-muted small mb-3">Hardware ID: {device.uuid}</div>
        )}
        {!device && (<div className="text-center p-4"><Spinner animation="border" size="sm"/> Loading...</div>)}
        {device && (
          <>
            <h6>Device</h6>
            <pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(device, null, 2)}</pre>
            <h6>Events ({events.length||0})</h6>
            <div>
              {(events||[]).slice().reverse().map((e:any, i:number)=> (
                <pre key={i} className="mb-2" style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(e,null,2)}</pre>
              ))}
              {!events?.length && <div className="text-muted">No events</div>}
            </div>
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant={'outline-danger'} onClick={onDecommission} disabled={busy}>Decommission</Button>
        <Button variant={'secondary'} onClick={onClose} disabled={busy}>Close</Button>
      </Modal.Footer>
    </Modal>
  );
}
