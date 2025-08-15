/**
 * Overview Page
 *
 * Purpose: Landing dashboard for authenticated users.
 *  - Renders `HealthWidget`, `ServiceStatusWidget`, and `SystemMetricsWidget`.
 *  - Shows a small devices table linking to `DeviceDetail`.
 *
 * Data:
 *  - Devices: fetched via `getDevices()` from `ui/src/api/devicehub.ts`.
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
import { getDevices } from '../api/devicehub';
import { subscribe as wsSubscribe, unsubscribe as wsUnsubscribe, isConnected as wsIsConnected } from '../api/socket';
import { Link } from 'react-router-dom';
import DeviceDetailModal from '../components/DeviceDetailModal';

export default function Overview(props:{user:any}){
  const [devices, setDevices] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

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
              {(devices||[]).map((d:any)=> {
                const id = d.id || d._id || d.name;
                const open = () => setSelected(String(id));
                const onKeyDown = (e: React.KeyboardEvent<HTMLTableRowElement>) => {
                  if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); open(); }
                };
                return (
                  <tr key={id}
                      tabIndex={0}
                      role="button"
                      onClick={open}
                      onKeyDown={onKeyDown}
                      style={{ cursor:'pointer' }}>
                    <td>
                      {/* Keep deep-link for optional navigation, but clicking row opens modal */}
                      <Link to={`/devices/${encodeURIComponent(id)}`} onClick={(e)=>{ e.preventDefault(); open(); }}>{id}</Link>
                    </td>
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
                );
              })}
            </tbody>
          </Table>
        </Card.Body>
      </Card>

      <DeviceDetailModal deviceId={selected||''} show={!!selected} onClose={()=> setSelected(null)} />
    </div>
  );
}
