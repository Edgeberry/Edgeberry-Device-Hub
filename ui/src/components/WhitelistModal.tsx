/**
 * WhitelistModal
 *
 * Admin-only modal to manage provisioning UUID whitelist entries.
 */
import React, { useEffect, useState, useRef } from 'react';
import { Alert, Badge, Button, Col, Form, Modal, Row, Spinner, Tab, Tabs } from 'react-bootstrap';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faToggleOn, faToggleOff, faTrash, faListCheck, faDownload, faPen, faCheck, faXmark } from '@fortawesome/free-solid-svg-icons';
import { batchUploadWhitelist, downloadWhitelist } from '../api/devicehub';

export default function WhitelistModal(props:{ show:boolean; onClose:()=>void }){
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|undefined>();
  const [entries, setEntries] = useState<any[]>([]);

  // Form state
  const [wlUuid, setWlUuid] = useState('');
  const [wlNote, setWlNote] = useState('');
  const [wlBusy, setWlBusy] = useState(false);

  // Inline note editing: which row is open, and its in-progress text.
  const [editingUuid, setEditingUuid] = useState<string|null>(null);
  const [editingNote, setEditingNote] = useState('');

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
      const body = { uuid: wlUuid, note: wlNote };
      const res = await fetch('/api/admin/uuid-whitelist', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
      const d = await res.json().catch(()=>({}));
      if (res.ok){ setWlUuid(''); setWlNote(''); await refresh(); }
      else { setError(d?.error || 'Failed to create whitelist entry'); }
    } finally { setWlBusy(false); }
  }

  function startEditNote(uuid:string, note?:string|null){
    setEditingUuid(uuid);
    setEditingNote(note || '');
  }

  async function saveNote(uuid:string){
    const res = await fetch(`/api/admin/uuid-whitelist/${encodeURIComponent(uuid)}`, {
      method:'PATCH',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({ note: editingNote })
    });
    if (res.ok){ setEditingUuid(null); await refresh(); }
    else { const d = await res.json().catch(()=>({})); setError(d?.error || 'Failed to save note'); }
  }

  async function exportWhitelist(){
    setError(undefined);
    try{ await downloadWhitelist(); }
    catch(e:any){ setError(e?.message || 'Failed to download whitelist'); }
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
      // Lines go up whole - the server splits `<uuid> <note>`, so that the
      // export and import halves of the format have exactly one definition
      // between them.
      const lines = text.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

      if (lines.length === 0) {
        setError('No entries found in file');
        return;
      }

      const result = await batchUploadWhitelist(lines);

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
                  <Col md={12}><Form.Label>Note</Form.Label>
                    <Form.Control value={wlNote} onChange={e=>setWlNote(e.target.value)} placeholder="Optional - e.g. what this board is for, or where it went" />
                    <Form.Text className='text-muted'>Something you'll recognise this UUID by before it has ever provisioned.</Form.Text></Col>
                </Row>
                <Button className='mt-3' disabled={wlBusy} onClick={createEntry} variant='success'>
                  {wlBusy? <Spinner animation='border' size='sm'/> : 'Add Entry'}
                </Button>
              </Form>
            </div>
          </Tab>

          <Tab eventKey="batch" title="Batch Upload">
            <div className="mt-3">
              <p className="text-muted mb-1">
                Upload a plain text file with one entry per line, in the format <code>&lt;uuid&gt; &lt;note&gt;</code>.
                The note is optional, so a file of bare UUIDs still works.
              </p>
              <p className="text-muted">
                This is the same format the <strong>Download</strong> button produces, so a list
                exported from one hub can be uploaded straight into another.
              </p>
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
          <div className='d-flex justify-content-between align-items-center mb-2'>
            <span className='text-muted' style={{fontSize:'0.9em'}}>
              {entries.length} {entries.length===1 ? 'entry' : 'entries'}
            </span>
            <Button
              size='sm'
              variant='outline-secondary'
              onClick={exportWhitelist}
              disabled={entries.length===0}
              title='Download as a text file, one "<uuid> <note>" per line'
            >
              <FontAwesomeIcon icon={faDownload} /> Download
            </Button>
          </div>
          {loading && entries.length===0 ? <Spinner animation='border' size='sm'/> : (
            <div style={{overflowX:'auto'}}>
              <table className='table table-sm'>
                <thead>
                  <tr>
                    <th>UUID</th>
                    <th>Note</th>
                    <th>Created</th>
                    <th>Status</th>
                    <th style={{width:180}} className='text-end'>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.length===0 ? (
                    <tr><td colSpan={5} style={{color:'#666'}}>No whitelist entries.</td></tr>
                  ) : entries.map((entry:any)=> (
                    <tr key={entry.uuid} className='device-row'>
                      <td style={{fontFamily:'monospace', fontSize:'0.85em'}}>{entry.uuid}</td>
                      <td style={{minWidth:220}}>
                        {editingUuid === entry.uuid ? (
                          <Form.Control
                            size='sm'
                            autoFocus
                            value={editingNote}
                            onChange={e=>setEditingNote(e.target.value)}
                            onKeyDown={e=>{
                              if (e.key === 'Enter'){ e.preventDefault(); saveNote(entry.uuid); }
                              if (e.key === 'Escape'){ setEditingUuid(null); }
                            }}
                            placeholder='Note'
                          />
                        ) : (
                          <span
                            role='button'
                            onClick={()=>startEditNote(entry.uuid, entry.note)}
                            title='Click to edit'
                            style={{color: entry.note ? undefined : '#888'}}
                          >
                            {entry.note || <em>Add a note</em>} <FontAwesomeIcon icon={faPen} style={{fontSize:'0.75em', opacity:0.5}} />
                          </span>
                        )}
                      </td>
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
                          {editingUuid === entry.uuid ? (
                            <>
                              <button type="button" className="btn btn-sm btn-edgeberry" onClick={()=>saveNote(entry.uuid)} title="Save note">
                                <FontAwesomeIcon icon={faCheck} />
                              </button>
                              <button type="button" className="btn btn-sm btn-edgeberry" onClick={()=>setEditingUuid(null)} title="Cancel">
                                <FontAwesomeIcon icon={faXmark} />
                              </button>
                            </>
                          ) : (
                            <>
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
                            </>
                          )}
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
