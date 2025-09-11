/**
 * System Widget - Merged Services and System Metrics
 * 
 * Combines ServiceStatusWidget and SystemMetricsWidget functionality
 * with system action buttons and integrated health information.
 */
import { useEffect, useMemo, useState, useRef } from 'react';
import { Badge, Button, Card, Col, Modal, Row, Spinner, Tab, Tabs } from 'react-bootstrap';
import { 
  getServices, getServiceLogs, startService, stopService, restartService,
  getMetrics, getHealth, getStatus, getPublicConfig,
  runSystemSanityCheck
} from '../api/devicehub';
import { subscribe as wsSubscribe, unsubscribe as wsUnsubscribe, isConnected as wsIsConnected } from '../api/socket';

type Metrics = {
  cpu?: { load1: number; load5: number; load15: number; cores: number; approxUsagePercent: number };
  memory?: { total: number; free: number; used: number; usedPercent: number };
  disk?: { mounts: Array<{ target: string; usedBytes: number; sizeBytes: number; usedPercent: number }>; };
  network?: { total: { rxBytes: number; txBytes: number }; interfaces: Record<string, { rxBytes: number; txBytes: number }> };
  uptimeSec?: number;
  timestamp?: number;
};

type Service = {
  unit: string;
  status: string;
  version?: string;
  description?: string;
  active?: 'active' | 'inactive' | 'failed' | 'activating' | 'deactivating';
  sub?: 'running' | 'dead' | 'exited' | 'failed' | 'start-pre' | 'start' | 'start-post' | 'reload' | 'stop' | 'stop-watchdog' | 'stop-sigterm' | 'stop-sigkill' | 'stop-post' | 'final-sigterm' | 'final-sigkill' | 'auto-restart';
  load?: 'loaded' | 'not-found' | 'bad-setting' | 'error' | 'merged' | 'masked' | 'stub';
  enabled?: 'enabled' | 'disabled' | 'static' | 'masked' | 'alias' | 'indirect' | 'generated' | 'transient' | 'bad';
  since?: string;
  memory?: number;
  tasks?: number;
};

