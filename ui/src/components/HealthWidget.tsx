/**
 * Health widget
 *
 * Summarizes service health/status/version/public config using `/api/health`,
 * `/api/status`, `/api/version`, and `/api/config/public`. Intended for quick
 * at-a-glance status on the dashboard.
 */
import { useEffect, useState } from 'react';
import { Card, Col, Row, Badge, Spinner } from 'react-bootstrap';
import { getHealth, getStatus, getPublicConfig, getVersion } from '../api/devicehub';

const HealthWidget = ()=>{
  const [loading, setLoading] = useState<boolean>(true);
  const [health, setHealth] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  const [versionInfo, setVersionInfo] = useState<any>(null);
  const [error, setError] = useState<string>('');

  useEffect(()=>{
    (async ()=>{
      setLoading(true);
      setError('');
      try{
        const h = await getHealth();
        console.log('Health response:', h);
        setHealth(h);
      }catch(e:any){
        console.error('Error fetching health:', e);
        setError(e?.message || 'Failed to load health');
      }
      // Best-effort: these may not exist yet on the backend
      try{ 
        const statusData = await getStatus();
        console.log('Status response:', statusData);
        setStatus(statusData); 
      }catch(e){ 
        console.error('Error fetching status:', e);
      }
      try{ 
        const configData = await getPublicConfig();
        console.log('Config response:', configData);
        setConfig(configData); 
      }catch(e){ 
        console.error('Error fetching config:', e);
      }
      try{ 
        const versionData = await getVersion();
        console.log('Version response:', versionData);
        setVersionInfo(versionData); 
      }catch(e){ 
        console.error('Error fetching version:', e);
      }
      setLoading(false);
    })();
  },[]);

  const healthy = health?.health === 'ok' || health?.ok === true;
  const uptime = (status && (status.uptime || status.uptimeSeconds)) || '-';
  const env = (config && (config.env || config.environment)) || '-';

  return (
    <Card className="mb-3" data-testid="health-widget">
      <Card.Body>
        <Row className="mb-2">
          <Col md="4" sm="6" xs="12" className="mb-2">
            <div><strong>Status</strong></div>
            {loading ? <Spinner animation="border" size="sm"/> : (
              <Badge bg={healthy? 'success' : 'danger'}>{healthy ? 'Healthy' : 'Degraded'}</Badge>
            )}
          </Col>
          <Col md="4" sm="6" xs="12" className="mb-2">
            <div><strong>Uptime</strong></div>
            <div>{loading? '...' : uptime}</div>
          </Col>
          <Col md="4" sm="6" xs="12" className="mb-2">
            <div><strong>Environment</strong></div>
            <div>{loading? '...' : env}</div>
          </Col>
        </Row>
        <Row>
          <Col xs="12">
            <div className="text-muted small">
              {loading ? 'Loading versions...' : (
                <>
                  {versionInfo?.components?.mosquitto && (
                    <span className="me-3">Mosquitto: {versionInfo.components.mosquitto}</span>
                  )}
                  {versionInfo?.components?.dbus && (
                    <span>D-Bus: {versionInfo.components.dbus}</span>
                  )}
                </>
              )}
            </div>
          </Col>
        </Row>
        {error? <div style={{marginTop:8, color:'#c00'}}>{error}</div>: null}
      </Card.Body>
    </Card>
  );
}
export default HealthWidget;

