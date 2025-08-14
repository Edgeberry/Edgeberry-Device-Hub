/**
 * Overview Page
 *
 * Purpose: Landing dashboard for authenticated users.
 *  - Renders `HealthWidget`, `ServiceStatusWidget`, and `SystemMetricsWidget`.
 *  - Shows a small devices table linking to `DeviceDetail`.
 *
 * Data:
 *  - Devices: fetched via `getDevices()` from `ui/src/api/fleethub.ts`.
 *  - Widgets fetch their own data from the backend (`/api/health`, `/api/services`, `/api/metrics`).
 *
 * Auth:
 *  - This route is protected by `RequireAuth` in `App.tsx`. `props.user` is the authenticated admin.
 */
import React, { useEffect, useState } from 'react';
import { Card, Table } from 'react-bootstrap';
import HealthWidget from '../components/HealthWidget';
import ServiceStatusWidget from '../components/ServiceStatusWidget';
import SystemMetricsWidget from '../components/SystemMetricsWidget';
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
      <SystemMetricsWidget />

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
