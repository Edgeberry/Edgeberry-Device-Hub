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
import { Badge, Card, Table } from 'react-bootstrap';
import HealthWidget from '../components/HealthWidget';
import ServiceStatusWidget from '../components/ServiceStatusWidget';
import SystemMetricsWidget from '../components/SystemMetricsWidget';
import { getDevices } from '../api/fleethub';
import { subscribe as wsSubscribe, unsubscribe as wsUnsubscribe, isConnected as wsIsConnected } from '../api/socket';
import { Link } from 'react-router-dom';

export default function Overview(props:{user:any}){
  const [devices, setDevices] = useState<any[]>([]);

  useEffect(()=>{ 
    let mounted = true;
    const onDevices = (data: any) => {
      if(!mounted) return;
      try{
        const list = Array.isArray(data?.devices) ? data.devices : [];
        setDevices(list);
      }catch{}
    };
    wsSubscribe('devices.list', onDevices);
    (async()=>{ if(!wsIsConnected()){ try{ const d = await getDevices(); const list = Array.isArray(d?.devices) ? d.devices : (Array.isArray(d) ? d : []); if(mounted) setDevices(list); }catch{ if(mounted) setDevices([]); } } })();
    return ()=>{ mounted = false; wsUnsubscribe('devices.list', onDevices); };
  },[]);

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
                <th>Status</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {(devices||[]).map((d:any)=> (
                <tr key={d.id || d._id || d.name}>
                  <td><Link to={`/devices/${encodeURIComponent(d.id || d._id || d.name)}`}>{d.id || d._id || d.name}</Link></td>
                  <td>{d.name || '-'}</td>
                  <td>
                    {d.online ? (
                      <Badge bg="success">Online</Badge>
                    ) : (
                      <Badge bg="secondary">Offline</Badge>
                    )}
                  </td>
                  <td>{d.last_seen ? new Date(d.last_seen).toLocaleString() : '-'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card.Body>
      </Card>
    </div>
  );
}
