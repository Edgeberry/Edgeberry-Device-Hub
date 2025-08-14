import { useEffect, useState } from 'react';
import { Alert, Badge, Card, Col, Container, Row } from 'react-bootstrap';
import { getHealth, getPublicConfig, getStatus, getVersion } from '../api/fleethub';

const Health = ()=>{
  const [health, setHealth] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [version, setVersion] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  const [error, setError] = useState<string>('');

  useEffect(()=>{
    (async()=>{
      try{
        setHealth(await getHealth());
        setStatus(await getStatus());
        setVersion(await getVersion());
        setConfig(await getPublicConfig());
      }catch(err:any){
        setError(err?.toString?.()||'Failed to load health');
      }
    })();
  },[]);

  return (
    <Container style={{textAlign:'left'}}>
      <br/>
      <h1>Health</h1>
      {error? <Alert variant='danger'>{error}</Alert>:null}
      <Row className='gy-3'>
        <Col md={6}>
          <Card>
            <Card.Header>Service</Card.Header>
            <Card.Body>
              <p>Health: {health?.ok? <Badge bg='success'>OK</Badge>:<Badge bg='danger'>DOWN</Badge>}</p>
              <p>Status: <code>{JSON.stringify(status)}</code></p>
              <p>Version: <code>{JSON.stringify(version)}</code></p>
            </Card.Body>
          </Card>
        </Col>
        <Col md={6}>
          <Card>
            <Card.Header>Public Config</Card.Header>
            <Card.Body>
              <pre style={{margin:0}}>{JSON.stringify(config,null,2)}</pre>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}

export default Health;