function formatBytes(n?: number){
  if(n == null || !isFinite(n)) return '-';
  const units = ['B','KB','MB','GB','TB'];
  let i = 0; let v = n;
  while(v >= 1024 && i < units.length-1){ v/=1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

function percentColor(p?: number){
  if(p == null) return 'secondary';
  if(p < 60) return 'success';
  if(p < 85) return 'warning';
  return 'danger';
}

function plural(n: number, s: string){
  return `${n} ${s}${n===1?'':'s'}`;
}

function formatDuration(seconds?: number): string {
  if(seconds == null || !isFinite(seconds) || seconds < 0) return '-';
  const s = Math.floor(seconds);
  const minute = 60;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  const year = 365 * day;

  if(s < day){
    const h = Math.floor(s / hour);
    const m = Math.floor((s % hour) / minute);
    if(h > 0 && m > 0) return `${plural(h,'hour')} ${plural(m,'minute')}`;
    if(h > 0) return plural(h,'hour');
    return plural(m,'minute');
  }
  if(s < 14 * day){
    const d = Math.floor(s / day);
    const h = Math.floor((s % day) / hour);
    return h > 0 ? `${plural(d,'day')} ${plural(h,'hour')}` : `${plural(d,'day')}`;
  }
  if(s < 8 * week){
    const w = Math.floor(s / week);
    const d = Math.floor((s % week) / day);
    return d > 0 ? `${plural(w,'week')} ${plural(d,'day')}` : `${plural(w,'week')}`;
  }
  if(s < year){
    const mo = Math.floor(s / month);
    const d = Math.floor((s % month) / day);
    return d > 0 ? `${plural(mo,'month')} ${plural(d,'day')}` : `${plural(mo,'month')}`;
  }
  const y = Math.floor(s / year);
  const mo = Math.floor((s % year) / month);
  return mo > 0 ? `${plural(y,'year')} ${plural(mo,'month')}` : `${plural(y,'year')}`;
}

function humanizedUptime(status: any, metrics: Metrics): string {
  const sec = (typeof status?.uptimeSeconds === 'number') ? status.uptimeSeconds
            : (typeof metrics?.uptimeSec === 'number') ? metrics.uptimeSec
            : undefined;
  return formatDuration(sec);
}

export default function SystemWidget(props: { user: any | null }) {
  // Services state
  const [services, setServices] = useState<Service[]>([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [servicesError, setServicesError] = useState<string>('');
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [actionBusy, setActionBusy] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string>('');
  
  // Service logs
  const [logs, setLogs] = useState<string>('');
  const [logsLoading, setLogsLoading] = useState<boolean>(false);
  const [streamEnded, setStreamEnded] = useState<string>('');
  const logsRef = useRef<HTMLDivElement>(null);
  
  // Metrics state
  const [metrics, setMetrics] = useState<Metrics>({});
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [metricsError, setMetricsError] = useState<string>('');
  const [history, setHistory] = useState<{ hours: number; samples: Metrics[] }>({ hours: 24, samples: [] });
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  
  // Health state
  const [health, setHealth] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  
  // UI state
  const [wsOn, setWsOn] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<string>('overview');
  
  // Modals
  const [showPower, setShowPower] = useState<boolean>(false);
  const [powerBusy, setPowerBusy] = useState<boolean>(false);
  const [powerMsg, setPowerMsg] = useState<string>('');
  const [powerErr, setPowerErr] = useState<string>('');
  
  // Sanity check
  const [diagOpen, setDiagOpen] = useState<boolean>(false);
  const [diagBusy, setDiagBusy] = useState<boolean>(false);
  const [diagError, setDiagError] = useState<string>('');
  const [diagData, setDiagData] = useState<any>(null);
  
  const canControl = !!(props?.user && (
    (Array.isArray(props.user.roles) && props.user.roles.includes('admin')) ||
    (!Array.isArray(props.user.roles))
  ));

  // Load functions
  async function loadServices() {
    try {
      setServicesLoading(true);
      setServicesError('');
      const res = await getServices();
      setServices(Array.isArray(res?.services) ? res.services : []);
    } catch (e: any) {
      setServicesError(e?.message || 'Failed to load services');
    } finally {
      setServicesLoading(false);
    }
  }

  async function loadMetrics() {
    try {
      setMetricsLoading(true);
      const [metricsRes, healthRes, statusRes, configRes] = await Promise.all([
        getMetrics(),
        getHealth(),
        getStatus(),
        getPublicConfig()
      ]);
      setMetrics(metricsRes || {});
      setHealth(healthRes || {});
      setStatus(statusRes || {});
      setConfig(configRes || {});
      setMetricsError('');
    } catch (e: any) {
      setMetricsError(e?.message || 'Failed to load metrics');
    } finally {
      setMetricsLoading(false);
    }
  }

  // Service control functions
  async function doAction(kind: 'start'|'stop'|'restart', unit: string){
    try{
      setActionBusy(true);
      setActionError('');
      if(kind==='start') await startService(unit);
      else if(kind==='stop') await stopService(unit);
      else await restartService(unit);
      // If WS is disconnected, refresh list to reflect new status; otherwise WS will update us soon
      if(!wsIsConnected()) await loadServices();
      // update selected to the refreshed service entry if still open
      const updated = services.find(s=>s.unit===unit);
      if(updated) setSelectedService(updated);
    }catch(e:any){
      setActionError(e?.message || 'Action failed');
    }finally{
      setActionBusy(false);
    }
  }

  function prettyUnitName(unit: string){
    return unit.replace(/^devicehub-/, '').replace(/\.service$/, '');
  }

  function statusVariant(s?: string){
    return s === 'active' ? 'success' : (s === 'inactive' ? 'secondary' : 'warning');
  }

  function formatTimestamp(raw: string): string {
    if (!raw) return '';
    try {
      // Handle various timestamp formats
      let ts: number;
      if (raw.includes('T') || raw.includes('-')) {
        // ISO format
        ts = new Date(raw).getTime();
      } else if (raw.length > 10) {
        // Microsecond timestamp
        ts = parseInt(raw) / 1000;
      } else {
        // Second timestamp
        ts = parseInt(raw) * 1000;
      }
      return new Date(ts).toLocaleTimeString();
    } catch {
      return '';
    }
  }

  // Load logs whenever a selection opens the modal
  useEffect(()=>{
    if(!selectedService) return;
    (async ()=>{
      try{
        setStreamEnded('');
        setLogsLoading(true);
        const res: any = await getServiceLogs(selectedService.unit, 200);
        
        // Process logs from journalctl JSON format to readable Linux-style logs
        let txt = '';
        if(res && res.entries && Array.isArray(res.entries)){
          const lines = res.entries.map((entry: any) => {
            // Extract timestamp
            const timestamp = entry.__REALTIME_TIMESTAMP || entry._SOURCE_REALTIME_TIMESTAMP || '';
            let timeStr = '';
            if(timestamp){
              try{
                // __REALTIME_TIMESTAMP is in microseconds, convert to milliseconds
                const date = new Date(parseInt(timestamp) / 1000);
                timeStr = date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
              }catch{
                timeStr = timestamp;
              }
            }
            
            // Extract unit/identifier
            const unit = entry.SYSLOG_IDENTIFIER || entry._SYSTEMD_UNIT || entry._COMM || 'unknown';
            
            // Extract message
            const message = entry.MESSAGE || JSON.stringify(entry);
            
            // Format as Linux-style log: timestamp [unit] message
            return timeStr ? `${timeStr} [${unit}] ${message}` : `[${unit}] ${message}`;
          });
          txt = lines.join('\n');
        } else if(typeof res === 'string'){
          const lines = String(res).split(/\r?\n/);
          txt = lines.join('\n');
        } else if(Array.isArray(res)){
          txt = res.map(e => typeof e === 'string' ? e : JSON.stringify(e)).join('\n');
        } else if(res && typeof res === 'object'){
          txt = JSON.stringify(res, null, 2);
        }
        
        setLogs(txt);
        // Auto-scroll to bottom
        setTimeout(() => {
          if(logsRef.current){
            logsRef.current.scrollTop = logsRef.current.scrollHeight;
          }
        }, 100);
      }catch(e:any){
        setLogs(`Error loading logs: ${e?.message || 'Unknown error'}`);
      }finally{
        setLogsLoading(false);
      }
    })();
  }, [selectedService]);

  // WebSocket subscriptions for real-time updates
  useEffect(() => {
    if (!wsIsConnected()) return;
    let mounted = true;
    
    const onServices = (data: any) => {
      if (!mounted) return;
      if (data && Array.isArray(data.services)) {
        setServices(data.services);
        setServicesError('');
        setWsOn(true);
      }
    };
    
    const onMetrics = (data: any) => {
      if (!mounted) return;
      if (data) {
        setMetrics(data);
        setMetricsError('');
        setWsOn(true);
        
        // Update history for sparklines
        setHistory(prev => {
          const samples = [...(prev.samples || [])];
          samples.push({ ...data, timestamp: Date.now() });
          // Keep last 50 samples
          if (samples.length > 50) samples.shift();
          return { ...prev, samples };
        });
      }
    };
    
    const onHistory = (data: any) => {
      if (!mounted) return;
      if (data && data.samples) {
        setHistory(data);
        setWsOn(true);
      }
    };
    
    const onHealth = (data: any) => {
      if (!mounted) return;
      if (data) {
        setHealth(data);
        setWsOn(true);
      }
    };
    
    wsSubscribe('services.status', onServices);
    wsSubscribe('metrics.snapshots', onMetrics);
    wsSubscribe('metrics.history', onHistory);
    wsSubscribe('health', onHealth);
    
    return () => {
      mounted = false;
      wsUnsubscribe('services.status', onServices);
      wsUnsubscribe('metrics.snapshots', onMetrics);
      wsUnsubscribe('metrics.history', onHistory);
      wsUnsubscribe('health', onHealth);
    };
  }, [wsIsConnected()]);

  // Service logs streaming for selected service
  useEffect(() => {
    if (!selectedService || !wsIsConnected()) return;
    let mounted = true;
    const unit = selectedService.unit;
    const topicStream = `logs.stream:${unit}`;
    
    const onLogLine = (payload: any) => {
      if (!mounted) return;
      try {
        const d = payload;
        if (!d || d.unit !== unit) return;
        const e = d.entry;
        const ts = formatTimestamp(e?.SYSLOG_TIMESTAMP || e?.__REALTIME_TIMESTAMP || '');
        const ident = e?.SYSLOG_IDENTIFIER || e?._COMM || '';
        const pid = e?._PID ? `[${e._PID}]` : '';
        const msg = e?.MESSAGE ?? (typeof e === 'string' ? e : JSON.stringify(e));
        const line = `${ts} ${ident}${pid} ${msg}`.trim();
        
        setLogs(prev => {
          const next = prev ? `${prev}\n${line}` : line;
          const arr = next.split('\n');
          return arr.length > 1000 ? arr.slice(-1000).join('\n') : next;
        });
        
        // Auto-scroll to bottom
        setTimeout(() => {
          if (logsRef.current) {
            logsRef.current.scrollTop = logsRef.current.scrollHeight;
          }
        }, 50);
      } catch (e) {
        // Log stream parse error - silently ignore
      }
    };
    
    wsSubscribe(topicStream, onLogLine);
    
    return () => {
      mounted = false;
      wsUnsubscribe(topicStream, onLogLine);
    };
  }, [selectedService, wsIsConnected()]);

  // Effects
  useEffect(() => {
    loadServices();
    loadMetrics();
    
    const servicesInterval = setInterval(() => { if (!wsOn) loadServices(); }, 5000);
    const metricsInterval = setInterval(() => { if (!wsOn) loadMetrics(); }, 10000);
    
    return () => {
      clearInterval(servicesInterval);
      clearInterval(metricsInterval);
    };
  }, [wsOn]);


  // Sparkline components
  function Sparkline({ values, color = '#0007FF' }: { values: number[]; color?: string }) {
    const width = 100; const height = 60;
    const path = useMemo(() => {
      if (!values || values.length === 0) return '';
      const min = Math.min(...values);
      const max = Math.max(...values);
      const span = Math.max(1e-9, max - min);
      const pts = values.map((v, i) => {
        const x = (i / (values.length - 1)) * (width - 2) + 1;
        const y = height - (((v - min) / span) * (height - 2) + 1);
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      });
      return 'M' + pts[0] + ' L ' + pts.slice(1).join(' ');
    }, [values]);
    
    if (!values || values.length < 2) return <div style={{ height: '100%' }} />;
    return (
      <svg style={{ width: '100%', height: '100%' }} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <path d={path} fill="none" stroke={color} strokeWidth={1} />
      </svg>
    );
  }

  function OverlaySparkline({ a, b, colorA = '#0007FF', colorB = '#0007FF' }:{ a: number[]; b: number[]; colorA?: string; colorB?: string }){
    const width = 100; const height = 60;
    const mkPath = (values: number[], min: number, max: number) => {
      if(!values || values.length === 0) return '';
      const span = Math.max(1e-9, max - min);
      const pts = values.map((v, i) => {
        const x = (i/(values.length-1)) * (width-2) + 1;
        const y = height - (((v - min) / span) * (height-2) + 1);
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      });
      return 'M'+pts[0]+' L '+pts.slice(1).join(' ');
    };
    const [min, max] = useMemo(()=>{
      const vals = [...(a||[]), ...(b||[])];
      if(!vals.length) return [0,1];
      return [Math.min(...vals), Math.max(...vals)];
    }, [a, b]);
    const pA = useMemo(()=>mkPath(a, min, max), [a, min, max]);
    const pB = useMemo(()=>mkPath(b, min, max), [b, min, max]);
    return (
      <svg style={{width:'100%', height:'100%'}} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {pA && <path d={pA} fill="none" stroke={colorA} strokeWidth={1} />}
        {pB && <path d={pB} fill="none" stroke={colorB} strokeWidth={1} />}
      </svg>
    );
  }

  // Derive metrics series for sparklines
  const series = useMemo(() => {
    const s = history.samples || [];
    const cpu = s.map(x => x?.cpu?.approxUsagePercent ?? 0);
    const mem = s.map(x => x?.memory?.usedPercent ?? 0);
    const disk = s.map(x => x?.disk?.mounts?.[0]?.usedPercent ?? 0);
    // Network: derive rx/tx rate in bytes/sec from cumulative counters
    const rxRate: number[] = [];
    const txRate: number[] = [];
    for(let i=1;i<s.length;i++){
      const a = s[i-1]; const b = s[i];
      const dt = Math.max(1, ((b.timestamp||0) - (a.timestamp||0)) / 1000);
      const arx = a?.network?.total?.rxBytes ?? 0, brx = b?.network?.total?.rxBytes ?? 0;
      const atx = a?.network?.total?.txBytes ?? 0, btx = b?.network?.total?.txBytes ?? 0;
      rxRate.push(Math.max(0, (brx - arx) / dt));
      txRate.push(Math.max(0, (btx - atx) / dt));
    }
    return { cpu, mem, disk, rxRate, txRate };
  }, [history]);

  const metricsTiles = [
    {
      key: 'cpu', title: 'CPU',
      value: metrics.cpu ? `${Math.round(metrics.cpu.approxUsagePercent)}%` : '-',
      badge: (
        <div style={{width:'100%'}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
            <span style={{fontSize:'0.9em', color:'#666'}}>Current: {metrics.cpu ? `${Math.round(metrics.cpu.approxUsagePercent)}%` : '-'}</span>
            <Badge bg={percentColor(metrics.cpu?.approxUsagePercent)}>{metrics.cpu ? `${Math.round(metrics.cpu.approxUsagePercent)}%` : '-'}</Badge>
          </div>
          <div style={{width:'100%', height:60}}>
            <OverlaySparkline a={series.cpu} b={[]} />
          </div>
        </div>
      ),
      details: (
        <div>
          <div>Load avg: {metrics.cpu?.load1?.toFixed(2)} / {metrics.cpu?.load5?.toFixed(2)} / {metrics.cpu?.load15?.toFixed(2)} (cores: {metrics.cpu?.cores})</div>
        </div>
      )
    },
    {
      key: 'memory', title: 'Memory',
      value: metrics.memory ? `${Math.round(metrics.memory.usedPercent)}%` : '-',
      badge: (
        <div style={{width:'100%'}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
            <span style={{fontSize:'0.9em', color:'#666'}}>Current: {metrics.memory ? `${Math.round(metrics.memory.usedPercent)}%` : '-'}</span>
            <Badge bg={percentColor(metrics.memory?.usedPercent)}>{metrics.memory ? `${Math.round(metrics.memory.usedPercent)}%` : '-'}</Badge>
          </div>
          <div style={{width:'100%', height:60}}>
            <Sparkline values={series.mem} />
          </div>
        </div>
      ),
      details: (
        <div>
          <div>Total: {formatBytes(metrics.memory?.total)}</div>
          <div>Used: {formatBytes(metrics.memory?.used)}</div>
          <div>Free: {formatBytes(metrics.memory?.free)}</div>
        </div>
      )
    },
    {
      key: 'disk', title: 'Disk',
      value: metrics.disk && metrics.disk.mounts && metrics.disk.mounts.length ? `${Math.round((metrics.disk.mounts[0].usedPercent||0))}%` : '-',
      badge: (
        <div style={{width:'100%'}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
            <span style={{fontSize:'0.9em', color:'#666'}}>Current: {metrics.disk?.mounts?.[0]?.usedPercent != null ? `${Math.round(metrics.disk.mounts[0].usedPercent)}%` : '-'}</span>
            <Badge bg={percentColor(metrics.disk?.mounts?.[0]?.usedPercent)}>{metrics.disk?.mounts?.[0]?.usedPercent != null ? `${Math.round(metrics.disk.mounts[0].usedPercent)}%` : '-'}</Badge>
          </div>
          <div style={{width:'100%', height:60}}>
            <Sparkline values={series.disk} />
          </div>
        </div>
      ),
      details: (
        <div>
          <div style={{maxHeight:200, overflow:'auto'}}>
            {(metrics.disk?.mounts||[]).map((m)=> (
              <div key={m.target} style={{marginBottom:6}}>
                <div style={{fontWeight:600}}>{m.target}</div>
                <div>{formatBytes(m.usedBytes)} / {formatBytes(m.sizeBytes)} ({Math.round(m.usedPercent)}%)</div>
              </div>
            ))}
          </div>
        </div>
      )
    },
    {
      key: 'network', title: 'Network',
      value: metrics.network ? `${formatBytes(metrics.network.total.rxBytes)} / ${formatBytes(metrics.network.total.txBytes)}` : '-',
      badge: (
        <div style={{width:'100%'}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
            <span style={{fontSize:'0.9em', color:'#666'}}>RX/TX Rates</span>
            <Badge bg={'info'}>RX/TX</Badge>
          </div>
          <div style={{width:'100%', height:60}}>
            <OverlaySparkline a={series.rxRate} b={series.txRate} />
          </div>
        </div>
      ),
      details: (
        <div>
          <div style={{maxHeight:200, overflow:'auto'}}>
            {Object.entries(metrics.network?.interfaces || {}).map(([name, v])=> (
              <div key={name} style={{marginBottom:6}}>
                <div style={{fontWeight:600}}>{name}</div>
                <div>RX: {formatBytes(v.rxBytes)} &nbsp; TX: {formatBytes(v.txBytes)}</div>
              </div>
            ))}
          </div>
        </div>
      )
    },
  ];

  const healthStatus = (health?.health === 'ok' || health?.ok === true) ? 'Healthy' : 'Degraded';
  const healthColor = (health?.health === 'ok' || health?.ok === true) ? 'success' : 'danger';

  return (
    <Card className="mb-3" data-testid="system-widget">
      <Card.Header className="d-flex justify-content-between align-items-center">
        <span>System</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            size="sm"
            variant="outline-primary"
            onClick={async () => {
              setDiagOpen(true);
              if (!canControl) return;
              setDiagBusy(true);
              setDiagError('');
              setDiagData(null);
              try {
                const res: any = await runSystemSanityCheck();
                setDiagData(res);
              } catch (e: any) {
                setDiagError(e?.message || 'Sanity check failed');
              } finally {
                setDiagBusy(false);
              }
            }}
            disabled={!canControl || diagBusy}
            title={canControl ? 'Run system sanity check' : 'Admin only'}
          >
            <i className="fa-solid fa-stethoscope" aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            variant="outline-danger"
            disabled={!canControl}
            title={canControl ? 'Power options' : 'Admin only'}
            onClick={() => { if (canControl) { setPowerErr(''); setPowerMsg(''); setShowPower(true); } }}
          >
            <i className="fa-solid fa-power-off" aria-hidden="true" />
          </Button>
        </div>
      </Card.Header>
      <Card.Body>
        {/* Single page layout - no tabs */}
        <div>
            <div className="mt-3">
              {/* Health strip */}
              <div style={{ marginBottom: 16 }}>
                {metricsLoading ? (
                  <Spinner animation="border" size="sm" />
                ) : (
                  <Row>
                    <Col md="4" sm="6" xs="12">
                      <div><strong>Status</strong></div>
                      <Badge bg={healthColor}>{healthStatus}</Badge>
                    </Col>
                    <Col md="4" sm="6" xs="12">
                      <div><strong>Uptime</strong></div>
                      <div>{humanizedUptime(status, metrics)}</div>
                    </Col>
                    <Col md="4" sm="6" xs="12">
                      <div><strong>Environment</strong></div>
                      <div>
                        {config ? (
                          <div>
                            <div>{config.osDistribution || config.platform || 'Unknown OS'}</div>
                            <div style={{fontSize: '0.85em', color: '#666'}}>
                              {config.nodeVersion ? `Node.js ${config.nodeVersion}` : 'Node.js'}
                            </div>
                          </div>
                        ) : '-'}
                      </div>
                    </Col>
                  </Row>
                )}
              </div>
              
              {/* Metrics - Full Width */}
              <div>
                {metricsLoading ? (
                  <Spinner animation="border" size="sm" />
                ) : metricsError ? (
                  <div style={{ color: '#c00' }}>{metricsError}</div>
                ) : (
                  <Row className="g-3">
                    {metricsTiles.map((t: any) => (
                      <Col key={t.key} xs={12} sm={6} md={3} lg={3} xl={3}>
                        <div
                          role="button"
                          onClick={() => setSelectedMetric(t.key)}
                          style={{
                            border: '1px solid #e0e0e0', 
                            borderRadius: 8, 
                            padding: 12, 
                            height: '100%',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.05)', 
                            cursor: 'pointer',
                            display:'flex', 
                            flexDirection:'column'
                          }}
                        >
                          <div style={{ fontWeight: 600, marginBottom: 8 }}>{t.title}</div>
                          <div style={{ flex: 1 }}>{t.badge}</div>
                        </div>
                      </Col>
                    ))}
                  </Row>
                )}
              </div>
            </div>
            
            {/* Services section */}
            <div className="mt-4">
              <h6 className="mb-3">Services</h6>
              {servicesLoading ? (
                <Spinner animation="border" size="sm" />
              ) : servicesError ? (
                <div style={{ color: '#c00' }}>{servicesError}</div>
              ) : (
                <>
                  {services.length === 0 ? (
                    <div>No services found.</div>
                  ) : (
                    <Row className="g-2">
                      {services.map((s) => {
                        const variant = s.status === 'active' ? 'success' : (s.status === 'inactive' ? 'secondary' : 'warning');
                        return (
                          <Col key={s.unit} xs={12} sm={6} md={4} lg={3} xl={2}>
                            <div
                              role="button"
                              onClick={() => setSelectedService(s)}
                              style={{
                                border: '1px solid #e0e0e0',
                                borderRadius: 6,
                                padding: 8,
                                height: '100%',
                                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                                cursor: 'pointer',
                              }}
                            >
                              <div style={{ fontWeight: 600, wordBreak: 'break-all', fontSize: '0.9em' }}>
                                {prettyUnitName(s.unit)}{' '}
                                {s.version ? <span style={{ fontWeight: 400, fontSize: 11, color:'#666' }}>v{s.version}</span> : null}
                              </div>
                              <div style={{ marginTop: 6 }}>
                                <Badge bg={variant} style={{ fontSize: '0.75em' }}>{s.status}</Badge>
                              </div>
                            </div>
                          </Col>
                        );
                      })}
                    </Row>
                  )}
                </>
              )}
            </div>
        </div>
      </Card.Body>

      {/* Power Management Modal */}
        <Modal show={showPower} onHide={() => { if (!powerBusy) setShowPower(false); }} centered>
          <Modal.Header closeButton>
            <Modal.Title>Power Management</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <div className="d-grid gap-2">
              <Button
                variant="outline-warning"
                disabled={powerBusy}
                onClick={async () => {
                  if (!confirm('Reboot the server now? This will interrupt connectivity.')) return;
                  setPowerBusy(true); setPowerErr(''); setPowerMsg('');
                  try {
                    const res = await fetch('/api/system/reboot', { method: 'POST', credentials: 'include' });
                    const data = await res.json();
                    setPowerMsg(data?.message || 'Reboot requested');
                  } catch (e: any) {
                    setPowerErr(e?.message || 'Failed to request reboot');
                  } finally {
                    setPowerBusy(false);
                  }
                }}
              >
                {powerBusy ? (<><Spinner as="span" animation="border" size="sm" /> Requesting…</>) : 'Reboot Server'}
              </Button>
              <Button
                variant="outline-danger"
                disabled={!canControl || powerBusy}
                onClick={async () => {
                  if (!confirm('Shutdown the server now? This will power off the device.')) return;
                  setPowerBusy(true); setPowerErr(''); setPowerMsg('');
                  try {
                    const res = await fetch('/api/system/shutdown', { method: 'POST', credentials: 'include' });
                    const data = await res.json();
                    setPowerMsg(data?.message || 'Shutdown requested');
                  } catch (e: any) {
                    setPowerErr(e?.message || 'Failed to request shutdown');
                  } finally {
                    setPowerBusy(false);
                  }
                }}
              >
                {powerBusy ? (<><Spinner as="span" animation="border" size="sm" /> Requesting…</>) : 'Shutdown server'}
              </Button>
            </div>
            {(powerErr || powerMsg) && (
              <div style={{ marginTop: 12, color: powerErr ? '#c00' : '#060' }}>{powerErr || powerMsg}</div>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowPower(false)} disabled={powerBusy}>Close</Button>
          </Modal.Footer>
        </Modal>

        {/* Service Detail Modal */}
        <Modal show={!!selectedService} onHide={() => setSelectedService(null)} centered size="xl" scrollable fullscreen="md-down">
          <Modal.Header closeButton>
            <Modal.Title>Service details</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {selectedService && (
              <div>
                <div style={{ marginBottom: 6 }}><strong>Service:</strong> {prettyUnitName(selectedService.unit)}</div>
                {selectedService.version ? (
                  <div style={{ marginBottom: 6 }}><strong>Version:</strong> v{selectedService.version}</div>
                ) : null}
                <div style={{ marginBottom: 6, opacity: 0.7 }}><small>Unit id: {selectedService.unit}</small></div>
                <div style={{ marginBottom: 12 }}><strong>Status:</strong> <Badge bg={statusVariant(selectedService.status)}>{selectedService.status}</Badge></div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
                  <Button size="sm" variant="success" disabled={!canControl || actionBusy} onClick={()=>doAction('start', selectedService.unit)}>Start</Button>
                  <Button size="sm" variant="warning" disabled={!canControl || actionBusy} onClick={()=>doAction('restart', selectedService.unit)}>Restart</Button>
                  <Button size="sm" variant="danger" disabled={!canControl || actionBusy} onClick={()=>doAction('stop', selectedService.unit)}>Stop</Button>
                  {actionBusy && <Spinner animation="border" size="sm" />}
                </div>
                {!canControl && (
                  <div style={{ color:'#666', fontSize: 12, marginBottom: 8 }}>Admin permissions required to run actions</div>
                )}
                {actionError && <div style={{ color:'#c00', marginBottom: 8 }}>{actionError}</div>}
                <div style={{ display:'flex', alignItems:'center', gap:8, fontWeight: 600, marginBottom: 8 }}>
                  <span>Recent logs</span>
                  {wsIsConnected() && (
                    <Badge bg="success">Live</Badge>
                  )}
                </div>
                {streamEnded && (
                  <div style={{ color:'#999', fontSize: 12, marginBottom: 4 }}>{streamEnded}</div>
                )}
                <div
                  style={{
                    background: '#0b0b10',
                    color: '#e0e6f0',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                    fontSize: 13,
                    lineHeight: 1.4,
                    borderRadius: 8,
                    padding: 12,
                    maxHeight: 360,
                    overflow: 'auto',
                    border: '1px solid rgba(255,255,255,0.08)'
                  }}
                  ref={logsRef}
                  tabIndex={0}
                >
                  {logsLoading ? (
                    <Spinner animation="border" size="sm" />
                  ) : (
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{logs}</pre>
                  )}
                </div>
              </div>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setSelectedService(null)}>Close</Button>
          </Modal.Footer>
        </Modal>

        {/* Metrics Detail Modal */}
        <Modal show={!!selectedMetric} onHide={() => setSelectedMetric(null)} centered size="lg">
          <Modal.Header closeButton>
            <Modal.Title>
              {selectedMetric ? metricsTiles.find((t: any) => t.key === selectedMetric)?.title : 'Metrics'} Details
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {selectedMetric && (
              <div>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>Current Value</div>
                  <div>{metricsTiles.find((t: any) => t.key === selectedMetric)?.value}</div>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>Historical Trend</div>
                  <div style={{ height: 120, border: '1px solid #e0e0e0', borderRadius: 4, padding: 8 }}>
                    {selectedMetric === 'cpu' && <Sparkline values={series.cpu} />}
                    {selectedMetric === 'memory' && <Sparkline values={series.mem} />}
                    {selectedMetric === 'disk' && <Sparkline values={series.disk} />}
                    {selectedMetric === 'network' && <OverlaySparkline a={series.rxRate} b={series.txRate} />}
                  </div>
                </div>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>Details</div>
                  {metricsTiles.find((t: any) => t.key === selectedMetric)?.details}
                </div>
              </div>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setSelectedMetric(null)}>Close</Button>
          </Modal.Footer>
        </Modal>

        {/* Sanity Check Modal */}
        <Modal show={diagOpen} onHide={() => setDiagOpen(false)} size="lg" centered>
          <Modal.Header closeButton>
            <Modal.Title>System Sanity Check</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {diagBusy ? (
              <div className="text-center">
                <Spinner animation="border" />
                <div className="mt-2">Running sanity check...</div>
              </div>
            ) : diagError ? (
              <div style={{ color: '#c00' }}>{diagError}</div>
            ) : diagData ? (
              <pre style={{ fontSize: '0.85em', maxHeight: 400, overflow: 'auto' }}>
                {JSON.stringify(diagData, null, 2)}
              </pre>
            ) : (
              <div>Click the sanity check button to run diagnostics.</div>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setDiagOpen(false)}>Close</Button>
          </Modal.Footer>
        </Modal>
    </Card>
  );
}
