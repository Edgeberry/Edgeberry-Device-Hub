import { useEffect, useState } from 'react';
import { Alert, Badge, Card, Col, Container, Row, Table } from 'react-bootstrap';
import { useParams } from 'react-router-dom';
import { getDevice, getDeviceEvents } from '../api/fleethub';

const DeviceDetail = (props:{user:any})=>{
  const { assetId } = useParams();
  const [device, setDevice] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [error, setError] = useState<string>('');

  useEffect(()=>{
    (async()=>{
      if(!assetId) return;
      try{
        const d = await getDevice(assetId);
        if(d?.message){ setError(d.message); return; }
        setDevice(d);
        const ev = await getDeviceEvents(assetId);
        if(ev?.message){ setError(ev.message); return; }
        setEvents(Array.isArray(ev)?ev:[]);
      }catch(err:any){
        setError(err?.toString?.()||'Failed to load device');
      }
    })();
  },[assetId]);

  return (
    <Container style={{textAlign:'left'}}>
      <br/>
      {error? <Alert variant='danger'>{error}</Alert>:null}
      <h1>{device?.name || assetId}</h1>
      <p className='text-subtitle'>ID: <code>{device?.id||assetId}</code> {device?.status? <Badge bg={device.status==='active'?'success':device.status==='suspended'?'warning':'secondary'}>{device.status}</Badge>:null}</p>

      <Row className='gy-3'>
        <Col md={6}>
          <Card>
            <Card.Header>Overview</Card.Header>
            <Card.Body>
              <p>Model: {device?.model||'-'}</p>
              <p>Firmware: {device?.firmware_version||'-'}</p>
              <p>Tags: {Array.isArray(device?.tags)? device.tags.join(', '): device?.tags || '-'}</p>
              <p>Enrolled: {device?.enrolled_at || '-'}</p>
              <p>Last seen: {device?.last_seen || '-'}</p>
            </Card.Body>
          </Card>
        </Col>
        <Col md={6}>
          <Card>
            <Card.Header>Events</Card.Header>
            <Card.Body>
              <Table size='sm' responsive>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Type</th>
                    <th>Payload</th>
                  </tr>
                </thead>
                <tbody>
                  {events.length? events.map((e:any, i:number)=>
                    <tr key={i}>
                      <td>{e?.timestamp || e?.created_at || '-'}</td>
                      <td>{e?.type || '-'}</td>
                      <td><code style={{whiteSpace:'pre-wrap'}}>{typeof e?.payload==='string'? e.payload: JSON.stringify(e?.payload)}</code></td>
                    </tr>
                  ): <tr><td colSpan={3}><em>No events</em></td></tr>}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}

export default DeviceDetail;
