/**
 * Settings page
 *
 * Shows server snapshot, Root CA status/generation/download, and provisioning
 * certificates (list, issue, inspect, delete, download bundle). Interacts with
 * `/api/settings/*` endpoints and requires admin login.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Form, Modal, Row, Spinner } from 'react-bootstrap';

type ServerSettings = {
  mqttUrl?: string;
  settings?: { MQTT_URL?: string; UI_DIST?: string };
  [k: string]: any;
};

type RootMeta = {
  exists: boolean;
  subject?: string;
  validFrom?: string;
  validTo?: string;
};

type ProvCert = { name: string; createdAt?: string; expiresAt?: string };

type ApiToken = {
  id: string;
  name: string;
  scopes?: string;
  created_at: string;
  expires_at?: string;
  last_used?: string;
  active: boolean;
};

export default function Settings(_props:{user:any}){
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|undefined>();
  const [server, setServer] = useState<ServerSettings|undefined>();
  const [root, setRoot] = useState<RootMeta|undefined>();
  const [provList, setProvList] = useState<ProvCert[]>([]);
  const [whitelist, setWhitelist] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);
  const [apiTokens, setApiTokens] = useState<ApiToken[]>([]);
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenExpiry, setNewTokenExpiry] = useState<number | ''>('');
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  // Re-render every second to update relative offline timers
  const [now, setNow] = useState<number>(()=> Date.now());
  useEffect(()=>{ const t = setInterval(()=> setNow(Date.now()), 1000); return ()=> clearInterval(t); },[]);

  const [issuing, setIssuing] = useState(false);
  const [genning, setGenning] = useState(false);
  const [provName, setProvName] = useState('provisioning');
  const [provDays, setProvDays] = useState<number|''>('');
  const [genCN, setGenCN] = useState('Edgeberry Device Hub Root CA');
  const [genDays, setGenDays] = useState<number|''>('');

  async function loadAll(){
    setLoading(true); setError(undefined);
    try{
      // Server settings snapshot
      const srv = await (await fetch('/api/settings/server')).json();
      setServer(srv);
    }catch(e:any){ setError(e?.message || 'Failed to load server settings'); }
    try{
      // Root CA meta
      const resp = await fetch('/api/settings/certs/root');
      if (resp.ok){
        const d = await resp.json();
        setRoot({ exists: true, subject: d?.meta?.subject, validFrom: d?.meta?.validFrom, validTo: d?.meta?.validTo });
      } else if (resp.status === 404){
        setRoot({ exists: false });
      } else {
        // leave as-is but surface error next to server section
        const d = await resp.json().catch(()=>({}));
        setError(d?.error || 'Failed to load root CA');
      }
    }catch{ /* ignore */ }
    try{
      // Provisioning certs list
      const l = await (await fetch('/api/settings/certs/provisioning')).json();
      setProvList(Array.isArray(l?.certs) ? l.certs : (Array.isArray(l)? l : []));
    }catch{ /* ignore */ }
    try{
      // Whitelist entries
      const wl = await (await fetch('/api/admin/uuid-whitelist')).json();
      setWhitelist(Array.isArray(wl?.entries) ? wl.entries : (Array.isArray(wl)? wl : []));
    }catch{ /* ignore */ }
    try{
      // Devices snapshot for lifecycle status
      const d = await (await fetch('/api/devices')).json();
      setDevices(Array.isArray(d?.devices) ? d.devices : (Array.isArray(d)? d : []));
    }catch{ /* ignore */ }
    try{
      // API Tokens
      const tokens = await (await fetch('/api/tokens')).json();
      setApiTokens(Array.isArray(tokens?.tokens) ? tokens.tokens : []);
    }catch{ /* ignore */ }
    setLoading(false);
  }

  useEffect(()=>{ loadAll(); },[]);

  // Inspect modal state
  const [showInspect, setShowInspect] = useState(false);
  const [inspectName, setInspectName] = useState<string|undefined>();
  const [inspectPem, setInspectPem] = useState<string|undefined>();
  const [inspectMeta, setInspectMeta] = useState<any>();
  const [inspectLoading, setInspectLoading] = useState(false);

  async function openInspect(name:string){
    setInspectName(name); setInspectPem(undefined); setInspectMeta(undefined); setInspectLoading(true); setShowInspect(true);
    try{
      const d = await (await fetch(`/api/settings/certs/provisioning/${encodeURIComponent(name)}`)).json();
      if (d?.pem){ setInspectPem(d.pem); setInspectMeta(d.meta); }
      else { setInspectPem('Not found'); }
    } finally { setInspectLoading(false); }
  }

  async function deleteCert(name:string){
    if (!confirm(`Delete provisioning certificate "${name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/settings/certs/provisioning/${encodeURIComponent(name)}`, { method:'DELETE' });
    if (res.ok){ await loadAll(); if (inspectName===name) setShowInspect(false); }
    else { const d = await res.json().catch(()=>({})); setError(d.error || 'Failed to delete certificate'); }
  }

  async function generateRoot(){
    try{
      setGenning(true);
      const body:any = {};
      if (genCN) body.cn = genCN; if (genDays) body.days = Number(genDays);
      const res = await fetch('/api/settings/certs/root', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
      const d = await res.json();
      if (res.ok){ await loadAll(); }
      else { setError(d?.error || 'Failed to generate root CA'); }
    } finally { setGenning(false); }
  }

  async function issueProvisioning(){
    try{
      setIssuing(true);
      const body:any = { name: provName || 'provisioning' };
      if (provDays) body.days = Number(provDays);
      const res = await fetch('/api/settings/certs/provisioning', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
      const d = await res.json();
      if (res.ok){ await loadAll(); }
      else { setError(d?.error || 'Failed to issue provisioning cert'); }
    } finally { setIssuing(false); }
  }

  // Whitelist form state (UUID required)
  const [wlUuid, setWlUuid] = useState('');
  const [wlNote, setWlNote] = useState('');
  const [wlBusy, setWlBusy] = useState(false);

  async function createWhitelistEntry(){
    if (!wlUuid) { setError('UUID is required'); return; }
    setWlBusy(true);
    try{
      const body:any = { uuid: wlUuid };
      if (wlNote && wlNote.trim()) body.note = wlNote.trim();
      const res = await fetch('/api/admin/uuid-whitelist', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
      const d = await res.json().catch(()=>({}));
      if (res.ok){ setWlUuid(''); setWlNote(''); await loadAll(); }
      else { setError(d?.error || 'Failed to create whitelist entry'); }
    } finally { setWlBusy(false); }
  }

  async function deleteWhitelistEntry(uuid:string){
    if (!confirm('Delete whitelist entry? This cannot be undone.')) return;
    const res = await fetch(`/api/admin/uuid-whitelist/${encodeURIComponent(uuid)}`, { method:'DELETE' });
    if (res.ok){ await loadAll(); }
    else { const d = await res.json().catch(()=>({})); setError(d?.error || 'Failed to delete whitelist entry'); }
  }

  function fmtDate(s?:string){ try{ return s? new Date(s).toLocaleString() : '-'; }catch{ return s || '-'; } }
  const formatOfflineSince = (last_seen?: string|null): string => {
    if (!last_seen) return '';
    const diffSec = Math.max(0, Math.floor((now - Date.parse(last_seen)) / 1000));
    if (diffSec < 120) {
      return `${diffSec} ${diffSec === 1 ? 'second' : 'seconds'}`;
    }
    const mins = Math.floor(diffSec / 60);
    if (mins < 60) {
      return `${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
    }
    const hours = Math.floor(mins / 60);
    if (hours < 24) {
      return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
    }
    const days = Math.floor(hours / 24);
    if (days < 7) {
      return `${days} ${days === 1 ? 'day' : 'days'}`;
    }
    const weeks = Math.floor(days / 7);
    if (weeks < 5) {
      return `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
    }
    const months = Math.floor(days / 30);
    if (months < 12) {
      return `${months} ${months === 1 ? 'month' : 'months'}`;
    }
    const years = Math.floor(days / 365);
    return `${years} ${years === 1 ? 'year' : 'years'}`;
  };
  const onlineCount = devices.filter((d:any)=>!!d.online).length;
  const offlineCount = devices.length - onlineCount;

  return (
    <div style={{textAlign:'left'}}>
      <h3>Settings</h3>
      {error && <Alert variant='danger'>{error}</Alert>}

      <Row className='g-3'>
        <Col md={6}>
          <Card className='mb-3'>
            <Card.Header>
              <i className="fa-solid fa-server me-2"></i>
              Server
            </Card.Header>
            <Card.Body>
              {loading && !server ? <Spinner animation='border' size='sm'/> : (
                <div>
                  <div><b>MQTT URL:</b> {server?.settings?.MQTT_URL || server?.mqttUrl || '-'}</div>
                  <div><b>UI_DIST:</b> {server?.settings?.UI_DIST || '-'}</div>
                  <pre style={{marginTop:12, background:'#0f0f0f', color:'#d0d0d0', borderRadius:6, padding:10, maxHeight:240, overflow:'auto'}}>{JSON.stringify(server, null, 2)}</pre>
                </div>
              )}
            </Card.Body>
          </Card>
        </Col>

        <Col md={6}>
          <Card className='mb-3'>
            <Card.Header>
              <i className="fa-solid fa-certificate me-2"></i>
              Root CA
            </Card.Header>
            <Card.Body>
              {root ? (
                <div>
                  <div><b>Status:</b> {root.exists ? 'Present' : 'Not generated'}</div>
                  {root.exists && (
                    <div style={{opacity:.85, fontSize:13, marginTop:4}}>
                      <div>Subject: {root.subject}</div>
                      <div>Valid: {root.validFrom} → {root.validTo}</div>
                      <div style={{marginTop:8}}>
                        <a className='btn btn-outline-primary btn-sm' href='/api/settings/certs/root/download'>Download CA certificate</a>
                      </div>
                    </div>
                  )}
                </div>
              ) : loading ? <Spinner animation='border' size='sm'/> : <div>Unknown</div>}

              <Form className='mt-3' onSubmit={(e)=>{e.preventDefault(); generateRoot();}}>
                <Row className='g-2'>
                  <Col xs={12}><Form.Label>Common Name (CN)</Form.Label>
                    <Form.Control value={genCN} onChange={e=>setGenCN(e.target.value)} placeholder='Root CA CN' /></Col>
                  <Col xs={6}><Form.Label>Days (optional)</Form.Label>
                    <Form.Control value={genDays} onChange={e=>setGenDays(e.target.value?Number(e.target.value):'')} placeholder='e.g. 3650' /></Col>
                </Row>
                <Button className='mt-2' disabled={genning} onClick={generateRoot} variant='primary'>
                  {genning? <Spinner animation='border' size='sm'/> : 'Generate Root CA'}
                </Button>
              </Form>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Card className='mb-3'>
        <Card.Header>
          <i className="fa-solid fa-list-check me-2"></i>
          Provisioning Whitelist
        </Card.Header>
        <Card.Body>
          <Form onSubmit={(e)=>{e.preventDefault(); createWhitelistEntry();}}>
            <Row className='g-2'>
              <Col md={12}><Form.Label>UUID</Form.Label>
                <Form.Control value={wlUuid} onChange={e=>setWlUuid(e.target.value)} placeholder='required' /></Col>
              <Col md={12}><Form.Label>Note (optional)</Form.Label>
                <Form.Control value={wlNote} onChange={e=>setWlNote(e.target.value)} placeholder='e.g. device location or purpose' /></Col>
            </Row>
            <Button className='mt-2' disabled={wlBusy} onClick={createWhitelistEntry} variant='success'>
              {wlBusy? <Spinner animation='border' size='sm'/> : 'Create entry'}
            </Button>
          </Form>

          <div style={{marginTop:12}}>
            {loading && whitelist.length===0 ? <Spinner animation='border' size='sm'/> : (
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
                    {whitelist.length===0 ? (
                      <tr><td colSpan={5} style={{color:'#666'}}>No whitelist entries.</td></tr>
                    ) : whitelist.map((w:any)=> (
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
                          <Button size='sm' variant='outline-danger' onClick={()=>deleteWhitelistEntry(w.uuid)}>
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
        </Card.Body>
      </Card>

      <Card className='mb-3'>
        <Card.Header>
          <i className="fa-solid fa-chart-pie me-2"></i>
          Device Lifecycle Status
        </Card.Header>
        <Card.Body>
          <div style={{marginBottom:10}}>
            <Badge bg='secondary' style={{marginRight:8}}>Total {devices.length}</Badge>
            <Badge bg='success' style={{marginRight:8}}>Online {onlineCount}</Badge>
            <Badge bg='dark'>Offline {offlineCount}</Badge>
          </div>
          <div style={{overflowX:'auto'}}>
            <table className='table table-sm'>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Since</th>
                </tr>
              </thead>
              <tbody>
                {devices.slice(0, 15).map((d:any)=> (
                  <tr key={d.id || d._id || d.name}>
                    <td>{d.id || d._id || d.name}</td>
                    <td>{d.name || '-'}</td>
                    <td>
                      {d.online ? (
                        <Badge bg='success'>Online</Badge>
                      ) : (
                        <>
                          <Badge bg='secondary' className='me-2'>Offline</Badge>
                          <span className='text-muted small align-middle'>
                            {d.last_seen ? formatOfflineSince(d.last_seen) : ''}
                          </span>
                        </>
                      )}
                    </td>
                    <td>{d.online ? '-' : (d.last_seen ? formatOfflineSince(d.last_seen) : '-')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card.Body>
      </Card>

      <Card className='mb-3'>
        <Card.Header>
          <i className="fa-solid fa-id-card me-2"></i>
          Provisioning Certificates
        </Card.Header>
        <Card.Body>
          <Form onSubmit={(e)=>{e.preventDefault(); issueProvisioning();}}>
            <Row className='g-2'>
              <Col md={5}><Form.Label>Name</Form.Label>
                <Form.Control value={provName} onChange={e=>setProvName(e.target.value)} placeholder='provisioning' /></Col>
              <Col md={3}><Form.Label>Days (optional)</Form.Label>
                <Form.Control value={provDays} onChange={e=>setProvDays(e.target.value?Number(e.target.value):'')} placeholder='e.g. 365' /></Col>
              <Col md={4} style={{display:'flex', alignItems:'end'}}>
                <Button disabled={issuing} onClick={issueProvisioning} variant='success'>
                  {issuing? <Spinner animation='border' size='sm'/> : 'Issue certificate'}
                </Button>
              </Col>
            </Row>
          </Form>

          <div style={{marginTop:12}}>
            {loading && provList.length===0 ? <Spinner animation='border' size='sm'/> : (
              <div style={{overflowX:'auto'}}>
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
                    ) : provList.map((c,idx)=> (
                      <tr key={idx}>
                        <td>{c.name}</td>
                        <td>{c.createdAt || '-'}</td>
                        <td>{c.expiresAt || '-'}</td>
                        <td>
                          <Button size='sm' variant='secondary' onClick={()=>openInspect(c.name)} style={{marginRight:8}}>Inspect</Button>
                          <a className='btn btn-sm btn-outline-primary' style={{marginRight:8}} href={`/api/settings/certs/provisioning/${encodeURIComponent(c.name)}/download`}>
                            Download
                          </a>
                          <Button size='sm' variant='outline-danger' onClick={()=>deleteCert(c.name)}>Delete</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card.Body>
      </Card>

      {/* Applications Management Card */}
      <Card className="mb-4">
        <Card.Header>
          <i className="fa-solid fa-cloud me-2"></i>
          Applications
        </Card.Header>
        <Card.Body>
          <p className="text-muted mb-3">
            Applications are external tools and services that connect to Device Hub to consume device data.
            Each application uses an API token for authentication and can establish WebSocket connections for real-time telemetry.
          </p>
          <div className="mb-3">
            <Button variant="primary" onClick={() => {
              setNewTokenName('');
              setNewTokenExpiry('');
              setGeneratedToken(null);
              setShowTokenModal(true);
            }}>
              <i className="fa fa-plus"></i> Add Application
            </Button>
          </div>
          {apiTokens.length === 0 ? (
            <Alert variant="info">
              <i className="fa fa-info-circle me-2"></i>
              No applications configured. Create an API token to enable external application access (e.g., Node-RED, custom dashboards, analytics tools).
            </Alert>
          ) : (
            <div className="table-responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th>Application Name</th>
                    <th>Token Status</th>
                    <th>Created</th>
                    <th>Expires</th>
                    <th>Last Used</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {apiTokens.map((token) => (
                    <tr key={token.id}>
                      <td>{token.name}</td>
                      <td>
                        <Badge bg={token.active ? 'success' : 'secondary'}>
                          {token.active ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td>{new Date(token.created_at).toLocaleDateString()}</td>
                      <td>
                        {token.expires_at ? (
                          new Date(token.expires_at) < new Date() ? (
                            <Badge bg="danger">Expired</Badge>
                          ) : (
                            new Date(token.expires_at).toLocaleDateString()
                          )
                        ) : (
                          'Never'
                        )}
                      </td>
                      <td>{token.last_used ? new Date(token.last_used).toLocaleDateString() : 'Never'}</td>
                      <td>
                        <Button
                          size="sm"
                          variant={token.active ? 'warning' : 'success'}
                          className="me-2"
                          onClick={async () => {
                            try {
                              const resp = await fetch(`/api/tokens/${token.id}`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ active: !token.active })
                              });
                              if (resp.ok) {
                                await loadAll();
                              }
                            } catch (e) {
                              console.error('Failed to toggle token status:', e);
                            }
                          }}
                        >
                          {token.active ? 'Deactivate' : 'Activate'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline-danger"
                          onClick={async () => {
                            if (confirm(`Delete token "${token.name}"? This action cannot be undone.`)) {
                              try {
                                const resp = await fetch(`/api/tokens/${token.id}`, { method: 'DELETE' });
                                if (resp.ok) {
                                  await loadAll();
                                }
                              } catch (e) {
                                console.error('Failed to delete token:', e);
                              }
                            }
                          }}
                        >
                          Delete
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card.Body>
      </Card>

      {/* Create Application Token Modal */}
      <Modal show={showTokenModal} onHide={() => setShowTokenModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Add New Application</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {generatedToken ? (
            <div>
              <Alert variant="success">
                <Alert.Heading>Application Token Created!</Alert.Heading>
                <p className="mb-2">
                  <strong>Important:</strong> Copy this token now. You won't be able to see it again.
                </p>
              </Alert>
              <Form.Group className="mb-3">
                <Form.Label>API Token</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  readOnly
                  value={generatedToken}
                  style={{ fontFamily: 'monospace' }}
                  onClick={(e) => {
                    (e.target as HTMLTextAreaElement).select();
                    document.execCommand('copy');
                  }}
                />
                <Form.Text>Click to select and copy</Form.Text>
              </Form.Group>
              <Alert variant="info">
                <p className="mb-2"><strong>How to use this token:</strong></p>
                <ul className="mb-2">
                  <li><strong>REST API:</strong> <code>Authorization: Bearer {generatedToken.substring(0, 10)}...</code></li>
                  <li><strong>WebSocket:</strong> <code>ws://devicehub:8090/ws?token={generatedToken.substring(0, 10)}...</code></li>
                  <li><strong>Node-RED:</strong> Use the Edgeberry Device Hub nodes with this token</li>
                </ul>
              </Alert>
            </div>
          ) : (
            <Form onSubmit={async (e) => {
              e.preventDefault();
              setTokenLoading(true);
              try {
                const resp = await fetch('/api/tokens', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    name: newTokenName,
                    expiresIn: newTokenExpiry ? Number(newTokenExpiry) * 86400 : null
                  })
                });
                if (resp.ok) {
                  const data = await resp.json();
                  setGeneratedToken(data.token);
                  await loadAll();
                }
              } catch (e) {
                console.error('Failed to create token:', e);
              } finally {
                setTokenLoading(false);
              }
            }}>
              <Form.Group className="mb-3">
                <Form.Label>Application Name</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="e.g., Node-RED Production, Custom Dashboard, Analytics Tool"
                  value={newTokenName}
                  onChange={(e) => setNewTokenName(e.target.value)}
                  required
                />
                <Form.Text>A descriptive name to identify this application</Form.Text>
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>Expiration (optional)</Form.Label>
                <Form.Control
                  type="number"
                  placeholder="Days until expiration (leave empty for no expiration)"
                  value={newTokenExpiry}
                  onChange={(e) => setNewTokenExpiry(e.target.value ? Number(e.target.value) : '')}
                  min="1"
                />
                <Form.Text>Number of days before the token expires</Form.Text>
              </Form.Group>
              <Button type="submit" variant="primary" disabled={tokenLoading || !newTokenName.trim()}>
                {tokenLoading ? (
                  <><Spinner animation="border" size="sm" /> Creating...</>
                ) : (
                  'Create Application Token'
                )}
              </Button>
            </Form>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowTokenModal(false)}>
            {generatedToken ? 'Close' : 'Cancel'}
          </Button>
        </Modal.Footer>
      </Modal>

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
          {inspectName && <Button variant='outline-danger' onClick={()=>deleteCert(inspectName)}>Delete</Button>}
          <Button variant='secondary' onClick={()=>setShowInspect(false)}>Close</Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
