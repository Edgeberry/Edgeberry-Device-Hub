/**
 * DecommissionModal
 *
 * Taking a device out of service is two different intentions wearing one word:
 *
 *  - "this unit died, here is its replacement" - the application ID must live
 *    on, on new hardware. Retiring it would leave every application pointing at
 *    something that no longer exists.
 *  - "this unit is gone for good" - the application ID goes with it.
 *
 * A plain confirm dialog silently did the second, which is the destructive one
 * and, for a broken device being replaced, almost never what was meant. So ask,
 * and only offer the choice when the device actually holds an identity worth
 * preserving.
 */
import { Alert, Badge, Button, Modal, Spinner } from 'react-bootstrap';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRightLeft, faTrash } from '@fortawesome/free-solid-svg-icons';

type Device = { uuid: string; name?: string; role?: string|null; groups?: string[] };

export default function DecommissionModal(props:{
  show: boolean;
  onClose: ()=>void;
  device: Device | null;
  busy?: boolean;
  /** Open the swap flow instead - transfer the identity, then come back. */
  onSwapInstead: ()=>void;
  /** Remove the device and retire its application ID. */
  onDecommission: ()=>void|Promise<void>;
}){
  const { show, onClose, device, busy, onSwapInstead, onDecommission } = props;
  const role = device?.role;
  const groups = device?.groups || [];

  return (
    <Modal show={show} onHide={onClose} contentClassName="eb-modal-content">
      <Modal.Header closeButton closeVariant="white">
        <Modal.Title><FontAwesomeIcon icon={faTrash} />Decommission device</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="mb-2">
          Remove <span className="font-monospace">{device?.uuid}</span> from the registry.
        </p>

        {role ? (
          <>
            <Alert variant="warning">
              This device answers to <strong>{role}</strong>
              {groups.length > 0 && (
                <> in {groups.map(g => (
                  <Badge bg="secondary" key={g} className="me-1" style={{fontWeight:400}}>{g}</Badge>
                ))}</>
              )}.
              {' '}Decommissioning retires that application ID — anything addressing it stops resolving.
            </Alert>
            <p className="mb-1"><strong>Replacing this device?</strong></p>
            <p className="text-muted" style={{fontSize:'0.9em'}}>
              Transfer the identity to the replacement first. It keeps the same name and
              groups, so applications carry on unchanged — then this unit can be removed.
            </p>
          </>
        ) : (
          <p className="text-muted" style={{fontSize:'0.9em'}}>
            This device has no application ID, so nothing depends on its name.
          </p>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        {role && (
          <Button variant="primary" onClick={onSwapInstead} disabled={busy}>
            <FontAwesomeIcon icon={faRightLeft} /> Swap to replacement
          </Button>
        )}
        <Button variant="danger" onClick={onDecommission} disabled={busy}>
          {busy ? <Spinner size="sm" animation="border" /> : <FontAwesomeIcon icon={faTrash} />}
          {' '}{role ? 'Decommission and retire ' + role : 'Decommission'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
