import React, { useEffect, useState } from 'react';
import { Card, Table } from 'react-bootstrap';
import HealthWidget from '../components/HealthWidget';
import ServiceStatusWidget from '../components/ServiceStatusWidget';
import { getDevices } from '../api/fleethub';
import { Link } from 'react-router-dom';

export default function Overview(props:{user:any}){
  const [devices, setDevices] = useState<any[]>([]);

  useEffect(()=>{ (async()=>{ 
    try{ 
      const d = await getDevices(); 
      const list = Array.isArray(d?.devices) ? d.devices : (Array.isArray(d) ? d : []);
      setDevices(list);
    }catch{ setDevices([]); }
  })(); },[]);

  return (
    <div>
      <HealthWidget />
      <ServiceStatusWidget user={props.user} />

      <Card>
        <Card.Header>Devices</Card.Header>
        <Card.Body>
          <Table size="sm" responsive hover>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
              </tr>
            </thead>
            <tbody>
              {(devices||[]).map((d:any)=> (
                <tr key={d.id || d._id || d.name}>
                  <td><Link to={`/devices/${encodeURIComponent(d.id || d._id || d.name)}`}>{d.id || d._id || d.name}</Link></td>
                  <td>{d.name || '-'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card.Body>
      </Card>
    </div>
  );
}
