/**
 * Overview Page
 *
 * Purpose: Landing dashboard for authenticated users.
 *  - Renders `SystemWidget` (merged services and metrics).
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
import SystemWidget from '../components/SystemWidget';
import ApplicationsWidget from '../components/ApplicationsWidget';
import { getDevices, decommissionDevice, deleteWhitelistByDevice } from '../api/devicehub';
import { displayNameFor } from '../deviceDisplay';
import { direct_identifySystem } from '../api/directMethods';
import { subscribe as wsSubscribe, unsubscribe as wsUnsubscribe, isConnected as wsIsConnected } from '../api/socket';
import { Link } from 'react-router-dom';
import DeviceDetailModal from '../components/DeviceDetailModal';
import CertificateSettingsModal from '../components/CertificateSettingsModal';
import WhitelistModal from '../components/WhitelistModal';
import RolesModal from '../components/RolesModal';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTrash, faLocationDot, faEye, faSearch, faUserTag } from '@fortawesome/free-solid-svg-icons';

export default function Overview(props:{user:any}){
  const [devices, setDevices] = useState<any[]>([]);
  const [filteredDevices, setFilteredDevices] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [showCerts, setShowCerts] = useState(false);
  const [showWhitelist, setShowWhitelist] = useState(false);
  const [showRoles, setShowRoles] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
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
        setFilteredDevices(list);
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
    
    (async()=>{ if(!wsIsConnected()){ try{ const d = await getDevices(); const list = Array.isArray(d?.devices) ? d.devices : (Array.isArray(d) ? d : []); if(mounted) { setDevices(list); setFilteredDevices(list); } }catch{ if(mounted) { setDevices([]); setFilteredDevices([]); } } } })();
    return ()=>{ 
      mounted = false; 
      wsUnsubscribe(devicesTopic, onDevices); 
      wsUnsubscribe(statusTopic, onDeviceStatus);
    };
  },[props.user]);

  // Search functionality
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredDevices(devices);
      return;
    }
    
    const query = searchQuery.toLowerCase();
    const filtered = devices.filter((device: any) => {
      const name = (device.name || '').toLowerCase();
      const uuid = (device.uuid || '').toLowerCase();
      const group = (device.group || '').toLowerCase();
      return name.includes(query) || uuid.includes(query) || group.includes(query);
    });
    setFilteredDevices(filtered);
  }, [devices, searchQuery]);

  // Device action handlers
  const refreshDevices = async () => {
    try { 
      const d = await getDevices(); 
      const list = Array.isArray(d?.devices) ? d.devices : (Array.isArray(d) ? d : []); 
      setDevices(list); 
      setFilteredDevices(list);
    } catch {}
  };

  const handleDeleteDevice = async (uuid: string, name: string) => {
    if (!confirm(`Delete device "${name || uuid}"? This removes it from the registry only.`)) return;
    try {
      setActionBusy(uuid);
      const res: any = await decommissionDevice(uuid);
      // If whitelist entries remain, offer to remove them
      const wlCount = Number(res?.whitelist_entries || 0);
      if (wlCount > 0) {
        const also = confirm(`There are ${wlCount} whitelist entr${wlCount === 1 ? 'y' : 'ies'} for this device. Remove them now?`);
        if (also) {
          await deleteWhitelistByDevice(uuid);
        }
      }
      await refreshDevices();
    } catch (error) {
      // Failed to delete device - error handled by UI state
    } finally {
      setActionBusy(null);
    }
  };

  const handleIdentifyDevice = async (uuid: string, name: string) => {
    try {
      setActionBusy(uuid);
      const result = await direct_identifySystem(uuid);
      if (result.ok) {
        // Success - device should now be identifying itself
        console.log(`Identify command sent to device "${name}"`);
      } else {
        alert(`Failed to identify device "${name}": ${result.message || 'Unknown error'}`);
      }
    } catch (error) {
      alert(`Failed to identify device "${name}": ${error}`);
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <div>
      {/* Devices and connected Applications are what Device Hub is for - they
          lead the page. System is diagnostics, not the headline, so it comes
          last and starts collapsed (see SystemWidget). */}
      <Card>
        <Card.Header className="d-flex justify-content-between align-items-center">
          <div>
            <i className="fa-solid fa-microchip me-2"></i>
            Devices
          </div>
          <div className="d-flex gap-2">
            <Button size="sm" variant="outline-secondary" onClick={()=> setShowRoles(true)} disabled={!props.user}>
              Roles
            </Button>
            <Button size="sm" variant="outline-secondary" onClick={()=> setShowWhitelist(true)} disabled={!props.user}>
              Whitelist
            </Button>
            <Button size="sm" variant="outline-primary" onClick={()=> setShowCerts(true)} disabled={!props.user}>
              Certificates
            </Button>
          </div>
        </Card.Header>
        <Card.Body>
          {/* Search */}
          <div className="d-flex align-items-center gap-2 mb-3">
            <FontAwesomeIcon icon={faSearch} className="text-muted" />
            <input
              type="text"
              className="form-control form-control-sm"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '300px' }}
            />
          </div>

          <Table size="sm" responsive className="device-list-table">
              <thead>
                <tr>
                  <th>Name</th>
                  {props.user ? (<th>UUID</th>) : null}
                  <th>Status</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(filteredDevices||[]).map((d:any)=> {
                  const uuid = d.uuid;
                  // Whitelist-disabled overrides connectivity: an admin blacklisted
                  // this device, so that takes precedence over whatever it last
                  // reported, same as the Disabled badge on the whitelist entry itself.
                  const status = d.disabled ? 'disabled' : (d.online ? 'online' : 'offline');
                  const open = () => setSelected(String(uuid));
                  const displayName = displayNameFor(d);
                  const isBusy = actionBusy === uuid;

                  return (
                    <tr key={uuid} className="device-row" onClick={open} style={{cursor: 'pointer'}}>
                      <td>
                        <span>{displayName}</span>
                        {/* A role-labeled device's raw MQTT name is still worth
                            showing, in small print - it's the actual wire
                            identity, and rotates independently of the role. */}
                        {d.role && d.name && (
                          <div className="text-muted small">{d.name}</div>
                        )}
                      </td>
                      {props.user ? (<td>{uuid || '-'}</td>) : null}
                      <td>
                        <Badge bg={status === 'online' ? 'success' : status === 'disabled' ? 'danger' : 'secondary'}>
                          {status || 'unknown'}
                        </Badge>
                      </td>
                      <td onClick={(e) => e.stopPropagation()} className="text-end">
                        <div className="btn-group device-actions" role="group">
                          <button type="button" className="btn btn-sm btn-edgeberry" onClick={open} disabled={isBusy}>
                            <FontAwesomeIcon icon={faEye} />
                          </button>
                          {props.user ? (
                            <>
                              <button
                                type="button"
                                className="btn btn-sm btn-edgeberry"
                                onClick={() => handleIdentifyDevice(uuid, displayName)}
                                disabled={isBusy}
                                title="Identify Device"
                              >
                                <FontAwesomeIcon icon={faLocationDot} />
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-edgeberry"
                                onClick={() => setShowRoles(true)}
                                disabled={isBusy}
                                title="Manage Role"
                              >
                                <FontAwesomeIcon icon={faUserTag} />
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-edgeberry"
                                onClick={() => handleDeleteDevice(uuid, displayName)}
                                disabled={isBusy}
                              >
                                {isBusy ? <Spinner animation="border" size="sm" /> : <FontAwesomeIcon icon={faTrash} />}
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

          {filteredDevices.length === 0 && (
            <div className="text-center text-muted py-4">
              {searchQuery ? 'No devices match your search.' : 'No devices found.'}
            </div>
          )}
        </Card.Body>
      </Card>

      <ApplicationsWidget user={props.user} />

      <SystemWidget user={props.user} />

      <DeviceDetailModal deviceId={selected||''} show={!!selected} onClose={()=> setSelected(null)} />
      <CertificateSettingsModal show={showCerts} onClose={()=> setShowCerts(false)} user={props.user} />
      <WhitelistModal show={showWhitelist} onClose={()=> setShowWhitelist(false)} user={props.user} />
      <RolesModal show={showRoles} onClose={()=> setShowRoles(false)} user={props.user} />
    </div>
  );
}
