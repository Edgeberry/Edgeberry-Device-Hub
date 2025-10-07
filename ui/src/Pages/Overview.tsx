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
import TokenManagementWidget from '../components/TokenManagementWidget';
import { getDevices, decommissionDevice, deleteWhitelistByDevice, updateDevice, replaceDevice } from '../api/devicehub';
import { direct_identifySystem } from '../api/directMethods';
import { subscribe as wsSubscribe, unsubscribe as wsUnsubscribe, isConnected as wsIsConnected } from '../api/socket';
import { Link } from 'react-router-dom';
import DeviceDetailModal from '../components/DeviceDetailModal';
import CertificateSettingsModal from '../components/CertificateSettingsModal';
import WhitelistModal from '../components/WhitelistModal';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTrash, faRightLeft, faLocationDot, faEye, faExchange, faEdit, faList, faTh, faSearch } from '@fortawesome/free-solid-svg-icons';

export default function Overview(props:{user:any}){
  const [devices, setDevices] = useState<any[]>([]);
  const [filteredDevices, setFilteredDevices] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [showCerts, setShowCerts] = useState(false);
  const [showWhitelist, setShowWhitelist] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'tile'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingDevice, setEditingDevice] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const [replaceSourceUuid, setReplaceSourceUuid] = useState<string | null>(null);
  const [replaceTargetUuid, setReplaceTargetUuid] = useState<string | null>(null);
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

  const handleEditDevice = (uuid: string, currentName: string) => {
    setEditingDevice(uuid);
    setEditName(currentName);
  };

  const handleSaveEdit = async () => {
    if (!editingDevice || !editName.trim()) return;
    try {
      setActionBusy(editingDevice);
      await updateDevice(editingDevice, editName.trim());
      await refreshDevices();
      setEditingDevice(null);
      setEditName('');
    } catch (error) {
      // Failed to update device - error handled by UI state
    } finally {
      setActionBusy(null);
    }
  };

  const handleCancelEdit = () => {
    setEditingDevice(null);
    setEditName('');
  };

  const handleReplaceDevice = (uuid: string) => {
    setReplaceSourceUuid(uuid);
    setShowReplaceModal(true);
  };

  const handleConfirmReplace = async () => {
    if (!replaceSourceUuid || !replaceTargetUuid) return;
    try {
      setActionBusy(replaceSourceUuid);
      const result = await replaceDevice(replaceSourceUuid, replaceTargetUuid);
      if (result.ok) {
        await refreshDevices();
        setShowReplaceModal(false);
        setReplaceSourceUuid(null);
        setReplaceTargetUuid(null);
      }
    } catch (error) {
      // Failed to replace device - error handled by UI state
    } finally {
      setActionBusy(null);
    }
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
      <SystemWidget user={props.user} />
      
      <TokenManagementWidget user={props.user} />

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
          {/* Search and View Controls */}
          <div className="d-flex justify-content-between align-items-center mb-3">
            <div className="d-flex align-items-center gap-2">
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
            <div className="btn-group" role="group">
              <button
                type="button"
                className={`btn btn-sm ${viewMode === 'list' ? 'btn-primary' : 'btn-outline-primary'}`}
                onClick={() => setViewMode('list')}
              >
                <FontAwesomeIcon icon={faList} /> List
              </button>
              <button
                type="button"
                className={`btn btn-sm ${viewMode === 'tile' ? 'btn-primary' : 'btn-outline-primary'}`}
                onClick={() => setViewMode('tile')}
              >
                <FontAwesomeIcon icon={faTh} /> Tiles
              </button>
            </div>
          </div>

          {/* Device Display */}
          {viewMode === 'list' ? (
            <Table size="sm" responsive className="device-list-table">
              <thead>
                <tr>
                  <th>Name</th>
                  {props.user ? (<th>UUID</th>) : null}
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(filteredDevices||[]).map((d:any)=> {
                  const uuid = d.uuid;
                  const name = d.name;
                  const status = d.online ? 'online' : 'offline';
                  const open = () => setSelected(String(uuid));
                  const displayName = name || `EDGB-${uuid.substring(0, 4).toUpperCase()}`;
                  const isEditing = editingDevice === uuid;
                  const isBusy = actionBusy === uuid;

                  return (
                    <tr key={uuid} className="device-row" onClick={open} style={{cursor: 'pointer'}}>
                      <td onClick={(e) => e.stopPropagation()}>
                        {isEditing ? (
                          <div className="d-flex gap-1">
                            <input
                              type="text"
                              className="form-control form-control-sm"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveEdit();
                                if (e.key === 'Escape') handleCancelEdit();
                              }}
                              autoFocus
                            />
                            <button className="btn btn-sm btn-success" onClick={handleSaveEdit} disabled={isBusy}>
                              ✓
                            </button>
                            <button className="btn btn-sm btn-secondary" onClick={handleCancelEdit} disabled={isBusy}>
                              ✗
                            </button>
                          </div>
                        ) : (
                          <span>{displayName}</span>
                        )}
                      </td>
                      {props.user ? (<td>{uuid || '-'}</td>) : null}
                      <td>
                        <Badge bg={status === 'online' ? 'success' : 'secondary'}>
                          {status || 'unknown'}
                        </Badge>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="btn-group" role="group">
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
                                onClick={() => handleEditDevice(uuid, displayName)}
                                disabled={isBusy || isEditing}
                              >
                                <FontAwesomeIcon icon={faEdit} />
                              </button>
                              <button 
                                type="button" 
                                className="btn btn-sm btn-edgeberry" 
                                onClick={() => handleDeleteDevice(uuid, displayName)}
                                disabled={isBusy}
                              >
                                {isBusy ? <Spinner animation="border" size="sm" /> : <FontAwesomeIcon icon={faTrash} />}
                              </button>
                              <button 
                                type="button" 
                                className="btn btn-sm btn-edgeberry" 
                                onClick={() => handleReplaceDevice(uuid)}
                                disabled={isBusy}
                              >
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
          ) : (
            /* Tile View */
            <div className="row">
              {(filteredDevices||[]).map((d:any)=> {
                const uuid = d.uuid;
                const name = d.name;
                const status = d.online ? 'online' : 'offline';
                const open = () => setSelected(String(uuid));
                const displayName = name || `EDGB-${uuid.substring(0, 4).toUpperCase()}`;
                const isEditing = editingDevice === uuid;
                const isBusy = actionBusy === uuid;

                return (
                  <div key={uuid} className="col-md-6 col-lg-4 mb-3">
                    <Card className={`h-100 ${status === 'online' ? 'border-success' : 'border-secondary'}`}>
                      <Card.Body>
                        <div className="d-flex justify-content-between align-items-start mb-2">
                          <Badge bg={status === 'online' ? 'success' : 'secondary'}>
                            {status || 'unknown'}
                          </Badge>
                          <div className="btn-group" role="group">
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
                                  onClick={() => handleEditDevice(uuid, displayName)}
                                  disabled={isBusy || isEditing}
                                >
                                  <FontAwesomeIcon icon={faEdit} />
                                </button>
                                <button 
                                  type="button" 
                                  className="btn btn-sm btn-edgeberry" 
                                  onClick={() => handleDeleteDevice(uuid, displayName)}
                                  disabled={isBusy}
                                >
                                  {isBusy ? <Spinner animation="border" size="sm" /> : <FontAwesomeIcon icon={faTrash} />}
                                </button>
                                <button 
                                  type="button" 
                                  className="btn btn-sm btn-edgeberry" 
                                  onClick={() => handleReplaceDevice(uuid)}
                                  disabled={isBusy}
                                >
                                  <FontAwesomeIcon icon={faExchange} />
                                </button>
                              </>
                            ) : null}
                          </div>
                        </div>
                        <Card.Title className="h6">
                          {isEditing ? (
                            <div className="d-flex gap-1">
                              <input
                                type="text"
                                className="form-control form-control-sm"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveEdit();
                                  if (e.key === 'Escape') handleCancelEdit();
                                }}
                                autoFocus
                              />
                              <button className="btn btn-sm btn-success" onClick={handleSaveEdit} disabled={isBusy}>
                                ✓
                              </button>
                              <button className="btn btn-sm btn-secondary" onClick={handleCancelEdit} disabled={isBusy}>
                                ✗
                              </button>
                            </div>
                          ) : (
                            <span>{displayName}</span>
                          )}
                        </Card.Title>
                        {props.user && (
                          <Card.Text className="small text-muted">
                            {uuid}
                          </Card.Text>
                        )}
                      </Card.Body>
                    </Card>
                  </div>
                );
              })}
            </div>
          )}

          {filteredDevices.length === 0 && (
            <div className="text-center text-muted py-4">
              {searchQuery ? 'No devices match your search.' : 'No devices found.'}
            </div>
          )}
        </Card.Body>
      </Card>

      <DeviceDetailModal deviceId={selected||''} show={!!selected} onClose={()=> setSelected(null)} />
      <CertificateSettingsModal show={showCerts} onClose={()=> setShowCerts(false)} user={props.user} />
      <WhitelistModal show={showWhitelist} onClose={()=> setShowWhitelist(false)} user={props.user} />
      
      {/* Replace Device Modal */}
      {showReplaceModal && (
        <div className="modal show d-block" tabIndex={-1} style={{backgroundColor: 'rgba(0,0,0,0.5)'}}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Replace Device</h5>
                <button type="button" className="btn-close" onClick={() => setShowReplaceModal(false)}></button>
              </div>
              <div className="modal-body">
                <p>Select a device to replace <strong>{devices.find(d => d.uuid === replaceSourceUuid)?.name || 'the selected device'}</strong> with:</p>
                <div className="list-group">
                  {devices.filter(d => d.uuid !== replaceSourceUuid).map(device => (
                    <button
                      key={device.uuid}
                      type="button"
                      className={`list-group-item list-group-item-action ${replaceTargetUuid === device.uuid ? 'active' : ''}`}
                      onClick={() => setReplaceTargetUuid(device.uuid)}
                    >
                      <div className="d-flex justify-content-between align-items-center">
                        <div>
                          <strong>{device.name || `EDGB-${device.uuid.substring(0, 4).toUpperCase()}`}</strong>
                          <br />
                          <small className="text-muted" style={{fontFamily:'monospace'}}>{device.uuid}</small>
                        </div>
                        <Badge bg={device.online ? 'success' : 'secondary'}>
                          {device.online ? 'online' : 'offline'}
                        </Badge>
                      </div>
                    </button>
                  ))}
                </div>
                {devices.filter(d => d.uuid !== replaceSourceUuid).length === 0 && (
                  <div className="text-center text-muted py-3">
                    No other devices available for replacement.
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowReplaceModal(false)}>
                  Cancel
                </button>
                <button 
                  type="button" 
                  className="btn btn-primary" 
                  onClick={handleConfirmReplace}
                  disabled={!replaceTargetUuid || actionBusy === replaceSourceUuid}
                >
                  {actionBusy === replaceSourceUuid ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" />
                      Replacing...
                    </>
                  ) : (
                    'Replace Device'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
