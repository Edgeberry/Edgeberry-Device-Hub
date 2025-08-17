/**
 * WhitelistModal
 *
 * Admin-only modal to manage provisioning UUID whitelist entries.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Badge, Button, Col, Form, Modal, Row, Spinner } from 'react-bootstrap';

export default function WhitelistModal(props:{ show:boolean; onClose:()=>void; user:any|null }){
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|undefined>();
  const [entries, setEntries] = useState<any[]>([]);

  // Form state
  const [wlUuid, setWlUuid] = useState('');
  const [wlNote, setWlNote] = useState('');
  const [wlBusy, setWlBusy] = useState(false);

  useEffect(()=>{
    if (!props.show) return;
    let mounted = true;
    (async()=>{
      setLoading(true); setError(undefined);
      try{
        const wl = await (await fetch('/api/admin/uuid-whitelist')).json();
        if (mounted) setEntries(Array.isArray(wl?.entries) ? wl.entries : (Array.isArray(wl)? wl : []));
      }catch(e:any){ if(mounted) setError(e?.message || 'Failed to load whitelist'); }
      if (mounted) setLoading(false);
    })();
    return ()=>{ mounted = false; };
  },[props.show]);

  async function refresh(){
    try{
      const wl = await (await fetch('/api/admin/uuid-whitelist')).json();
      setEntries(Array.isArray(wl?.entries) ? wl.entries : (Array.isArray(wl)? wl : []));
    }catch{}
  }

  async function createEntry(){
    if (!props.user) return;
    if (!wlUuid) { setError('UUID is required'); return; }
    setWlBusy(true);
    try{
      const body:any = { uuid: wlUuid };
      if (wlNote && wlNote.trim()) body.note = wlNote.trim();
      const res = await fetch('/api/admin/uuid-whitelist', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
      const d = await res.json().catch(()=>({}));
      if (res.ok){ setWlUuid(''); setWlNote(''); await refresh(); }
      else { setError(d?.error || 'Failed to create whitelist entry'); }
    } finally { setWlBusy(false); }
  }

  async function deleteEntry(uuid:string){
    if (!props.user) return;
    if (!confirm('Delete whitelist entry? This cannot be undone.')) return;
    const res = await fetch(`/api/admin/uuid-whitelist/${encodeURIComponent(uuid)}`, { method:'DELETE' });
    if (res.ok){ await refresh(); }
    else { const d = await res.json().catch(()=>({})); setError(d?.error || 'Failed to delete whitelist entry'); }
  }

  function fmtDate(s?:string){ try{ return s? new Date(s).toLocaleString() : '-'; }catch{ return s || '-'; } }

  return (
    <Modal show={props.show} onHide={props.onClose} size='lg'>
      <Modal.Header closeButton>
        <Modal.Title>Provisioning Whitelist</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant='danger'>{error}</Alert>}

        <Form onSubmit={(e)=>{e.preventDefault(); createEntry();}}>
          <Row className='g-2'>
            <Col md={12}><Form.Label>UUID</Form.Label>
              <Form.Control value={wlUuid} onChange={e=>setWlUuid(e.target.value)} placeholder='required' disabled={!props.user} /></Col>
            <Col md={12}><Form.Label>Note (optional)</Form.Label>
              <Form.Control value={wlNote} onChange={e=>setWlNote(e.target.value)} placeholder='e.g. device location or purpose' disabled={!props.user} /></Col>
          </Row>
          <Button className='mt-2' disabled={!props.user || wlBusy} onClick={createEntry} variant='success'>
            {wlBusy? <Spinner animation='border' size='sm'/> : 'Create entry'}
          </Button>
        </Form>

        <div style={{marginTop:12}}>
          {loading && entries.length===0 ? <Spinner animation='border' size='sm'/> : (
            <div style={{overflowX:'auto'}}>
              <table className='table table-sm'>
                <thead>
                  <tr>
                    <th>UUID</th>
                    <th>Note</th>
                    <th>Created</th>
                    <th>Used</th>
                    <th style={{width:220}}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.length===0 ? (
                    <tr><td colSpan={5} style={{color:'#666'}}>No whitelist entries.</td></tr>
                  ) : entries.map((w:any)=> (
                    <tr key={w.uuid}>
                      <td style={{fontFamily:'monospace'}}>{w.uuid}</td>
                      <td>{w.note || '-'}</td>
                      <td>{fmtDate(w.created_at)}</td>
                      <td>
                        {w.used_at ? <Badge bg='secondary'>Used</Badge> : <Badge bg='success'>Unused</Badge>}
                        <div style={{fontSize:12, opacity:.8}}>{w.used_at ? fmtDate(w.used_at) : ''}</div>
                      </td>
                      <td>
                        <Button size='sm' variant='outline-primary' style={{marginRight:8}}
                          onClick={()=>{ navigator.clipboard?.writeText(w.uuid).catch(()=>{}); }}>
                          Copy UUID
                        </Button>
                        <Button size='sm' variant='outline-danger' onClick={()=>deleteEntry(w.uuid)} disabled={!props.user}>
                          Delete
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Badge bg={props.user? 'primary':'secondary'}>{props.user? 'Admin' : 'Viewer'}</Badge>
        <Button variant='secondary' onClick={props.onClose}>Close</Button>
      </Modal.Footer>
    </Modal>
  );
}
