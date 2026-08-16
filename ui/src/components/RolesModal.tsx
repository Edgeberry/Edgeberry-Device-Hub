/**
 * RolesModal
 *
 * Admin-only modal to manage device roles: persistent, application-facing
 * labels that point at a device's uuid (see core-service's device_roles
 * table). Reassigning a role's uuid is how a hardware swap is represented -
 * the role name itself never changes, so anything built on top of it
 * (dashboards, Node-RED flows, WebSocket subscribers) keeps working across
 * both reprovisioning and a full device swap.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Badge, Button, Col, Form, Modal, Row, Spinner } from 'react-bootstrap';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTrash } from '@fortawesome/free-solid-svg-icons';
import { getRoles, createRole, reassignRole, deleteRole, getDevices } from '../api/devicehub';
import { displayNameFor } from '../deviceDisplay';

export default function RolesModal(props:{ show:boolean; onClose:()=>void; user:any|null }){
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|undefined>();
  const [roles, setRoles] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);

  // Create-role form state
  const [newRole, setNewRole] = useState('');
  const [newUuid, setNewUuid] = useState('');
  const [createBusy, setCreateBusy] = useState(false);

  const [rowBusy, setRowBusy] = useState<string|null>(null);

  useEffect(()=>{
    if (!props.show) return;
    let mounted = true;
    (async()=>{
      setLoading(true); setError(undefined);
      try{
        const [r, d] = await Promise.all([getRoles(), getDevices()]);
        if (mounted) {
          setRoles(Array.isArray(r?.roles) ? r.roles : []);
          setDevices(Array.isArray(d?.devices) ? d.devices : []);
        }
      }catch(e:any){ if(mounted) setError(e?.message || 'Failed to load roles'); }
      if (mounted) setLoading(false);
    })();
    return ()=>{ mounted = false; };
  },[props.show]);

  async function refresh(){
    try{
      const [r, d] = await Promise.all([getRoles(), getDevices()]);
      setRoles(Array.isArray(r?.roles) ? r.roles : []);
      setDevices(Array.isArray(d?.devices) ? d.devices : []);
    }catch{}
  }

  async function handleCreate(){
    if (!props.user) return;
    if (!newRole.trim() || !newUuid) { setError('Role name and device are required'); return; }
    setCreateBusy(true);
    try{
      const res = await createRole(newRole.trim(), newUuid);
      if (res?.ok){ setNewRole(''); setNewUuid(''); await refresh(); }
      else { setError(res?.error || 'Failed to create role'); }
    } finally { setCreateBusy(false); }
  }

  async function handleReassign(role: string, uuid: string){
    if (!props.user || !uuid) return;
    setRowBusy(role);
    try{
      const res = await reassignRole(role, uuid);
      if (res?.ok){ await refresh(); }
      else { setError(res?.error || 'Failed to reassign role'); }
    } finally { setRowBusy(null); }
  }

  async function handleDelete(role: string){
    if (!props.user) return;
    if (!confirm(`Delete role "${role}"? This does not affect the device itself.`)) return;
    setRowBusy(role);
    try{
      const res = await deleteRole(role);
      if (res?.ok){ await refresh(); }
      else { setError(res?.error || 'Failed to delete role'); }
    } finally { setRowBusy(null); }
  }

  // A device already holding a role is still a valid reassignment target for
  // a *different* role (the picker enforces nothing here - the backend's
  // uuid_already_has_role check is the real guard), but it's excluded from
  // the "create a new role" device list since that's the common case (giving
  // an unlabeled device its first role) and roleless devices are what you'd
  // be looking for there.
  const unroledDevices = devices.filter(d => !d.role);

  return (
    <Modal show={props.show} onHide={props.onClose} size='lg' scrollable contentClassName="eb-modal-content">
      <Modal.Header closeButton>
        <Modal.Title>Roles</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant='danger' dismissible onClose={()=>setError(undefined)}>{error}</Alert>}

        <Form onSubmit={(e)=>{e.preventDefault(); handleCreate();}} className="mb-3">
          <Row className='g-2 align-items-end'>
            <Col md={5}>
              <Form.Label>Role name</Form.Label>
              <Form.Control value={newRole} onChange={e=>setNewRole(e.target.value)} placeholder='e.g. greenhouse-temp-sensor' disabled={!props.user} />
            </Col>
            <Col md={5}>
              <Form.Label>Device</Form.Label>
              <Form.Select value={newUuid} onChange={e=>setNewUuid(e.target.value)} disabled={!props.user}>
                <option value=''>Select a device...</option>
                {unroledDevices.map(d => (
                  <option key={d.uuid} value={d.uuid}>{displayNameFor(d)}</option>
                ))}
              </Form.Select>
            </Col>
            <Col md={2}>
              <Button className='w-100' disabled={!props.user || createBusy} onClick={handleCreate} variant='success'>
                {createBusy ? <Spinner animation='border' size='sm'/> : 'Create'}
              </Button>
            </Col>
          </Row>
        </Form>

        <div style={{marginTop:12}}>
          {loading && roles.length===0 ? <Spinner animation='border' size='sm'/> : (
            <div style={{overflowX:'auto'}}>
              <table className='table table-sm'>
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Device</th>
                    <th>Status</th>
                    <th style={{width:260}} className='text-end'>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.length===0 ? (
                    <tr><td colSpan={4} style={{color:'#666'}}>No roles assigned yet.</td></tr>
                  ) : roles.map((r:any)=> (
                    <tr key={r.role} className='device-row'>
                      <td><strong>{r.role}</strong></td>
                      <td>
                        {r.device_name ? (
                          <>
                            {r.device_name}
                            <div className='text-muted small' style={{fontFamily:'monospace'}}>{r.uuid}</div>
                          </>
                        ) : (
                          <span className='text-muted' title={r.uuid}>device removed ({r.uuid.substring(0,8)}...)</span>
                        )}
                      </td>
                      <td>
                        <Badge bg={r.online ? 'success' : 'secondary'}>{r.online ? 'online' : 'offline'}</Badge>
                      </td>
                      <td className='text-end'>
                        <div className='d-flex gap-2 justify-content-end'>
                          <Form.Select
                            size='sm'
                            style={{width:180}}
                            value={r.uuid}
                            disabled={!props.user || rowBusy===r.role}
                            onChange={e=>handleReassign(r.role, e.target.value)}
                            title='Reassign this role to a different device'
                          >
                            <option value={r.uuid}>{r.device_name ? displayNameFor({...r, name:r.device_name}) : 'current device'}</option>
                            {devices.filter(d => d.uuid !== r.uuid).map(d => (
                              <option key={d.uuid} value={d.uuid}>{displayNameFor(d)}</option>
                            ))}
                          </Form.Select>
                          <button
                            type="button"
                            className="btn btn-sm btn-edgeberry"
                            onClick={()=>handleDelete(r.role)}
                            disabled={!props.user || rowBusy===r.role}
                            title="Delete role"
                          >
                            {rowBusy===r.role ? <Spinner animation='border' size='sm'/> : <FontAwesomeIcon icon={faTrash} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal.Body>
    </Modal>
  );
}
