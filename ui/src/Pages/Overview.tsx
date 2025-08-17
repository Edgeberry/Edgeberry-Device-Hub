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
import { Badge, Button, Card, Table } from 'react-bootstrap';
import ServiceStatusWidget from '../components/ServiceStatusWidget';
import SystemMetricsWidget from '../components/SystemMetricsWidget';
import { getDevices, decommissionDevice, deleteWhitelistByDevice } from '../api/devicehub';
import { subscribe as wsSubscribe, unsubscribe as wsUnsubscribe, isConnected as wsIsConnected } from '../api/socket';
import { Link } from 'react-router-dom';
import DeviceDetailModal from '../components/DeviceDetailModal';
import CertificateSettingsModal from '../components/CertificateSettingsModal';
import WhitelistModal from '../components/WhitelistModal';

export default function Overview(props:{user:any}){
  const [devices, setDevices] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [showCerts, setShowCerts] = useState(false);
  const [showWhitelist, setShowWhitelist] = useState(false);

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
      <SystemMetricsWidget user={props.user} />
      <ServiceStatusWidget user={props.user} />

      <Card>
        <Card.Header className="d-flex justify-content-between align-items-center">
          <span>Devices</span>
          <div className="d-flex gap-2">
            <Button size="sm" variant="outline-secondary" onClick={()=> setShowWhitelist(true)} disabled={!props.user}>
              Whitelist
            </Button>
            <Button size="sm" variant="outline-primary" onClick={()=> setShowCerts(true)} disabled={!props.user}>
              Certificates
            </Button>
          </div>
        </Card.Header>
        <Card.Body>
          <Table size="sm" responsive hover>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Status</th>
                <th>Last seen</th>
                <th style={{width:140}}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(devices||[]).map((d:any)=> {
                const id = d.id || d._id || d.name;
                const open = () => setSelected(String(id));
                const onKeyDown = (e: React.KeyboardEvent<HTMLTableRowElement>) => {
                  if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); open(); }
                };
                const onDecommission = async (e: React.MouseEvent) => {
                  e.stopPropagation();
                  if (!id) return;
                  if (!confirm(`Decommission device "${id}"? This removes it from the devices list.`)) return;
                  try{
                    setActionBusy(String(id));
                    const res:any = await decommissionDevice(String(id));
                    // If whitelist entries remain, offer to remove them
                    const wlCount = Number(res?.whitelist_entries || 0);
                    if (wlCount > 0) {
                      const also = confirm(`There are ${wlCount} whitelist entr${wlCount===1?'y':'ies'} for this device. Remove them now?`);
                      if (also) {
                        await deleteWhitelistByDevice(String(id));
                      }
                    }
                    // Refresh devices list
                    try{ const d = await getDevices(); const list = Array.isArray(d?.devices) ? d.devices : (Array.isArray(d) ? d : []); setDevices(list); }catch{}
                  } finally {
                    setActionBusy(null);
                  }
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
                    <td>
                      <div className="d-flex gap-2">
                        <Button size="sm" variant="outline-danger" disabled={!props.user || actionBusy===String(id)} onClick={onDecommission}>
                          {actionBusy===String(id) ? 'Working…' : 'Decommission'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card.Body>
      </Card>

      <DeviceDetailModal deviceId={selected||''} show={!!selected} onClose={()=> setSelected(null)} />
      <CertificateSettingsModal show={showCerts} onClose={()=> setShowCerts(false)} user={props.user} />
      <WhitelistModal show={showWhitelist} onClose={()=> setShowWhitelist(false)} user={props.user} />
    </div>
  );
}
