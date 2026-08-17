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
 *  - Login is required to reach this page at all (see Dashboard's auth gate).
 */
import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Badge, Button, Card, Table, Spinner } from 'react-bootstrap';
import SystemWidget from '../components/SystemWidget';
import ApplicationsWidget from '../components/ApplicationsWidget';
import { getDevices, decommissionDevice, deleteWhitelistByDevice, setDeviceRole } from '../api/devicehub';
import { roleLabelFor } from '../deviceDisplay';
import { direct_identifySystem } from '../api/directMethods';
import { subscribe as wsSubscribe, unsubscribe as wsUnsubscribe, isConnected as wsIsConnected } from '../api/socket';
import { Link } from 'react-router-dom';
import DeviceDetailModal from '../components/DeviceDetailModal';
import CertificateSettingsModal from '../components/CertificateSettingsModal';
import WhitelistModal from '../components/WhitelistModal';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTrash, faLocationDot, faEye, faSearch, faPen, faListCheck, faCloudArrowDown } from '@fortawesome/free-solid-svg-icons';

export default function Overview(){
  const [devices, setDevices] = useState<any[]>([]);
  const [filteredDevices, setFilteredDevices] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [showCerts, setShowCerts] = useState(false);
  const [showWhitelist, setShowWhitelist] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [roleInput, setRoleInput] = useState('');
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
    
    wsSubscribe('devices.list', onDevices);
    wsSubscribe('device.status', onDeviceStatus);

    (async()=>{ if(!wsIsConnected()){ try{ const d = await getDevices(); const list = Array.isArray(d?.devices) ? d.devices : (Array.isArray(d) ? d : []); if(mounted) { setDevices(list); setFilteredDevices(list); } }catch{ if(mounted) { setDevices([]); setFilteredDevices([]); } } } })();
    return ()=>{
      mounted = false;
      wsUnsubscribe('devices.list', onDevices);
      wsUnsubscribe('device.status', onDeviceStatus);
    };
  },[]);

  // Search functionality
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredDevices(devices);
      return;
    }
    
    const query = searchQuery.toLowerCase();
    const filtered = devices.filter((device: any) => {
      const role = (device.role || '').toLowerCase();
      const uuid = (device.uuid || '').toLowerCase();
      return role.includes(query) || uuid.includes(query);
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

  const handleEditRole = (uuid: string, currentRole: string|null) => {
    setEditingRole(uuid);
    setRoleInput(currentRole || '');
  };

  const handleCancelEditRole = () => {
    setEditingRole(null);
    setRoleInput('');
  };

  const handleSaveRole = async (uuid: string, previousRole: string|null) => {
    const nextRole = roleInput.trim();
    if (nextRole === (previousRole || '')) { handleCancelEditRole(); return; }
    try {
      setActionBusy(uuid);
      await setDeviceRole(uuid, nextRole || null);
      await refreshDevices();
      handleCancelEditRole();
    } catch (error) {
      // Failed to update role - error handled by UI state
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
      {/* System is diagnostics, not the headline, so it starts collapsed (see
          SystemWidget) - but its collapsed bar sits at the very top of the
          page, out of the way of Devices/Applications below without needing
          a scroll past everything else to reach it. */}
      <SystemWidget />

      <Card className="mb-4">
        <Card.Header className="d-flex justify-content-between align-items-center">
          <div>
            <i className="fa-solid fa-microchip me-2"></i>
            Devices
          </div>
          <div className="d-flex gap-2">
            <Button size="sm" variant="outline-secondary" onClick={()=> setShowWhitelist(true)} title="Whitelist">
              <FontAwesomeIcon icon={faListCheck} />
            </Button>
            <Button size="sm" variant="outline-secondary" onClick={()=> setShowCerts(true)} title="Provisioning">
              <FontAwesomeIcon icon={faCloudArrowDown} />
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
                  <th>Role</th>
                  <th>Device ID</th>
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
                  const roleLabel = roleLabelFor(d);
                  const isBusy = actionBusy === uuid;
                  const isEditingRole = editingRole === uuid;

                  return (
                    <tr key={uuid} className="device-row" onClick={open} style={{cursor: 'pointer'}}>
                      <td onClick={isEditingRole ? (e) => e.stopPropagation() : undefined}>
                        {isEditingRole ? (
                          <div className="d-flex gap-1" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="text"
                              className="form-control form-control-sm"
                              placeholder="role name"
                              value={roleInput}
                              onChange={(e) => setRoleInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveRole(uuid, d.role);
                                if (e.key === 'Escape') handleCancelEditRole();
                              }}
                              autoFocus
                            />
                            <button className="btn btn-sm btn-success" onClick={() => handleSaveRole(uuid, d.role)} disabled={isBusy}>
                              ✓
                            </button>
                            <button className="btn btn-sm btn-secondary" onClick={handleCancelEditRole} disabled={isBusy}>
                              ✗
                            </button>
                          </div>
                        ) : (
                          <>
                            <span className={d.role ? undefined : 'text-muted'}>{roleLabel}</span>
                            <button
                              type="button"
                              className="btn btn-sm btn-edgeberry device-actions ms-1"
                              style={{padding:'0 6px'}}
                              onClick={(e) => { e.stopPropagation(); handleEditRole(uuid, d.role); }}
                              title="Edit role"
                            >
                              <FontAwesomeIcon icon={faPen} size="xs" />
                            </button>
                          </>
                        )}
                      </td>
                      <td>{uuid || '-'}</td>
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
                          <button
                            type="button"
                            className="btn btn-sm btn-edgeberry"
                            onClick={() => handleIdentifyDevice(uuid, roleLabel)}
                            disabled={isBusy}
                            title="Identify Device"
                          >
                            <FontAwesomeIcon icon={faLocationDot} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-edgeberry"
                            onClick={() => handleDeleteDevice(uuid, roleLabel)}
                            disabled={isBusy}
                          >
                            {isBusy ? <Spinner animation="border" size="sm" /> : <FontAwesomeIcon icon={faTrash} />}
                          </button>
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

      <ApplicationsWidget />

      <DeviceDetailModal deviceId={selected||''} show={!!selected} onClose={()=> setSelected(null)} />
      <CertificateSettingsModal show={showCerts} onClose={()=> setShowCerts(false)} />
      <WhitelistModal show={showWhitelist} onClose={()=> setShowWhitelist(false)} />
    </div>
  );
}
