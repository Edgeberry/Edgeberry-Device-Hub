import { useEffect, useState } from 'react';
import { Alert, Badge, Card, Col, Container, Row } from 'react-bootstrap';
import { getHealth, getPublicConfig, getStatus } from '../api/devicehub';

const Health = ()=>{
  const [health, setHealth] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  const [error, setError] = useState<string>('');

  useEffect(()=>{
    (async()=>{
      try{
        setHealth(await getHealth());
        setStatus(await getStatus());
        setConfig(await getPublicConfig());
      }catch(err:any){
        setError(err?.toString?.()||'Failed to load health');
      }
    })();
  },[]);

  return (
    <Container style={{textAlign:'left'}}>
      <h3>Health</h3>
      {error? <Alert variant='danger'>{error}</Alert>: null}
      <Row>
        <Col md={6}><Card className='mb-3'><Card.Body><div><b>Health</b></div><div>{JSON.stringify(health)}</div></Card.Body></Card></Col>
        <Col md={6}><Card className='mb-3'><Card.Body><div><b>Status</b></div><div>{JSON.stringify(status)}</div></Card.Body></Card></Col>
      </Row>
      <Row>
        <Col md={12}><Card className='mb-3'><Card.Body><div><b>Config</b></div><div><pre style={{margin:0}}>{JSON.stringify(config,null,2)}</pre></div></Card.Body></Card></Col>
      </Row>
    </Container>
  );
}
export default Health;
