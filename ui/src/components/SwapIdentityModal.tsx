/**
 * SwapIdentityModal
 *
 * Hardware swap: move a device's application identity - its role, and the
 * groups attached to that role - onto a different physical device.
 *
 * This is the "the unit died, here is its replacement" flow. It is deliberately
 * a picker rather than a text field: the identity being moved already exists,
 * so there is nothing to type, and typing it by hand into the other device's
 * role field (the only way to do this before) meant getting a name exactly
 * right with no indication that another device was about to lose it.
 *
 * What moves and what does not:
 *  - moves: the application ID, and its groups (they hang off the identity)
 *  - stays: each device's own telemetry and twin history, which belong to the
 *    hardware that produced them and are not rewritten
 */
import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Modal, Spinner } from 'react-bootstrap';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRightLeft } from '@fortawesome/free-solid-svg-icons';
import { setDeviceRole } from '../api/devicehub';

type Device = { uuid: string; name?: string; role?: string|null; groups?: string[]; online?: boolean };

export default function SwapIdentityModal(props:{
  show: boolean;
  onClose: ()=>void;
  /** The device whose identity is being handed over. */
  source: Device | null;
  /** Every known device, used to offer targets. */
  devices: Device[];
  /** Called after a successful transfer, with the target's uuid. */
  onSwapped: (targetUuid: string)=>void|Promise<void>;
}){
  const { show, onClose, source, devices, onSwapped } = props;
  const [targetUuid, setTargetUuid] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string|undefined>();

  // Candidates: anything that is not the source. Devices with no identity of
  // their own come first - a spare unit is the normal target, and picking one
  // that already has an identity costs it that identity.
  const candidates = useMemo(()=>{
    const list = (devices||[]).filter(d => d.uuid !== source?.uuid);
    return list.sort((a,b)=>{
      if (!!a.role !== !!b.role) return a.role ? 1 : -1;      // unassigned first
      if (!!a.online !== !!b.online) return a.online ? -1 : 1; // then online first
      return String(a.uuid).localeCompare(String(b.uuid));
    });
  }, [devices, source]);

  const target = candidates.find(d => d.uuid === targetUuid);

  const reset = () => { setTargetUuid(''); setError(undefined); setBusy(false); };
  const close = () => { reset(); onClose(); };

  const doSwap = async () => {
    if (!source?.role || !targetUuid) return;
    setBusy(true); setError(undefined);
    try{
      const res: any = await setDeviceRole(targetUuid, source.role);
      if (res && res.error) { setError(res.message || res.error); setBusy(false); return; }
      await onSwapped(targetUuid);
      reset();
      onClose();
    }catch(e:any){
      setError(e?.message || 'Transfer failed');
      setBusy(false);
    }
  };

  const groups = source?.groups || [];

  return (
    <Modal show={show} onHide={close} size='lg' scrollable contentClassName="eb-modal-content">
      <Modal.Header closeButton closeVariant="white">
        <Modal.Title><FontAwesomeIcon icon={faRightLeft} />Swap device</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {!source?.role ? (
          <Alert variant="warning" className="mb-0">
            This device has no application ID, so there is nothing to transfer.
            Assign one first.
          </Alert>
        ) : (
          <>
            <p className="mb-2">
              Move the application ID <strong>{source.role}</strong> to another device.
              Applications keep addressing it by that name, so the replacement takes
              over without anything on their side changing.
            </p>
            {groups.length > 0 && (
              <p className="mb-2">
                Its groups come along: {groups.map(g => (
                  <Badge bg="secondary" key={g} className="me-1" style={{fontWeight:400}}>{g}</Badge>
                ))}
              </p>
            )}
            <p className="text-muted" style={{fontSize:'0.9em'}}>
              Each device keeps its own history — telemetry and twin data stay with the
              hardware that produced them.
            </p>

            {candidates.length === 0 ? (
              <Alert variant="warning">
                There is no other device to transfer to. Provision the replacement first.
              </Alert>
            ) : (
              <>
                <div className="mb-2"><strong>Transfer to</strong></div>
                <div style={{maxHeight:'320px', overflowY:'auto'}}>
                  {candidates.map(d => (
                    <label
                      key={d.uuid}
                      className="d-flex align-items-center gap-2 p-2 border-bottom"
                      style={{cursor:'pointer'}}
                    >
                      <input
                        type="radio"
                        name="swap-target"
                        checked={targetUuid === d.uuid}
                        onChange={()=> setTargetUuid(d.uuid)}
                      />
                      <span className="flex-grow-1">
                        <span className="font-monospace" style={{fontSize:'0.9em'}}>{d.uuid}</span>
                        {d.role
                          ? <Badge bg="warning" text="dark" className="ms-2" style={{fontWeight:400}}>{d.role}</Badge>
                          : <span className="text-muted ms-2" style={{fontSize:'0.9em'}}>unassigned</span>}
                      </span>
                      <Badge bg={d.online ? 'success' : 'secondary'}>{d.online ? 'online' : 'offline'}</Badge>
                    </label>
                  ))}
                </div>
              </>
            )}

            {target?.role && (
              <Alert variant="warning" className="mt-3 mb-0">
                {target.uuid} already answers to <strong>{target.role}</strong>. Continuing
                replaces that — a device holds one application ID at a time, so it will
                give up its current one{(target.groups||[]).length ? ' and the groups on it' : ''}.
              </Alert>
            )}
            {error && <Alert variant="danger" className="mt-3 mb-0">{error}</Alert>}
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={close} disabled={busy}>Cancel</Button>
        <Button
          variant="primary"
          onClick={doSwap}
          disabled={busy || !source?.role || !targetUuid}
        >
          {busy ? <Spinner size="sm" animation="border" /> : <FontAwesomeIcon icon={faRightLeft} />}
          {' '}Transfer identity
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
