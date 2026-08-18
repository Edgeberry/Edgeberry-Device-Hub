/**
 * WhitelistModal
 *
 * Admin-only modal to manage provisioning UUID whitelist entries.
 */
import React, { useEffect, useState, useRef } from 'react';
import { Alert, Badge, Button, Col, Form, Modal, Row, Spinner, Tab, Tabs } from 'react-bootstrap';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faToggleOn, faToggleOff, faTrash, faListCheck } from '@fortawesome/free-solid-svg-icons';
import { batchUploadWhitelist } from '../api/devicehub';

export default function WhitelistModal(props:{ show:boolean; onClose:()=>void }){
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|undefined>();
  const [entries, setEntries] = useState<any[]>([]);

  // Form state
  const [wlUuid, setWlUuid] = useState('');
  const [wlBusy, setWlBusy] = useState(false);

  // Batch upload state
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResults, setBatchResults] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Tab state
  const [activeTab, setActiveTab] = useState('single');

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
    if (!wlUuid) { setError('UUID is required'); return; }
    setWlBusy(true);
    try{
      const body = { uuid: wlUuid };
      const res = await fetch('/api/admin/uuid-whitelist', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
      const d = await res.json().catch(()=>({}));
      if (res.ok){ setWlUuid(''); await refresh(); }
      else { setError(d?.error || 'Failed to create whitelist entry'); }
    } finally { setWlBusy(false); }
  }

  async function deleteEntry(uuid:string){
    if (!confirm('Delete whitelist entry? This cannot be undone.')) return;
    const res = await fetch(`/api/admin/uuid-whitelist/${encodeURIComponent(uuid)}`, { method:'DELETE' });
    if (res.ok){ await refresh(); }
    else { const d = await res.json().catch(()=>({})); setError(d?.error || 'Failed to delete whitelist entry'); }
  }

  async function toggleDisabled(uuid:string, disabled:boolean){
    const res = await fetch(`/api/admin/uuid-whitelist/${encodeURIComponent(uuid)}`, {
      method:'PATCH',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({ disabled })
    });
    if (res.ok){ await refresh(); }
    else { const d = await res.json().catch(()=>({})); setError(d?.error || `Failed to ${disabled ? 'disable' : 'enable'} whitelist entry`); }
  }


  async function handleBatchUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setBatchBusy(true);
    setBatchResults(null);
    setError(undefined);

    try {
      const text = await file.text();
      const uuids = text.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

      if (uuids.length === 0) {
        setError('No valid UUIDs found in file');
        return;
      }

      const result = await batchUploadWhitelist(uuids);

      if (result.ok) {
        setBatchResults(result.results);
        await refresh();
        if (fileInputRef.current) fileInputRef.current.value = '';
      } else {
        setError(result.error || 'Batch upload failed');
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to process file');
    } finally {
      setBatchBusy(false);
    }
  }

  function fmtDate(s?:string){ try{ return s? new Date(s).toLocaleString() : '-'; }catch{ return s || '-'; } }

  return (
    <Modal show={props.show} onHide={props.onClose} size='xl' scrollable contentClassName="eb-modal-content">
      <Modal.Header closeButton closeVariant="white">
        <Modal.Title><FontAwesomeIcon icon={faListCheck} />Whitelist</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant='danger'>{error}</Alert>}

        <Tabs activeKey={activeTab} onSelect={(k) => setActiveTab(k || 'single')} className="mb-3">
          <Tab eventKey="single" title="Single Entry">
            <div className="mt-3">
              <Form onSubmit={(e)=>{e.preventDefault(); createEntry();}}>
                <Row className='g-2'>
                  <Col md={12}><Form.Label>UUID <span className="text-danger">*</span></Form.Label>
                    <Form.Control value={wlUuid} onChange={e=>setWlUuid(e.target.value)} placeholder='Device UUID (required)' /></Col>
                </Row>
                <Button className='mt-3' disabled={wlBusy} onClick={createEntry} variant='success'>
                  {wlBusy? <Spinner animation='border' size='sm'/> : 'Add Entry'}
                </Button>
              </Form>
            </div>
          </Tab>

          <Tab eventKey="batch" title="Batch Upload">
            <div className="mt-3">
              <p className="text-muted">Upload a plain text file with one UUID per line</p>
              <Row className='g-2'>
                <Col md={12}><Form.Label>UUID File <span className="text-danger">*</span></Form.Label>
                  <Form.Control
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.csv"
                    onChange={handleBatchUpload}
                    disabled={batchBusy}
                  />
                </Col>
              </Row>
              {batchBusy && (
                <div className="mt-3">
                  <Spinner animation='border' size='sm'/> Processing file...
                </div>
              )}
              {batchResults && (
                <Alert variant={batchResults.errors.length > 0 ? 'warning' : 'success'} className="mt-3">
                  <strong>Batch Upload Results:</strong><br/>
                  Added: {batchResults.added} entries<br/>
                  Skipped: {batchResults.skipped} entries<br/>
                  {batchResults.errors.length > 0 && (
                    <details className="mt-2">
                      <summary>Errors ({batchResults.errors.length})</summary>
                      <ul className="mb-0 mt-1">
                        {batchResults.errors.slice(0, 10).map((err: string, i: number) => (
                          <li key={i} style={{fontSize: '0.85em'}}>{err}</li>
                        ))}
                        {batchResults.errors.length > 10 && <li>... and {batchResults.errors.length - 10} more</li>}
                      </ul>
                    </details>
                  )}
                </Alert>
              )}
            </div>
          </Tab>
        </Tabs>

        <div style={{marginTop:12}}>
          {loading && entries.length===0 ? <Spinner animation='border' size='sm'/> : (
            <div style={{overflowX:'auto'}}>
              <table className='table table-sm'>
                <thead>
                  <tr>
                    <th>UUID</th>
                    <th>Created</th>
                    <th>Status</th>
                    <th style={{width:180}} className='text-end'>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.length===0 ? (
                    <tr><td colSpan={4} style={{color:'#666'}}>No whitelist entries.</td></tr>
                  ) : entries.map((entry:any)=> (
                    <tr key={entry.uuid} className='device-row'>
                      <td style={{fontFamily:'monospace', fontSize:'0.85em'}}>{entry.uuid}</td>
                      <td>{fmtDate(entry.created_at)}</td>
                      <td>
                        {/* Disabled first: an admin blacklisted this UUID, which
                            overrides whatever it did before. Then the three
                            states a permitted UUID can be in - never claimed,
                            claimed and still registered, or claimed and since
                            decommissioned. That last one used to read "In use",
                            which described a device that no longer exists. */}
                        {entry.disabled_at ? (
                          <Badge bg='danger' title={`Disabled ${fmtDate(entry.disabled_at)}`}>Disabled</Badge>
                        ) : entry.used_at && entry.registered ? (
                          <Badge bg='secondary' title={`Last claimed ${fmtDate(entry.used_at)}`}>In use</Badge>
                        ) : entry.used_at ? (
                          <Badge bg='warning' text='dark' title={`Claimed ${fmtDate(entry.used_at)}, no longer registered. This UUID may provision again.`}>Decommissioned</Badge>
                        ) : (
                          <Badge bg='success'>Unused</Badge>
                        )}
                      </td>
                      <td className='text-end'>
                        <div className="btn-group device-actions" role="group">
                          <button
                            type="button"
                            className="btn btn-sm btn-edgeberry"
                            onClick={()=>toggleDisabled(entry.uuid, !entry.disabled_at)}
                            title={entry.disabled_at ? 'Enable' : 'Disable'}
                          >
                            <FontAwesomeIcon icon={entry.disabled_at ? faToggleOff : faToggleOn} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-edgeberry"
                            onClick={()=>deleteEntry(entry.uuid)}
                            title="Delete"
                          >
                            <FontAwesomeIcon icon={faTrash} />
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
