/**
 * System metrics widget
 *
 * Displays CPU, memory, disk and network metrics from the core-service `/metrics` endpoint.
 * Auto-refreshes every 10 seconds. Clicking a tile opens a modal with details.
 */
import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, Col, Modal, Row, Spinner } from 'react-bootstrap';
import { getMetrics } from '../api/fleethub';

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

  useEffect(()=>{ load(); const id = setInterval(load, 10000); return ()=>clearInterval(id); },[]);

  const tiles = [
    {
      key: 'cpu', title: 'CPU',
      value: metrics.cpu ? `${Math.round(metrics.cpu.approxUsagePercent)}%` : '-',
      badge: <Badge bg={percentColor(metrics.cpu?.approxUsagePercent)}>{metrics.cpu ? `${Math.round(metrics.cpu.approxUsagePercent)}%` : '-'}</Badge>,
      details: (
        <div>
          <div>Load avg: {metrics.cpu?.load1?.toFixed(2)} / {metrics.cpu?.load5?.toFixed(2)} / {metrics.cpu?.load15?.toFixed(2)} (cores: {metrics.cpu?.cores})</div>
        </div>
      )
    },
    {
      key: 'memory', title: 'Memory',
      value: metrics.memory ? `${Math.round(metrics.memory.usedPercent)}%` : '-',
      badge: <Badge bg={percentColor(metrics.memory?.usedPercent)}>{metrics.memory ? `${Math.round(metrics.memory.usedPercent)}%` : '-'}</Badge>,
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
      badge: <Badge bg={percentColor(metrics.disk?.mounts?.[0]?.usedPercent)}>{metrics.disk?.mounts?.[0]?.usedPercent != null ? `${Math.round(metrics.disk.mounts[0].usedPercent)}%` : '-'}</Badge>,
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
      badge: <Badge bg={'info'}>RX/TX</Badge>,
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
                <Col key={t.key} xs={12} sm={6} md={4} lg={3} xl={2}>
                  <div
                    role="button"
                    onClick={() => setSelected(t.key)}
                    style={{
                      border: '1px solid #e0e0e0', borderRadius: 8, padding: 12, height: '100%',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.05)', cursor: 'pointer'
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{t.title}</div>
                    <div style={{ marginTop: 8 }}>{t.badge}</div>
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
