/**
 * System Widget - Merged Services and System Metrics
 * 
 * Combines ServiceStatusWidget and SystemMetricsWidget functionality
 * with system action buttons and integrated health information.
 */
import { useEffect, useMemo, useState, useRef } from 'react';
import { Alert, Badge, Button, Card, Col, Collapse, Modal, Row, Spinner, Tab, Tabs } from 'react-bootstrap';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGears, faChartLine, faTerminal } from '@fortawesome/free-solid-svg-icons';
import TerminalModal from './TerminalModal';
import {
  getServices, getMetrics, getHealth, getStatus, getPublicConfig
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

export default function SystemWidget() {
  // Services state
  const [services, setServices] = useState<Service[]>([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [servicesError, setServicesError] = useState<string>('');
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
  // Devices and Applications are the reason this product exists; System is a
  // diagnostics panel, not the headline. Collapsed by default so it reads as
  // a compact status strip rather than the first thing pushing everything
  // else down the page - expand it when you actually need the detail.
  const [expanded, setExpanded] = useState<boolean>(false);
  
  // Modals
  /*
   *  No power controls here any more.
   *
   *  This is a server, not an appliance: rebooting it drops every device and
   *  application connected to it, and a control that reachable turns that into
   *  a slip rather than a decision. Cycling the machine is a deliberate,
   *  rare act - it belongs at a shell (see the Terminal), not one click from
   *  a dashboard people leave open all day.
   */
  const [showTerminal, setShowTerminal] = useState<boolean>(false);
  // Off unless the operator switched it on at the console
  // (`devicehub --enable-webterminal`); assume off until /api/status says
  // otherwise, so the button never invites a click that would be refused.
  const terminalEnabled = status?.webTerminalEnabled === true;

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

  function prettyUnitName(unit: string){
    return unit.replace(/^devicehub-/, '').replace(/\.service$/, '');
  }

  function statusVariant(s?: string){
    return s === 'active' ? 'success' : (s === 'inactive' ? 'secondary' : 'warning');
  }

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


  /*
   *  Sparkline.
   *
   *  `domain` fixes the y-axis. Without it the axis is scaled to the series'
   *  own min/max, which is actively misleading for a bounded quantity: a disk
   *  sitting at 56% and creeping by thousandths of a percent gets those
   *  thousandths stretched across the full height, drawing a dramatic climb
   *  next to a percentage that never moves. Same for an idle CPU, where noise
   *  between 3% and 5% fills the chart.
   *
   *  So percentages pass [0, 100] and are drawn against the scale they
   *  actually live on - flat when the value is flat. Auto-scaling remains the
   *  default for unbounded series, which have no natural ceiling to draw
   *  against.
   */
  const CHART_W = 100; const CHART_H = 60;

  /**
   * Turn a series into a line path and the closed area beneath it.
   * Returns viewBox coordinates, so both charts below share one definition.
   */
  function chartPaths(values: number[], domain?: [number, number]) {
    if (!values || values.length < 2) return { line: '', area: '' };
    const min = domain ? domain[0] : Math.min(...values);
    const max = domain ? domain[1] : Math.max(...values);
    const span = Math.max(1e-9, max - min);
    const pts = values.map((v, i) => {
      const x = (i / (values.length - 1)) * (CHART_W - 2) + 1;
      const y = CHART_H - (((v - min) / span) * (CHART_H - 2) + 1);
      return [x, y] as [number, number];
    });
    const line = 'M' + pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' L ');
    const first = pts[0]; const last = pts[pts.length - 1];
    const area = `${line} L ${last[0].toFixed(2)},${CHART_H} L ${first[0].toFixed(2)},${CHART_H} Z`;
    return { line, area };
  }

  /**
   * Background grid. Drawn as explicit lines rather than an SVG <pattern>
   * because the charts stretch to their container with preserveAspectRatio
   * "none" - a pattern would be stretched with them and stop being square.
   */
  function ChartGrid() {
    const rows = 4; const cols = 4;
    const lines = [];
    for (let r = 1; r < rows; r++) {
      const y = (r / rows) * CHART_H;
      lines.push(<line key={`h${r}`} x1={0} y1={y} x2={CHART_W} y2={y} vectorEffect="non-scaling-stroke" />);
    }
    for (let c = 1; c < cols; c++) {
      const x = (c / cols) * CHART_W;
      lines.push(<line key={`v${c}`} x1={x} y1={0} x2={x} y2={CHART_H} vectorEffect="non-scaling-stroke" />);
    }
    return <g stroke="var(--eb-line)" strokeWidth={0.5} opacity={0.4}>{lines}</g>;
  }

  /*
   *  Every stroke carries vector-effect="non-scaling-stroke".
   *
   *  These charts stretch to their container with preserveAspectRatio="none",
   *  so x and y scale by different factors - and a stroke scaled unevenly gets
   *  thicker on diagonals than on horizontals, exactly like a calligraphy nib.
   *  non-scaling-stroke takes the stroke out of that transform and keeps it a
   *  flat, even line at any width.
   */
  function Sparkline({ values, color = 'var(--eb-primary)', domain }: { values: number[]; color?: string; domain?: [number, number] }) {
    const { line, area } = useMemo(() => chartPaths(values, domain), [values, domain]);

    if (!values || values.length < 2) return <div style={{ height: '100%' }} />;
    return (
      <svg style={{ width: '100%', height: '100%', display: 'block' }} viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none">
        <ChartGrid />
        <path d={area} fill={color} fillOpacity={0.15} stroke="none" />
        <path d={line} fill="none" stroke={color} strokeWidth={1.5}
              strokeLinecap="butt" strokeLinejoin="miter" vectorEffect="non-scaling-stroke" />
      </svg>
    );
  }

  function OverlaySparkline({ a, b, colorA = 'var(--eb-primary)', colorB = 'var(--eb-primary)' }:{ a: number[]; b: number[]; colorA?: string; colorB?: string }){
    // Anchored at zero. These are throughput rates, and a rate's distance from
    // "nothing is happening" is the whole point - scaling the floor up to the
    // series minimum turns a steady 1 MB/s with a few KB of jitter into what
    // looks like violent spikes.
    const domain = useMemo(()=>{
      const vals = [...(a||[]), ...(b||[])];
      if(!vals.length) return [0,1] as [number, number];
      return [0, Math.max(1, ...vals)] as [number, number];
    }, [a, b]);
    const pA = useMemo(()=>chartPaths(a, domain), [a, domain]);
    const pB = useMemo(()=>chartPaths(b, domain), [b, domain]);
    return (
      <svg style={{width:'100%', height:'100%', display:'block'}} viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none">
        <ChartGrid />
        {/* Both fills are faint so the overlap reads as a single shaded region
            rather than one series hiding the other. */}
        {pA.area && <path d={pA.area} fill={colorA} fillOpacity={0.12} stroke="none" />}
        {pB.area && <path d={pB.area} fill={colorB} fillOpacity={0.12} stroke="none" />}
        {pA.line && <path d={pA.line} fill="none" stroke={colorA} strokeWidth={1.5}
                          strokeLinecap="butt" strokeLinejoin="miter" vectorEffect="non-scaling-stroke" />}
        {pB.line && <path d={pB.line} fill="none" stroke={colorB} strokeWidth={1.5}
                          strokeLinecap="butt" strokeLinejoin="miter" vectorEffect="non-scaling-stroke" />}
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
        <Badge bg={percentColor(metrics.cpu?.approxUsagePercent)}>{metrics.cpu ? `${Math.round(metrics.cpu.approxUsagePercent)}%` : '-'}</Badge>
      ),
      chart: (
        <Sparkline values={series.cpu} domain={[0, 100]} />
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
        <Badge bg={percentColor(metrics.memory?.usedPercent)}>{metrics.memory ? `${Math.round(metrics.memory.usedPercent)}%` : '-'}</Badge>
      ),
      chart: (
        <Sparkline values={series.mem} domain={[0, 100]} />
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
        <Badge bg={percentColor(metrics.disk?.mounts?.[0]?.usedPercent)}>{metrics.disk?.mounts?.[0]?.usedPercent != null ? `${Math.round(metrics.disk.mounts[0].usedPercent)}%` : '-'}</Badge>
      ),
      chart: (
        <Sparkline values={series.disk} domain={[0, 100]} />
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
      // The chart plots rates, so the badge reports the current rate - "RX/TX"
      // named the axes rather than giving a reading, and the cumulative byte
      // totals underneath it are not what is drawn.
      badge: (
        <Badge bg="secondary">
          ↓{formatBytes(series.rxRate[series.rxRate.length - 1] ?? 0)}/s ↑{formatBytes(series.txRate[series.txRate.length - 1] ?? 0)}/s
        </Badge>
      ),
      chart: (
        <OverlaySparkline a={series.rxRate} b={series.txRate} />
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
  const activeServicesCount = services.filter(s => s.status === 'active').length;

  return (
    <Card className="mb-3" data-testid="system-widget">
      <Card.Header
        className="d-flex justify-content-between align-items-center flex-wrap"
        style={{ gap: 8, cursor: 'pointer' }}
        onClick={() => setExpanded(v => !v)}
      >
        <div className="d-flex align-items-center flex-wrap" style={{ gap: 14 }}>
          <span><i className="fa-solid fa-server me-2"></i>System</span>
          {/* Compact status strip: what you'd want to know without expanding. */}
          {!metricsLoading && !servicesLoading && (
            <div
              className="d-flex align-items-center flex-wrap"
              style={{ gap: 10, fontSize: '0.8rem', fontWeight: 400, textTransform: 'none', letterSpacing: 'normal' }}
            >
              <Badge bg={healthColor}>{healthStatus}</Badge>
              <span className="text-muted">up {humanizedUptime(status, metrics)}</span>
              <span className="text-muted">
                CPU {metrics.cpu ? `${Math.round(metrics.cpu.approxUsagePercent)}%` : '-'}
                {' · '}MEM {metrics.memory ? `${Math.round(metrics.memory.usedPercent)}%` : '-'}
                {' · '}DISK {metrics.disk?.mounts?.[0]?.usedPercent != null ? `${Math.round(metrics.disk.mounts[0].usedPercent)}%` : '-'}
              </span>
              <Badge bg={activeServicesCount === services.length ? 'success' : 'warning'}>
                {activeServicesCount}/{services.length} services
              </Badge>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }} onClick={e => e.stopPropagation()}>
          {/* The tooltip sits on a wrapping span, not the button: a disabled
              button fires no pointer events, so a title on it is never shown -
              and the whole point of this state is explaining how to leave it. */}
          <span
            title={terminalEnabled
              ? 'Terminal'
              : 'Web terminal is disabled. Enable it on the server with:  devicehub --enable-webterminal'}
          >
            <Button
              size="sm"
              variant="outline-secondary"
              disabled={!terminalEnabled}
              onClick={() => setShowTerminal(true)}
            >
              <FontAwesomeIcon icon={faTerminal} />
            </Button>
          </span>
          <Button
            size="sm"
            variant="outline-secondary"
            title={expanded ? 'Collapse' : 'Expand details'}
            onClick={() => setExpanded(v => !v)}
          >
            <i className={`fa-solid fa-chevron-${expanded ? 'up' : 'down'}`} aria-hidden="true" />
          </Button>
        </div>
      </Card.Header>
      <Collapse in={expanded}>
        <div>
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
                        {/* Title and value share one line above the chart -
                            they used to take a row each, which is what made
                            the tile tall. Sitting over the chart was tried and
                            rejected: a high value tracks straight through the
                            labels, and there is no reading of that which is
                            not slightly wrong. */}
                        <div
                          role="button"
                          onClick={() => setSelectedMetric(t.key)}
                          style={{
                            border: '1px solid #e0e0e0',
                            borderRadius: 8,
                            padding: 10,
                            height: '100%',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                            cursor: 'pointer'
                          }}
                        >
                          <div
                            style={{
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              gap: 8, marginBottom: 6
                            }}
                          >
                            <span style={{ fontWeight: 600 }}>{t.title}</span>
                            {t.badge}
                          </div>
                          <div style={{ height: 72 }}>{t.chart}</div>
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
                              style={{
                                border: '1px solid #e0e0e0',
                                borderRadius: 6,
                                padding: 8,
                                height: '100%',
                                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
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
        </div>
      </Collapse>

        <TerminalModal show={showTerminal} onClose={() => setShowTerminal(false)} />

        {/* Metrics Detail Modal */}
        <Modal show={!!selectedMetric} onHide={() => setSelectedMetric(null)} centered size="lg">
          <Modal.Header closeButton closeVariant="white">
            <Modal.Title>
              <FontAwesomeIcon icon={faChartLine} />{selectedMetric ? metricsTiles.find((t: any) => t.key === selectedMetric)?.title : 'Metrics'} Details
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
                    {selectedMetric === 'cpu' && <Sparkline values={series.cpu} domain={[0, 100]} />}
                    {selectedMetric === 'memory' && <Sparkline values={series.mem} domain={[0, 100]} />}
                    {selectedMetric === 'disk' && <Sparkline values={series.disk} domain={[0, 100]} />}
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

    </Card>
  );
}
