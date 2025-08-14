import React, { useEffect, useState } from 'react';
import { Card, Badge, Spinner, Button, Row, Col, Modal } from 'react-bootstrap';
import { getServices, getServiceLogs, startService, stopService, restartService } from '../api/fleethub';

type ServiceItem = { unit: string; status: string };

type ServicesResponse = { services: ServiceItem[] } | { message?: string };

export default function ServiceStatusWidget(props:{user:any|null}) {
  const [loading, setLoading] = useState<boolean>(true);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [error, setError] = useState<string>('');
  const [selected, setSelected] = useState<ServiceItem | null>(null);
  const [logs, setLogs] = useState<string>('');
  const [logsLoading, setLogsLoading] = useState<boolean>(false);
  const [actionBusy, setActionBusy] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string>('');

  async function load() {
    try {
      setLoading(true);
      const res: ServicesResponse = await getServices();
      if ((res as any).message) throw new Error((res as any).message);
      const list = (res as any).services || [];
      setServices(list);
    } catch (e: any) {
      setError(e?.message || 'Failed to load services');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Load logs whenever a selection opens the modal
  useEffect(()=>{
    if(!selected) { setLogs(''); setActionError(''); return; }
    (async ()=>{
      try{
        setLogsLoading(true);
        const res: any = await getServiceLogs(selected.unit, 200);
        // Accept either { logs: string } or raw string/array
        let txt = '';
        if(typeof res === 'string') txt = res;
        else if(Array.isArray(res)) txt = res.join('\n');
        else if(res && typeof res.logs === 'string') txt = res.logs;
        else txt = JSON.stringify(res);
        setLogs(txt);
      }catch(e:any){
        setLogs(`Logs unavailable: ${e?.message || 'unknown error'}`);
      }finally{
        setLogsLoading(false);
      }
    })();
  }, [selected]);

  function statusVariant(s: string){
    return s === 'active' ? 'success' : (s === 'inactive' ? 'secondary' : 'warning');
  }

  function prettyUnitName(unit: string){
    return unit.replace(/^fleethub-/, '').replace(/\.service$/, '');
  }

  async function doAction(kind: 'start'|'stop'|'restart', unit: string){
    try{
      setActionBusy(true);
      setActionError('');
      if(kind==='start') await startService(unit);
      else if(kind==='stop') await stopService(unit);
      else await restartService(unit);
      // refresh list to reflect new status
      await load();
      // update selected to the refreshed service entry if still open
      const updated = services.find(s=>s.unit===unit);
      if(updated) setSelected(updated);
    }catch(e:any){
      setActionError(e?.message || 'Action failed');
    }finally{
      setActionBusy(false);
    }
  }

  const canControl = !!(props?.user && Array.isArray(props.user.roles) && props.user.roles.includes('admin'));

  return (
    <Card className="mb-3" data-testid="services-widget">
      <Card.Body>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h5 className="mb-0">Services</h5>
          <Button size="sm" variant="outline-secondary" onClick={load} disabled={loading}>Refresh</Button>
        </div>
        <div style={{ marginTop: 12 }}>
          {loading ? (
            <Spinner animation="border" size="sm" />
          ) : error ? (
            <div style={{ color: '#c00' }}>{error}</div>
          ) : (
            <>
              {services.length === 0 ? (
                <div>No services found.</div>
              ) : (
                <Row className="g-3">
                  {services
                    // hide legacy/merged API tile
                    .filter(s => s.unit !== 'fleethub-api.service' && prettyUnitName(s.unit).toLowerCase() !== 'api')
                    .map((s) => {
                    const variant = s.status === 'active' ? 'success' : (s.status === 'inactive' ? 'secondary' : 'warning');
                    return (
                      <Col key={s.unit} xs={12} sm={6} md={4} lg={3} xl={2}>
                        <div
                          role="button"
                          onClick={() => setSelected(s)}
                          style={{
                            border: '1px solid #e0e0e0',
                            borderRadius: 8,
                            padding: 12,
                            height: '100%',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>{prettyUnitName(s.unit)}</div>
                          <div style={{ marginTop: 8 }}>
                            <Badge bg={variant}>{s.status}</Badge>
                          </div>
                        </div>
                      </Col>
                    );
                  })}
                </Row>
              )}
              <Modal show={!!selected} onHide={() => setSelected(null)} centered>
                <Modal.Header closeButton>
                  <Modal.Title>Service details</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                  {selected && (
                    <div>
                      <div style={{ marginBottom: 6 }}><strong>Service:</strong> {prettyUnitName(selected.unit)}</div>
                      <div style={{ marginBottom: 6, opacity: 0.7 }}><small>Unit id: {selected.unit}</small></div>
                      <div style={{ marginBottom: 12 }}><strong>Status:</strong> <Badge bg={statusVariant(selected.status)}>{selected.status}</Badge></div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
                        <Button size="sm" variant="success" disabled={!canControl || actionBusy} onClick={()=>doAction('start', selected.unit)}>Start</Button>
                        <Button size="sm" variant="warning" disabled={!canControl || actionBusy} onClick={()=>doAction('restart', selected.unit)}>Restart</Button>
                        <Button size="sm" variant="danger" disabled={!canControl || actionBusy} onClick={()=>doAction('stop', selected.unit)}>Stop</Button>
                        {actionBusy && <Spinner animation="border" size="sm" />}
                      </div>
                      {!canControl && (
                        <div style={{ color:'#666', fontSize: 12, marginBottom: 8 }}>Admin permissions required to run actions</div>
                      )}
                      {actionError && <div style={{ color:'#c00', marginBottom: 8 }}>{actionError}</div>}
                      <div style={{ fontWeight: 600, marginBottom: 6 }}>Recent logs</div>
                      <div style={{
                        background:'#0f0f0f', color:'#d0d0d0', fontFamily:'monospace',
                        borderRadius:6, padding:10, maxHeight:200, overflow:'auto'
                      }}>
                        {logsLoading ? <Spinner animation="border" size="sm" /> : (
                          <pre style={{ margin:0, whiteSpace:'pre-wrap' }}>{logs}</pre>
                        )}
                      </div>
                    </div>
                  )}
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="secondary" onClick={() => setSelected(null)}>Close</Button>
                </Modal.Footer>
              </Modal>
            </>
          )}
        </div>
      </Card.Body>
    </Card>
  );
}
