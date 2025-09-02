/**
 * WhitelistModal
 *
 * Admin-only modal to manage provisioning UUID whitelist entries.
 */
import React, { useEffect, useState, useRef } from 'react';
import { Alert, Badge, Button, Col, Form, Modal, Row, Spinner, Tab, Tabs } from 'react-bootstrap';
import { batchUploadWhitelist } from '../api/devicehub';

export default function WhitelistModal(props:{ show:boolean; onClose:()=>void; user:any|null }){
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|undefined>();
  const [entries, setEntries] = useState<any[]>([]);

  // Form state
  const [wlUuid, setWlUuid] = useState('');
  const [wlHardwareVersion, setWlHardwareVersion] = useState('');
  const [wlManufacturer, setWlManufacturer] = useState('');
  const [wlBusy, setWlBusy] = useState(false);
  
  // Batch upload state
  const [batchHardwareVersion, setBatchHardwareVersion] = useState('');
  const [batchManufacturer, setBatchManufacturer] = useState('');
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
    if (!props.user) return;
    if (!wlUuid) { setError('UUID is required'); return; }
    if (!wlHardwareVersion) { setError('Hardware version is required'); return; }
    if (!wlManufacturer) { setError('Manufacturer is required'); return; }
    setWlBusy(true);
    try{
      const body = { uuid: wlUuid, hardware_version: wlHardwareVersion.trim(), manufacturer: wlManufacturer.trim() };
      const res = await fetch('/api/admin/uuid-whitelist', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
      const d = await res.json().catch(()=>({}));
      if (res.ok){ setWlUuid(''); setWlHardwareVersion(''); setWlManufacturer(''); await refresh(); }
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
  
  async function handleBatchUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    
    if (!batchHardwareVersion.trim() || !batchManufacturer.trim()) {
      setError('Hardware version and manufacturer are required for batch upload');
      return;
    }
    
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
      
      const result = await batchUploadWhitelist(uuids, batchHardwareVersion.trim(), batchManufacturer.trim());
      
      if (result.ok) {
        setBatchResults(result.results);
        await refresh();
        // Clear form
        setBatchHardwareVersion('');
        setBatchManufacturer('');
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
    <Modal show={props.show} onHide={props.onClose} size='xl'>
      <Modal.Header closeButton>
        <Modal.Title>Whitelist</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant='danger'>{error}</Alert>}

        <Tabs activeKey={activeTab} onSelect={(k) => setActiveTab(k || 'single')} className="mb-3">
          <Tab eventKey="single" title="Single Entry">
            <div className="mt-3">
              <Form onSubmit={(e)=>{e.preventDefault(); createEntry();}}>
                <Row className='g-2'>
                  <Col md={12}><Form.Label>UUID <span className="text-danger">*</span></Form.Label>
                    <Form.Control value={wlUuid} onChange={e=>setWlUuid(e.target.value)} placeholder='Device UUID (required)' disabled={!props.user} /></Col>
                  <Col md={6}><Form.Label>Hardware Version <span className="text-danger">*</span></Form.Label>
                    <Form.Control value={wlHardwareVersion} onChange={e=>setWlHardwareVersion(e.target.value)} placeholder='e.g. v1.2, Rev A' disabled={!props.user} /></Col>
                  <Col md={6}><Form.Label>Manufacturer <span className="text-danger">*</span></Form.Label>
                    <Form.Control value={wlManufacturer} onChange={e=>setWlManufacturer(e.target.value)} placeholder='e.g. Acme Corp' disabled={!props.user} /></Col>
                </Row>
                <Button className='mt-3' disabled={!props.user || wlBusy} onClick={createEntry} variant='success'>
                  {wlBusy? <Spinner animation='border' size='sm'/> : 'Add Entry'}
                </Button>
              </Form>
            </div>
          </Tab>
          
          <Tab eventKey="batch" title="Batch Upload">
            <div className="mt-3">
              <p className="text-muted">Upload a plain text file with one UUID per line</p>
              <Row className='g-2'>
                <Col md={6}><Form.Label>Hardware Version <span className="text-danger">*</span></Form.Label>
                  <Form.Control value={batchHardwareVersion} onChange={e=>setBatchHardwareVersion(e.target.value)} placeholder='e.g. v1.2, Rev A' disabled={!props.user} /></Col>
                <Col md={6}><Form.Label>Manufacturer <span className="text-danger">*</span></Form.Label>
                  <Form.Control value={batchManufacturer} onChange={e=>setBatchManufacturer(e.target.value)} placeholder='e.g. Acme Corp' disabled={!props.user} /></Col>
                <Col md={12}><Form.Label>UUID File <span className="text-danger">*</span></Form.Label>
                  <Form.Control 
                    ref={fileInputRef}
                    type="file" 
                    accept=".txt,.csv" 
                    onChange={handleBatchUpload} 
                    disabled={!props.user || batchBusy}
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
                    <th>Hardware Version</th>
                    <th>Manufacturer</th>
                    <th>Created</th>
                    <th>Used</th>
                    <th style={{width:220}}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.length===0 ? (
                    <tr><td colSpan={6} style={{color:'#666'}}>No whitelist entries.</td></tr>
                  ) : entries.map((w:any)=> (
                    <tr key={w.uuid}>
                      <td style={{fontFamily:'monospace', fontSize:'0.85em'}}>{w.uuid}</td>
                      <td>{w.hardware_version || '-'}</td>
                      <td>{w.manufacturer || '-'}</td>
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
    </Modal>
  );
}
