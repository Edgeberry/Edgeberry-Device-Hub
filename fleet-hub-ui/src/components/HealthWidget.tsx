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
      try{
        setLoading(true);
        const [h,s,v,c] = await Promise.all([
          getHealth(),
          getStatus(),
          getVersion(),
          getPublicConfig()
        ]);
        setHealth(h);
        setStatus(s);
        setVersion(v);
        setConfig(c);
      }catch(e:any){
        setError(e?.message || 'Failed to load health');
      }finally{
        setLoading(false);
      }
    })();
  },[]);

  const healthy = health?.health === 'ok' || health?.ok === true;
  const uptime = status?.uptime || status?.uptimeSeconds || '-';
  const svc = version?.service || version?.name || 'Fleet Hub';
  const ver = version?.version || version?.git || '-';
  const env = config?.env || config?.environment || '-';

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
