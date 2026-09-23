import React, { useEffect, useState } from 'react';
import { Button, Modal, Alert, Spinner } from 'react-bootstrap';
import { SectionLabel, Field } from './ui';
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
        {device?.uuid && <Field label="Hardware ID" value={device.uuid} mono />}
        {!device && (<div className="text-center p-4"><Spinner animation="border" size="sm"/> Loading…</div>)}
        {device && (
          <>
            <div className="mt-3"><SectionLabel>Device</SectionLabel></div>
            <pre className="eb-inset eb-mono mt-0" style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(device, null, 2)}</pre>

            <div className="mt-4"><SectionLabel>Events ({events.length||0})</SectionLabel></div>
            <div>
              {(events||[]).slice().reverse().map((e:any, i:number)=> (
                <pre key={i} className="eb-inset eb-mono mb-2" style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(e,null,2)}</pre>
              ))}
              {!events?.length && <div className="eb-subtle">No events</div>}
            </div>

            {/* Decommissioning lives with the content it acts on, not in the
                footer next to a dismiss button. "Close" is gone entirely -
                the header's X already does that, and a dialog does not need
                two ways to be dismissed. */}
            <div className="eb-danger-zone">
              <div>
                <div className="eb-section-title mb-1">Decommission</div>
                <div className="eb-muted" style={{ fontSize: '0.85rem' }}>
                  Removes this device from the registry. Its hardware ID can be whitelisted again later.
                </div>
              </div>
              <Button variant="outline-danger" onClick={onDecommission} disabled={busy}>
                {busy
                  ? <><Spinner animation="border" size="sm" className="me-2" />Removing…</>
                  : 'Decommission'}
              </Button>
            </div>
          </>
        )}
      </Modal.Body>
    </Modal>
  );
}
