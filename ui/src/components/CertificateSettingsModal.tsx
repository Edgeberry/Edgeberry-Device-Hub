/**
 * CertificateSettingsModal
 *
 * Admin-only modal to manage Root CA and Provisioning Certificates.
 * Extracted from the previous Settings page to align with the design
 * of integrating admin controls within the main overview via a modal.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Badge, Button, Col, Form, Modal, Row, Spinner } from 'react-bootstrap';

export default function CertificateSettingsModal(props:{ show:boolean; onClose:()=>void; user:any|null }){
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|undefined>();

  // Root CA
  const [root, setRoot] = useState<{ exists: boolean; subject?: string; validFrom?: string; validTo?: string }|undefined>();
  const [genning, setGenning] = useState(false);
  const [genCN, setGenCN] = useState('Edgeberry Device Hub Root CA');
  const [genDays, setGenDays] = useState<number|''>('');

  // Provisioning certs
  const [provList, setProvList] = useState<Array<{ name:string; createdAt?:string; expiresAt?:string }>>([]);
  const [issuing, setIssuing] = useState(false);
  const [provName, setProvName] = useState('provisioning');
  const [provDays, setProvDays] = useState<number|''>('');

  // Inspect modal state
  const [showInspect, setShowInspect] = useState(false);
  const [inspectName, setInspectName] = useState<string|undefined>();
  const [inspectPem, setInspectPem] = useState<string|undefined>();
  const [inspectMeta, setInspectMeta] = useState<any>();
  const [inspectLoading, setInspectLoading] = useState(false);

  useEffect(()=>{
    if (!props.show) return; // only load when opened
    let mounted = true;
    (async()=>{
      setLoading(true); setError(undefined);
      try{
        const resp = await fetch('/api/settings/certs/root');
        if (resp.ok){
          const d = await resp.json();
          if (mounted) setRoot({ exists: true, subject: d?.meta?.subject, validFrom: d?.meta?.validFrom, validTo: d?.meta?.validTo });
        } else if (resp.status === 404){
          if (mounted) setRoot({ exists: false });
        } else {
          const d = await resp.json().catch(()=>({}));
          if (mounted) setError(d?.error || 'Failed to load root CA');
        }
      }catch{}
      try{
        const l = await (await fetch('/api/settings/certs/provisioning')).json();
        if (mounted) setProvList(Array.isArray(l?.certs) ? l.certs : (Array.isArray(l)? l : []));
      }catch{}
      if (mounted) setLoading(false);
    })();
    return ()=>{ mounted = false; };
  },[props.show]);

  async function openInspect(name:string){
    setInspectName(name); setInspectPem(undefined); setInspectMeta(undefined); setInspectLoading(true); setShowInspect(true);
    try{
      const d = await (await fetch(`/api/settings/certs/provisioning/${encodeURIComponent(name)}`)).json();
      if (d?.pem){ setInspectPem(d.pem); setInspectMeta(d.meta); }
      else { setInspectPem('Not found'); }
    } finally { setInspectLoading(false); }
  }

  async function deleteCert(name:string){
    if (!props.user) return;
    if (!confirm(`Delete provisioning certificate "${name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/settings/certs/provisioning/${encodeURIComponent(name)}`, { method:'DELETE' });
    if (res.ok){
      try{ const l = await (await fetch('/api/settings/certs/provisioning')).json(); setProvList(Array.isArray(l?.certs) ? l.certs : (Array.isArray(l)? l : [])); }catch{}
      if (inspectName===name) setShowInspect(false);
    }
    else { const d = await res.json().catch(()=>({})); setError(d.error || 'Failed to delete certificate'); }
  }

  async function generateRoot(){
    if (!props.user) return;
    try{
      setGenning(true);
      const body:any = {};
      if (genCN) body.cn = genCN; if (genDays) body.days = Number(genDays);
      const res = await fetch('/api/settings/certs/root', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
      const d = await res.json().catch(()=>({}));
      if (res.ok){
        setRoot({ exists: true, subject: d?.meta?.subject, validFrom: d?.meta?.validFrom, validTo: d?.meta?.validTo });
      } else {
        setError(d?.error || 'Failed to generate root CA');
      }
    } finally { setGenning(false); }
  }

  async function issueProvisioning(){
    if (!props.user) return;
    try{
      setIssuing(true);
      const body:any = { name: provName || 'provisioning' };
      if (provDays) body.days = Number(provDays);
      const res = await fetch('/api/settings/certs/provisioning', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
      const d = await res.json().catch(()=>({}));
      if (res.ok){
        // refresh list
        try{ const l = await (await fetch('/api/settings/certs/provisioning')).json(); setProvList(Array.isArray(l?.certs) ? l.certs : (Array.isArray(l)? l : [])); }catch{}
      } else {
        setError(d?.error || 'Failed to issue provisioning cert');
      }
    } finally { setIssuing(false); }
  }

  return (
    <Modal show={props.show} onHide={props.onClose} size='lg'>
      <Modal.Header closeButton>
        <Modal.Title>Certificate Settings</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant='danger'>{error}</Alert>}

        {/* Root CA */}
        <section style={{marginBottom:16}}>
          <h5>Root CA</h5>
          {loading && !root ? (<Spinner animation='border' size='sm'/>) : (
            <div>
              <div><b>Status:</b> {root?.exists ? 'Present' : 'Not generated'}</div>
              {root?.exists && (
                <div style={{opacity:.85, fontSize:13, marginTop:4}}>
                  <div>Subject: {root?.subject}</div>
                  <div>Valid: {root?.validFrom} → {root?.validTo}</div>
                  <div style={{marginTop:8}}>
                    <a className='btn btn-outline-primary btn-sm' href='/api/settings/certs/root/download'>Download CA certificate</a>
                  </div>
                </div>
              )}
            </div>
          )}

          <Form className='mt-2' onSubmit={(e)=>{e.preventDefault(); generateRoot();}}>
            <Row className='g-2'>
              <Col xs={12}><Form.Label>Common Name (CN)</Form.Label>
                <Form.Control value={genCN} onChange={e=>setGenCN(e.target.value)} placeholder='Root CA CN' disabled={!props.user} /></Col>
              <Col xs={6}><Form.Label>Days (optional)</Form.Label>
                <Form.Control value={genDays} onChange={e=>setGenDays(e.target.value?Number(e.target.value):'')} placeholder='e.g. 3650' disabled={!props.user} /></Col>
            </Row>
            <Button className='mt-2' disabled={!props.user || genning} onClick={generateRoot} variant='primary'>
              {genning? <Spinner animation='border' size='sm'/> : 'Generate Root CA'}
            </Button>
          </Form>
        </section>

        {/* Provisioning certificates */}
        <section>
          <h5>Provisioning Certificates</h5>
          <Form onSubmit={(e)=>{e.preventDefault(); issueProvisioning();}}>
            <Row className='g-2'>
              <Col md={5}><Form.Label>Name</Form.Label>
                <Form.Control value={provName} onChange={e=>setProvName(e.target.value)} placeholder='provisioning' disabled={!props.user} /></Col>
              <Col md={3}><Form.Label>Days (optional)</Form.Label>
                <Form.Control value={provDays} onChange={e=>setProvDays(e.target.value?Number(e.target.value):'')} placeholder='e.g. 365' disabled={!props.user} /></Col>
              <Col md={4} style={{display:'flex', alignItems:'end'}}>
                <Button disabled={!props.user || issuing} onClick={issueProvisioning} variant='success'>
                  {issuing? <Spinner animation='border' size='sm'/> : 'Issue certificate'}
                </Button>
              </Col>
            </Row>
          </Form>

          <div style={{marginTop:12, overflowX:'auto'}}>
            {loading && provList.length===0 ? <Spinner animation='border' size='sm'/> : (
              <table className='table table-sm'>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Created</th>
                    <th>Expires</th>
                    <th style={{width:260}}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {provList.length===0 ? (
                    <tr><td colSpan={4} style={{color:'#666'}}>No provisioning certificates found.</td></tr>
                  ) : provList.map((c, idx)=> (
                    <tr key={idx}>
                      <td>{c.name}</td>
                      <td>{c.createdAt || '-'}</td>
                      <td>{c.expiresAt || '-'}</td>
                      <td>
                        <Button size='sm' variant='secondary' onClick={()=>openInspect(c.name)} style={{marginRight:8}}>Inspect</Button>
                        <a className='btn btn-sm btn-outline-primary' style={{marginRight:8}} href={`/api/settings/certs/provisioning/${encodeURIComponent(c.name)}/download`}>
                          Download
                        </a>
                        <Button size='sm' variant='outline-danger' onClick={()=>deleteCert(c.name)} disabled={!props.user}>Delete</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </Modal.Body>
      <Modal.Footer>
        <Badge bg={props.user? 'primary':'secondary'}>{props.user? 'Admin' : 'Viewer'}</Badge>
        <Button variant='secondary' onClick={props.onClose}>Close</Button>
      </Modal.Footer>
      {/* Inspect Modal */}
      <Modal show={showInspect} onHide={()=>setShowInspect(false)} size='lg'>
        <Modal.Header closeButton>
          <Modal.Title>Provisioning Certificate: {inspectName}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {inspectLoading ? <Spinner animation='border' size='sm'/> : (
            <div>
              {inspectMeta && (
                <div style={{marginBottom:12}}>
                  <div><b>Subject:</b> {inspectMeta?.subject || '-'}</div>
                  <div><b>Valid:</b> {inspectMeta?.validFrom || '-'} → {inspectMeta?.validTo || '-'}</div>
                </div>
              )}
              <Form.Group>
                <Form.Label>Certificate (PEM)</Form.Label>
                <Form.Control as='textarea' rows={12} readOnly value={inspectPem || ''} style={{fontFamily:'monospace'}}/>
              </Form.Group>
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          {inspectName && <a className='btn btn-outline-primary' href={`/api/settings/certs/provisioning/${encodeURIComponent(inspectName||'')}/download`}>Download</a>}
          {inspectName && <Button variant='outline-danger' onClick={()=> deleteCert(inspectName)}>Delete</Button>}
          <Button variant='secondary' onClick={()=>setShowInspect(false)}>Close</Button>
        </Modal.Footer>
      </Modal>
    </Modal>
  );
}
