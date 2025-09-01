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
import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Badge, Button, Card, Table, Spinner } from 'react-bootstrap';
import ServiceStatusWidget from '../components/ServiceStatusWidget';
import SystemMetricsWidget from '../components/SystemMetricsWidget';
import { getDevices, decommissionDevice, deleteWhitelistByDevice } from '../api/devicehub';
import { subscribe as wsSubscribe, unsubscribe as wsUnsubscribe, isConnected as wsIsConnected } from '../api/socket';
import { Link } from 'react-router-dom';
import DeviceDetailModal from '../components/DeviceDetailModal';
import CertificateSettingsModal from '../components/CertificateSettingsModal';
import WhitelistModal from '../components/WhitelistModal';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTrash, faRightLeft, faLocationDot, faEye, faExchange } from '@fortawesome/free-solid-svg-icons';

export default function Overview(props:{user:any}){
  const [devices, setDevices] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [showCerts, setShowCerts] = useState(false);
  const [showWhitelist, setShowWhitelist] = useState(false);
  // Re-render every second to update relative offline timers
  const [now, setNow] = useState<number>(()=> Date.now());
  useEffect(()=>{ const t = setInterval(()=> setNow(Date.now()), 1000); return ()=> clearInterval(t); },[]);

  const formatOfflineSince = (last_seen?: string|null): string => {
    if (!last_seen) return '';
    const diffSec = Math.max(0, Math.floor((now - Date.parse(last_seen)) / 1000));
    if (diffSec < 120) {
      return `${diffSec} ${diffSec === 1 ? 'second' : 'seconds'}`;
    }
    const mins = Math.floor(diffSec / 60);
    if (mins < 60) {
      return `${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
    }
    const hours = Math.floor(mins / 60);
    if (hours < 24) {
      return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
    }
    const days = Math.floor(hours / 24);
    if (days < 7) {
      return `${days} ${days === 1 ? 'day' : 'days'}`;
    }
    const weeks = Math.floor(days / 7);
    if (weeks < 5) {
      return `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
    }
    const months = Math.floor(days / 30);
    if (months < 12) {
      return `${months} ${months === 1 ? 'month' : 'months'}`;
    }
    const years = Math.floor(days / 365);
    return `${years} ${years === 1 ? 'year' : 'years'}`;
  };

  useEffect(()=>{ 
    let mounted = true;
    const onDevices = (data: any) => {
      if(!mounted) return;
      try{
        const list = Array.isArray(data?.devices) ? data.devices : [];
        setDevices(list);
      }catch{}
    };
    
    const onDeviceStatus = (data: any) => {
      if(!mounted || !data?.deviceId) return;
      try{
        setDevices(prevDevices => 
          prevDevices.map(device => {
            const deviceUuid = device.uuid;
            if (String(deviceUuid) === String(data.deviceId)) {
              return {
                ...device,
                online: data.status,
                last_seen: data.status ? null : data.timestamp
              };
            }
            return device;
          })
        );
      }catch{}
    };
    
    const devicesTopic = props.user ? 'devices.list' : 'devices.list.public';
    const statusTopic = props.user ? 'device.status' : 'device.status.public';
    
    wsSubscribe(devicesTopic, onDevices);
    wsSubscribe(statusTopic, onDeviceStatus);
    
    (async()=>{ if(!wsIsConnected()){ try{ const d = await getDevices(); const list = Array.isArray(d?.devices) ? d.devices : (Array.isArray(d) ? d : []); if(mounted) setDevices(list); }catch{ if(mounted) setDevices([]); } } })();
    return ()=>{ 
      mounted = false; 
      wsUnsubscribe(devicesTopic, onDevices); 
      wsUnsubscribe(statusTopic, onDeviceStatus);
    };
  },[props.user]);

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
                {props.user ? (<th>UUID</th>) : null}
                <th>Name</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(devices||[]).map((d:any)=> {
                const uuid = d.uuid;
                const name = d.name;
                const status = d.online ? 'online' : 'offline';
                const open = () => setSelected(String(uuid));
                const onDecommission = async (e: React.MouseEvent) => {
                  e.stopPropagation();
                  if (!uuid) return;
                  if (!confirm(`Decommission device "${name || uuid}"? This removes it from the devices list.`)) return;
                  try{
                    setActionBusy(String(uuid));
                    const res:any = await decommissionDevice(String(uuid));
                    // If whitelist entries remain, offer to remove them
                    const wlCount = Number(res?.whitelist_entries || 0);
                    if (wlCount > 0) {
                      const also = confirm(`There are ${wlCount} whitelist entr${wlCount===1?'y':'ies'} for this device. Remove them now?`);
                      if (also) {
                        await deleteWhitelistByDevice(String(uuid));
                      }
                    }
                    // Refresh devices list
                    try{ const d = await getDevices(); const list = Array.isArray(d?.devices) ? d.devices : (Array.isArray(d) ? d : []); setDevices(list); }catch{}
                  } finally {
                    setActionBusy(null);
                  }
                };
                const onReplace = async (e: React.MouseEvent) => {
                  e.stopPropagation();
                  // Placeholder for device replacement flow (select another device to swap IDs/records)
                  alert('Replace device: feature not yet implemented. This will allow selecting another device to replace this one.');
                };

                const onIdentify = async (e: React.MouseEvent) => {
                  e.stopPropagation();
                  // Placeholder for device identification flow (select another device to swap IDs/records)
                  alert('Identify device: feature not yet implemented. This will allow selecting another device to identify this one.');
                };
                
                const displayName = name || `EDGB-${uuid.substring(0, 4).toUpperCase()}`;

                return (
                  <tr key={uuid} className={`${status === 'online' ? 'table-success' : status === 'offline' ? 'table-secondary' : ''}`}>
                    {props.user ? (<td>{uuid || '-'}</td>) : null}
                    <td>
                      <Link to={`/devices/${encodeURIComponent(uuid)}`} className="text-decoration-none">{displayName}</Link>
                    </td>
                    <td>{status || 'unknown'}</td>
                    <td>
                      <div className="btn-group" role="group">
                        <button type="button" className="btn btn-sm btn-outline-primary" onClick={open}>
                          <FontAwesomeIcon icon={faEye} />
                        </button>
                        {props.user ? (
                          <>
                            <button type="button" className="btn btn-sm btn-outline-warning" onClick={onDecommission}>
                              <FontAwesomeIcon icon={faTrash} />
                            </button>
                            <button type="button" className="btn btn-sm btn-outline-info" onClick={onReplace}>
                              <FontAwesomeIcon icon={faExchange} />
                            </button>
                          </>
                        ) : null}
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
