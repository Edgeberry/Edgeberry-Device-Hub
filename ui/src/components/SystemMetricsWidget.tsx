/**
 * System metrics widget
 *
 * Displays CPU, memory, disk and network metrics from the core-service `/metrics` endpoint.
 * Auto-refreshes every 10 seconds. Clicking a tile opens a modal with details.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Col, Modal, Row, Spinner } from 'react-bootstrap';
import { getMetrics, getMetricsHistory } from '../api/fleethub';
import { subscribe as wsSubscribe, unsubscribe as wsUnsubscribe, isConnected as wsIsConnected } from '../api/socket';

type Metrics = {
  cpu?: { load1: number; load5: number; load15: number; cores: number; approxUsagePercent: number };
  memory?: { total: number; free: number; used: number; usedPercent: number };
  disk?: { mounts: Array<{ target: string; usedBytes: number; sizeBytes: number; usedPercent: number }>; };
  network?: { total: { rxBytes: number; txBytes: number }; interfaces: Record<string, { rxBytes: number; txBytes: number }> };
  uptimeSec?: number;
  timestamp?: number;
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

export default function SystemMetricsWidget(){
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [metrics, setMetrics] = useState<Metrics>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<{ hours: number; samples: Metrics[] }>({ hours: 24, samples: [] });
  const [wsOn, setWsOn] = useState<boolean>(false);

  async function load(){
    try{
      setLoading(true);
      setError('');
      const m = await getMetrics();
      setMetrics(m || {});
    }catch(e:any){
      setError(e?.message || 'Failed to load metrics');
    }finally{
      setLoading(false);
    }
  }

  useEffect(()=>{
    // Polling fallback; pause when websocket is connected
    load();
    const id = setInterval(()=>{ if(!wsOn) load(); }, 10000);
    return ()=>clearInterval(id);
  },[wsOn]);
  // Load history once and then refresh every minute
  useEffect(()=>{
    // Prefer websocket. If WS connects, subscribe and stop polling history.
    let mounted = true;
    const onHist = (data: any) => {
      if(!mounted) return;
      const hours = data?.hours || 24;
      const samples = Array.isArray(data?.samples) ? data.samples : [];
      if(samples.length) setHistory({ hours, samples });
      setWsOn(true);
    };
    const onSnap = (data: any) => {
      if(!mounted) return;
      setMetrics(data || {});
      // append to history if newer
      setHistory(prev => {
        const lastTs = prev.samples.length ? (prev.samples[prev.samples.length-1].timestamp||0) : 0;
        if(!data?.timestamp || data.timestamp <= lastTs) return prev;
        const samples = [...prev.samples, data];
        return { hours: prev.hours, samples };
      });
      setWsOn(true);
    };
    // Subscribe
    wsSubscribe('metrics.history', onHist);
    wsSubscribe('metrics.snapshots', onSnap);
    // Fallback: if WS not connected after short delay, load history via HTTP and keep minute polling
    let pollId: any;
    const ensureHistoryPoll = async ()=>{
      if(wsIsConnected()) return;
      try{
        const h = await getMetricsHistory(24);
        if(mounted) setHistory({ hours: h.hours || 24, samples: Array.isArray(h.samples)? h.samples : [] });
      }catch{}
      pollId = setInterval(async ()=>{
        if(wsIsConnected()) { clearInterval(pollId); return; }
        try{
          const h = await getMetricsHistory(24);
          if(mounted) setHistory({ hours: h.hours || 24, samples: Array.isArray(h.samples)? h.samples : [] });
        }catch{}
      }, 60_000);
    };
    ensureHistoryPoll();
    return ()=>{
      mounted = false;
      wsUnsubscribe('metrics.history', onHist);
      wsUnsubscribe('metrics.snapshots', onSnap);
      if(pollId) clearInterval(pollId);
    };
  },[]);

  function Sparkline({ values, color = '#0007FF' }: { values: number[]; color?: string }){
    const width = 100; // internal viewBox width
    const height = 60; // internal viewBox height
    const path = useMemo(()=>{
      if(!values || values.length === 0) return '';
      const min = Math.min(...values);
      const max = Math.max(...values);
      const span = Math.max(1e-9, max - min);
      const pts = values.map((v, i) => {
        const x = (i/(values.length-1)) * (width-2) + 1;
        const y = height - (((v - min) / span) * (height-2) + 1);
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      });
      return 'M'+pts[0]+' L '+pts.slice(1).join(' ');
    }, [values]);
    if(!values || values.length < 2) return <div style={{height:'100%'}}/>;
    return (
      <svg style={{width:'100%', height:'100%'}} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <path d={path} fill="none" stroke={color} strokeWidth={1.5} />
      </svg>
    );
  }

  function OverlaySparkline({ a, b, colorA = '#28a745', colorB = '#dc3545' }:{ a: number[]; b: number[]; colorA?: string; colorB?: string }){
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
        {pA && <path d={pA} fill="none" stroke={colorA} strokeWidth={1.5} />}
        {pB && <path d={pB} fill="none" stroke={colorB} strokeWidth={1.5} />}
      </svg>
    );
  }

  // Derive series
  const series = useMemo(()=>{
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

  const tiles = [
    {
      key: 'cpu', title: 'CPU',
      value: metrics.cpu ? `${Math.round(metrics.cpu.approxUsagePercent)}%` : '-',
      badge: (
        <div style={{display:'flex', alignItems:'stretch', gap:8}}>
          <div style={{display:'flex', alignItems:'center'}}>
            <Badge bg={percentColor(metrics.cpu?.approxUsagePercent)}>{metrics.cpu ? `${Math.round(metrics.cpu.approxUsagePercent)}%` : '-'}</Badge>
          </div>
          <div style={{flex:1, height:'100%'}}>
            <Sparkline values={series.cpu} />
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
        <div style={{display:'flex', alignItems:'stretch', gap:8}}>
          <div style={{display:'flex', alignItems:'center'}}>
            <Badge bg={percentColor(metrics.memory?.usedPercent)}>{metrics.memory ? `${Math.round(metrics.memory.usedPercent)}%` : '-'}</Badge>
          </div>
          <div style={{flex:1, height:'100%'}}>
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
        <div style={{display:'flex', alignItems:'stretch', gap:8}}>
          <div style={{display:'flex', alignItems:'center'}}>
            <Badge bg={percentColor(metrics.disk?.mounts?.[0]?.usedPercent)}>{metrics.disk?.mounts?.[0]?.usedPercent != null ? `${Math.round(metrics.disk.mounts[0].usedPercent)}%` : '-'}</Badge>
          </div>
          <div style={{flex:1, height:'100%'}}>
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
        <div style={{display:'flex', alignItems:'stretch', gap:8}}>
          <div style={{display:'flex', alignItems:'center'}}>
            <Badge bg={'info'}>RX/TX</Badge>
          </div>
          <div style={{flex:1, height:'100%'}}>
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

  return (
    <Card className="mb-3" data-testid="system-metrics-widget">
      <Card.Body>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h5 className="mb-0">System Metrics</h5>
          <Button size="sm" variant="outline-secondary" onClick={load} disabled={loading}>Refresh</Button>
        </div>
        <div style={{ marginTop: 12 }}>
          {loading ? (
            <Spinner animation="border" size="sm" />
          ) : error ? (
            <div style={{ color: '#c00' }}>{error}</div>
          ) : (
            <Row className="g-3">
              {tiles.map(t => (
                  <Col key={t.key} xs={12} sm={6} md={3} lg={3} xl={3}>
                    <div
                      role="button"
                      onClick={() => setSelected(t.key)}
                      style={{
                        border: '1px solid #e0e0e0', borderRadius: 8, padding: 12, height: '100%',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)', cursor: 'pointer',
                        display:'flex', flexDirection:'column', minHeight: 110
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{t.title}</div>
                      <div style={{ marginTop: 8, flex:1, display:'flex' }}>{t.badge}</div>
                    </div>
                  </Col>
                ))}
            </Row>
          )}
        </div>

        <Modal show={!!selected} onHide={()=>setSelected(null)} centered>
          <Modal.Header closeButton>
            <Modal.Title>{tiles.find(x=>x.key===selected)?.title}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {tiles.find(x=>x.key===selected)?.details}
            <div style={{marginTop:8, color:'#666', fontSize:12}}>Updated: {metrics.timestamp ? new Date(metrics.timestamp).toLocaleString() : '-'}</div>
            <div style={{color:'#666', fontSize:12}}>Uptime: {metrics.uptimeSec ? `${Math.floor((metrics.uptimeSec||0)/3600)}h` : '-'}</div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={()=>setSelected(null)}>Close</Button>
          </Modal.Footer>
        </Modal>
      </Card.Body>
    </Card>
  );
}
