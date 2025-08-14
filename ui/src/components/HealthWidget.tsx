import { useEffect, useState } from 'react';
import { Card, Col, Row, Badge, Spinner } from 'react-bootstrap';
import { getHealth, getStatus, getVersion, getPublicConfig } from '../api/fleethub';

const HealthWidget = ()=>{
  const [loading, setLoading] = useState<boolean>(true);
  const [health, setHealth] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [version, setVersion] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  const [error, setError] = useState<string>('');

  useEffect(()=>{
    (async ()=>{
      setLoading(true);
      setError('');
      try{
        const h = await getHealth();
        setHealth(h);
      }catch(e:any){
        setError(e?.message || 'Failed to load health');
      }
      // Best-effort: these may not exist yet on the backend
      try{ setStatus(await getStatus()); }catch{ /* ignore */ }
      try{ setVersion(await getVersion()); }catch{ /* ignore */ }
      try{ setConfig(await getPublicConfig()); }catch{ /* ignore */ }
      setLoading(false);
    })();
  },[]);

  const healthy = health?.health === 'ok' || health?.ok === true;
  const uptime = (status && (status.uptime || status.uptimeSeconds)) || '-';
  const svc = (version && (version.service || version.name)) || 'Fleet Hub';
  const ver = (version && (version.version || version.git)) || '-';
  const env = (config && (config.env || config.environment)) || '-';

  return (
    <Card className="mb-3" data-testid="health-widget">
      <Card.Body>
        <Row>
          <Col md="3" sm="6" xs="12">
            <div><strong>Status</strong></div>
            {loading ? <Spinner animation="border" size="sm"/> : (
              <Badge bg={healthy? 'success' : 'danger'}>{healthy ? 'Healthy' : 'Degraded'}</Badge>
            )}
          </Col>
          <Col md="3" sm="6" xs="12">
            <div><strong>Uptime</strong></div>
            <div>{loading? '...' : uptime}</div>
          </Col>
          <Col md="3" sm="6" xs="12">
            <div><strong>Version</strong></div>
            <div>{loading? '...' : `${svc} ${ver}`}</div>
          </Col>
          <Col md="3" sm="6" xs="12">
            <div><strong>Environment</strong></div>
            <div>{loading? '...' : env}</div>
          </Col>
        </Row>
        {error? <div style={{marginTop:8, color:'#c00'}}>{error}</div>: null}
      </Card.Body>
    </Card>
  );
}
export default HealthWidget;
