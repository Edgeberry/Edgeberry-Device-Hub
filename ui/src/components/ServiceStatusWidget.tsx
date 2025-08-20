/**
 * Services status widget
 *
 * Lists systemd service units exposed by the core-service and allows
 * viewing recent logs and performing admin actions (start/stop/restart).
 * Action buttons are enabled only for authenticated admin (single-user MVP).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Card, Badge, Spinner, Button, Row, Col, Modal } from 'react-bootstrap';
import { getServices, getServiceLogs, startService, stopService, restartService, runMqttSanityTest } from '../api/devicehub';
import { subscribe as wsSubscribe, unsubscribe as wsUnsubscribe, isConnected as wsIsConnected } from '../api/socket';

type ServiceItem = { unit: string; status: string; version?: string };

type ServicesResponse = { services: ServiceItem[] } | { message?: string };

export default function ServiceStatusWidget(props:{user:any|null}) {
  const [loading, setLoading] = useState<boolean>(true);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [error, setError] = useState<string>('');
  const [selected, setSelected] = useState<ServiceItem | null>(null);
  const [logs, setLogs] = useState<string>('');
  const [logsLoading, setLogsLoading] = useState<boolean>(false);
  const [streamEnded, setStreamEnded] = useState<string>('');
  const [actionBusy, setActionBusy] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string>('');
  const [diagOpen, setDiagOpen] = useState<boolean>(false);
  const [diagBusy, setDiagBusy] = useState<boolean>(false);
  const [diagError, setDiagError] = useState<string>('');
  const [diagData, setDiagData] = useState<any>(null);
  const logsRef = useRef<HTMLDivElement|null>(null);

  // Shared helpers: 24h timestamp formatting (YYYY-MM-DD HH:mm:ss)
  function pad2(n: number){ return n < 10 ? `0${n}` : String(n); }
  function formatDate24(d: Date): string {
    const y = d.getFullYear();
    const m = pad2(d.getMonth()+1);
    const da = pad2(d.getDate());
    const h = pad2(d.getHours());
    const mi = pad2(d.getMinutes());
    const s = pad2(d.getSeconds());
    return `${y}-${m}-${da} ${h}:${mi}:${s}`;
  }

  // Parse a timestamp value into milliseconds since epoch, or NaN if unknown
  function parseTimestampMs(raw: any): number {
    try{
      if(!raw && raw !== 0) return NaN;
      const num = Number(raw);
      if(Number.isFinite(num) && num > 0){
        let ms: number;
        if(num < 1e11) ms = num * 1000;            // seconds -> ms
        else if(num < 1e14) ms = num;              // milliseconds
        else if(num < 1e17) ms = Math.floor(num / 1e3); // microseconds -> ms
        else ms = Math.floor(num / 1e6);           // nanoseconds -> ms
        const d = new Date(ms);
        return isNaN(d.getTime()) ? NaN : d.getTime();
      }
      const d = new Date(String(raw));
      return isNaN(d.getTime()) ? NaN : d.getTime();
    }catch{ return NaN; }
  }

  // Try to parse a leading timestamp from a log line into ms since epoch
  function parseLeadingTimestampMs(line: string): number {
    try{
      const s = String(line);
      const iso = s.match(/^\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/);
      if(iso){ const d = new Date(iso[1]); return isNaN(d.getTime()) ? NaN : d.getTime(); }
      const epoch = s.match(/^\s*(\d{10,19})/);
      if(epoch){
        const num = Number(epoch[1]);
        if(Number.isFinite(num)){
          let ms: number;
          if(num < 1e11) ms = num * 1000;            // seconds -> ms
          else if(num < 1e14) ms = num;              // milliseconds
          else if(num < 1e17) ms = Math.floor(num / 1e3); // microseconds -> ms
          else ms = Math.floor(num / 1e6);           // nanoseconds -> ms
          const d = new Date(ms);
          return isNaN(d.getTime()) ? NaN : d.getTime();
        }
      }
      const m = s.match(/^\s*([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})/);
      if(m){
        const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const mi = monthNames.indexOf(m[1]);
        if(mi >= 0){
          const now = new Date();
          const year = now.getFullYear();
          const day = Number(m[2]);
          const h = Number(m[3]);
          const min = Number(m[4]);
          const sec = Number(m[5]);
          const d = new Date(year, mi, day, h, min, sec);
          return isNaN(d.getTime()) ? NaN : d.getTime();
        }
      }
      return NaN;
    }catch{ return NaN; }
  }

  // Re-format a line that already contains a leading timestamp to 24h (YYYY-MM-DD HH:mm:ss)
  function formatLeadingTimestampLine(line: string): string {
    try{
      const s = String(line);
      // ISO-like at start
      const iso = s.match(/^\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)(.*)$/);
      if(iso){
        const d = new Date(iso[1]);
        if(!isNaN(d.getTime())) return `${formatDate24(d)}${iso[2]}`;
      }
      // Epoch at start (seconds/ms/us/ns)
      const epoch = s.match(/^\s*(\d{10,19})(.*)$/);
      if(epoch){
        const num = Number(epoch[1]);
        if(Number.isFinite(num)){
          // Unit detection ranges:
          //  - <1e11: seconds
          //  - <1e14: milliseconds
          //  - <1e17: microseconds
          //  - else:  nanoseconds
          let ms: number;
          if(num < 1e11) ms = num * 1000;            // seconds -> ms
          else if(num < 1e14) ms = num;              // milliseconds
          else if(num < 1e17) ms = Math.floor(num / 1e3); // microseconds -> ms
          else ms = Math.floor(num / 1e6);           // nanoseconds -> ms
          const d = new Date(ms);
          if(!isNaN(d.getTime())) return `${formatDate24(d)}${epoch[2]}`;
        }
      }
      // syslog-style: "Aug 20 14:59:36 ..." (no year)
      const m = s.match(/^\s*([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})(.*)$/);
      if(m){
        const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const mi = monthNames.indexOf(m[1]);
        if(mi >= 0){
          const now = new Date();
          const year = now.getFullYear();
          const day = Number(m[2]);
          const h = Number(m[3]);
          const min = Number(m[4]);
          const sec = Number(m[5]);
          const d = new Date(year, mi, day, h, min, sec);
          if(!isNaN(d.getTime())) return `${formatDate24(d)}${m[6]}`;
        }
      }
      return s;
    }catch{ return String(line ?? ''); }
  }
  function formatTimestamp(raw: any): string {
    try{
      if(!raw && raw !== 0) return '';
      const num = Number(raw);
      if(Number.isFinite(num) && num > 0){
        // Unit detection ranges consistent with formatLeadingTimestampLine
        let ms: number;
        if(num < 1e11) ms = num * 1000;            // seconds -> ms
        else if(num < 1e14) ms = num;              // milliseconds
        else if(num < 1e17) ms = Math.floor(num / 1e3); // microseconds -> ms
        else ms = Math.floor(num / 1e6);           // nanoseconds -> ms
        const d = new Date(ms);
        if(!isNaN(d.getTime())) return formatDate24(d);
      }
      const d = new Date(String(raw));
      if(!isNaN(d.getTime())) return formatDate24(d);
      // Fallback: return as-is
      return String(raw);
    }catch{ return String(raw ?? ''); }
  }

  async function load() {
    try {
      setLoading(true);
      const res: ServicesResponse = await getServices();
      if ((res as any).message) throw new Error((res as any).message);
      const list = ((res as any).services || []).filter((s: ServiceItem)=> !String(s?.unit||'').toLowerCase().includes('registry'));
      setServices(list);
    } catch (e: any) {
      setError(e?.message || 'Failed to load services');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // prefer websocket updates if available; fallback to one-off HTTP
    let mounted = true;
    let fallbackTimer: any = null;
    const onServices = (data: any) => {
      if(!mounted) return;
      try{
        const raw = (Array.isArray(data?.services) ? data.services : []);
        // Debug incoming services
        try{ console.debug('[ServiceStatusWidget] services payload units:', raw.map((x:any)=>x?.unit)); }catch{}
        const list = raw.filter((s: ServiceItem)=> !String(s?.unit||'').toLowerCase().includes('registry'));
        setServices(list);
        setLoading(false);
        setError('');
        if (fallbackTimer) { try{ clearTimeout(fallbackTimer); }catch{} fallbackTimer = null; }
      }catch{}
    };
    wsSubscribe('services.status', onServices);
    // initial HTTP if WS not connected yet
    (async()=>{ if(!wsIsConnected()) await load(); })();
    // If WS is connected but no payload arrives promptly, fallback to HTTP after a short delay
    fallbackTimer = setTimeout(() => { if (mounted && loading) { load().catch(()=>{}); } }, 2500);
    return ()=>{ mounted = false; if (fallbackTimer) { try{ clearTimeout(fallbackTimer); }catch{} } wsUnsubscribe('services.status', onServices); };
  }, []);

  // Load logs whenever a selection opens the modal
  useEffect(()=>{
    if(!selected) return;
    (async ()=>{
      try{
        // Reset any prior stream end notice for a new selection
        setStreamEnded('');
        setLogsLoading(true);
        const res: any = await getServiceLogs(selected.unit, 200);

        function fmtEntry(e: any): string {
          try{
            const ts = formatTimestamp(e.SYSLOG_TIMESTAMP || e.__REALTIME_TIMESTAMP || e._SOURCE_REALTIME_TIMESTAMP || '');
            const ident = e.SYSLOG_IDENTIFIER || e._COMM || e._SYSTEMD_UNIT || '';
            const pid = e._PID ? `[${e._PID}]` : '';
            const msg = e.MESSAGE ?? JSON.stringify(e);
            return `${ts} ${ident}${pid} ${msg}`.trim();
          }catch{
            return typeof e === 'string' ? e : JSON.stringify(e);
          }
        }

        function findEntries(obj: any): any[] | null {
          if(!obj || typeof obj !== 'object') return null;
          if(Array.isArray(obj.entries)) return obj.entries as any[];
          // common alternatives
          if(Array.isArray(obj.logs)) return obj.logs as any[];
          if(Array.isArray(obj.lines)) return obj.lines as any[];
          // search shallow keys first
          for(const k of Object.keys(obj)){
            const v = (obj as any)[k];
            if(v && typeof v === 'object'){
              if(Array.isArray((v as any).entries)) return (v as any).entries as any[];
              if(Array.isArray((v as any).logs)) return (v as any).logs as any[];
              if(Array.isArray((v as any).lines)) return (v as any).lines as any[];
            }
          }
          // deep search (limited)
          for(const k of Object.keys(obj)){
            const v = (obj as any)[k];
            if(v && typeof v === 'object'){
              const found = findEntries(v);
              if(found) return found;
            }
          }
          return null;
        }

        // Normalize to oldest -> newest string lines
        let txt = '';
        if(typeof res === 'string'){
          // Try to parse stringified JSON containing entries
          try{
            const parsed = JSON.parse(res);
            if(parsed && Array.isArray(parsed.entries)){
              const arr = [...parsed.entries];
              // Detect order using timestamps on first/last
              const first = arr[0];
              const last = arr[arr.length - 1];
              const t0 = parseTimestampMs(first?.SYSLOG_TIMESTAMP || first?.__REALTIME_TIMESTAMP || first?._SOURCE_REALTIME_TIMESTAMP);
              const tN = parseTimestampMs(last?.SYSLOG_TIMESTAMP || last?.__REALTIME_TIMESTAMP || last?._SOURCE_REALTIME_TIMESTAMP);
              const needReverse = (Number.isFinite(t0) && Number.isFinite(tN)) ? (t0 > tN) : true;
              const ordered = needReverse ? arr.reverse() : arr;
              txt = ordered.map(fmtEntry).join('\n');
            } else {
              // Treat plain string logs as newest-first; normalize to oldest-first
              const lines = String(res).split(/\r?\n/).map(formatLeadingTimestampLine);
              const rawLines = String(res).split(/\r?\n/);
              const t0 = parseLeadingTimestampMs(rawLines[0] || '');
              const tN = parseLeadingTimestampMs(rawLines[rawLines.length - 1] || '');
              const needReverse = (Number.isFinite(t0) && Number.isFinite(tN)) ? (t0 > tN) : true;
              const ordered = needReverse ? [...lines].reverse() : lines;
              txt = ordered.join('\n');
            }
          }catch{
            const lines = String(res).split(/\r?\n/).map(formatLeadingTimestampLine);
            const rawLines = String(res).split(/\r?\n/);
            const t0 = parseLeadingTimestampMs(rawLines[0] || '');
            const tN = parseLeadingTimestampMs(rawLines[rawLines.length - 1] || '');
            const needReverse = (Number.isFinite(t0) && Number.isFinite(tN)) ? (t0 > tN) : true;
            const ordered = needReverse ? [...lines].reverse() : lines;
            txt = ordered.join('\n');
          }
        } else if(Array.isArray(res)){
          const arr = [...res];
          // Determine order using object timestamps if possible
          const getTs = (x:any) => (typeof x === 'object' && x) ? (x.SYSLOG_TIMESTAMP || x.__REALTIME_TIMESTAMP || x._SOURCE_REALTIME_TIMESTAMP) : undefined;
          const t0 = parseTimestampMs(getTs(arr[0]));
          const tN = parseTimestampMs(getTs(arr[arr.length - 1]));
          const needReverse = (Number.isFinite(t0) && Number.isFinite(tN)) ? (t0 > tN) : true;
          const ordered = needReverse ? arr.reverse() : arr;
          const mapped = ordered.map(x => (typeof x === 'object' && x) ? fmtEntry(x) : formatLeadingTimestampLine(String(x)));
          txt = mapped.join('\n');
        } else if(res && typeof res.logs === 'string'){
          const lines = String(res.logs).split(/\r?\n/).map(formatLeadingTimestampLine);
          const rawLines = String(res.logs).split(/\r?\n/);
          const t0 = parseLeadingTimestampMs(rawLines[0] || '');
          const tN = parseLeadingTimestampMs(rawLines[rawLines.length - 1] || '');
          const needReverse = (Number.isFinite(t0) && Number.isFinite(tN)) ? (t0 > tN) : true;
          const ordered = needReverse ? [...lines].reverse() : lines;
          txt = ordered.join('\n');
        } else if(res && Array.isArray(res.entries)){
          const arr = [...res.entries];
          const first = arr[0];
          const last = arr[arr.length - 1];
          const t0 = parseTimestampMs(first?.SYSLOG_TIMESTAMP || first?.__REALTIME_TIMESTAMP || first?._SOURCE_REALTIME_TIMESTAMP);
          const tN = parseTimestampMs(last?.SYSLOG_TIMESTAMP || last?.__REALTIME_TIMESTAMP || last?._SOURCE_REALTIME_TIMESTAMP);
          const needReverse = (Number.isFinite(t0) && Number.isFinite(tN)) ? (t0 > tN) : true;
          const ordered = needReverse ? arr.reverse() : arr;
          txt = ordered.map(fmtEntry).join('\n');
        } else {
          const entries = findEntries(res);
          if(entries) {
            const arr = [...entries];
            const first = arr[0];
            const last = arr[arr.length - 1];
            const t0 = parseTimestampMs(first?.SYSLOG_TIMESTAMP || first?.__REALTIME_TIMESTAMP || first?._SOURCE_REALTIME_TIMESTAMP);
            const tN = parseTimestampMs(last?.SYSLOG_TIMESTAMP || last?.__REALTIME_TIMESTAMP || last?._SOURCE_REALTIME_TIMESTAMP);
            const needReverse = (Number.isFinite(t0) && Number.isFinite(tN)) ? (t0 > tN) : true;
            const ordered = needReverse ? arr.reverse() : arr;
            txt = ordered.map(fmtEntry).join('\n');
          } else {
            txt = JSON.stringify(res);
          }
        }
        setLogs(txt);
      }catch(e:any){
        setLogs(`Logs unavailable: ${e?.message || 'unknown error'}`);
      }finally{
        setLogsLoading(false);
      }
    })();
  }, [selected]);

  // Stream live logs over WebSocket while modal is open
  useEffect(() => {
    if(!selected) return;
    let mounted = true;
    const unit = selected.unit;
    const topicStream = `logs.stream:${unit}`;
    const onLine = (payload: any) => {
      if(!mounted) return;
      try{
        const d = payload;
        if(!d || d.unit !== unit) return;
        const e = d.entry;
        const ts = (function(){
          try{
            const raw = e?.SYSLOG_TIMESTAMP || e?.__REALTIME_TIMESTAMP || e?._SOURCE_REALTIME_TIMESTAMP || '';
            return formatTimestamp(raw);
          }catch{ return ''; }
        })();
        const ident = e?.SYSLOG_IDENTIFIER || e?._COMM || e?._SYSTEMD_UNIT || '';
        const pid = e?._PID ? `[${e._PID}]` : '';
        const msg = e?.MESSAGE ?? (typeof e === 'string' ? e : JSON.stringify(e));
        const line = `${ts} ${ident}${pid} ${msg}`.trim();
        setLogs(prev => {
          const next = (prev ? `${prev}\n${line}` : line);
          // keep last 1000 lines to avoid unbounded growth (oldest-first, keep last MAX)
          const arr = next.split('\n');
          const MAX = 1000;
          return arr.length > MAX ? arr.slice(arr.length - MAX).join('\n') : next;
        });
      }catch{}
    };
    const onEnd = (payload: any) => {
      if(!mounted) return;
      if(payload?.unit === unit){ setStreamEnded(`Stream ended (exit ${payload?.code ?? '0'})`); }
    };
    // Subscribe to start stream and receive lines
    const noop = () => {};
    wsSubscribe(topicStream, noop);
    wsSubscribe('logs.line', onLine);
    wsSubscribe('logs.stream.end', onEnd);
    return () => { mounted = false; wsUnsubscribe('logs.stream.end', onEnd); wsUnsubscribe('logs.line', onLine); wsUnsubscribe(topicStream, noop); };
  }, [selected]);

  // Scroll to bottom (latest entry at bottom) whenever logs load or change
  useEffect(()=>{
    if(!logsRef.current) return;
    try{
      // microtask to ensure layout calculated
      requestAnimationFrame(()=>{
        const el = logsRef.current!;
        el.scrollTop = el.scrollHeight;
      });
    }catch{}
  }, [logs, logsLoading, selected]);

  function statusVariant(s: string){
    return s === 'active' ? 'success' : (s === 'inactive' ? 'secondary' : 'warning');
  }

  function prettyUnitName(unit: string){
    return unit.replace(/^devicehub-/, '').replace(/\.service$/, '');
  }

  async function doAction(kind: 'start'|'stop'|'restart', unit: string){
    try{
      setActionBusy(true);
      setActionError('');
      if(kind==='start') await startService(unit);
      else if(kind==='stop') await stopService(unit);
      else await restartService(unit);
      // If WS is disconnected, refresh list to reflect new status; otherwise WS will update us soon
      if(!wsIsConnected()) await load();
      // update selected to the refreshed service entry if still open
      const updated = services.find(s=>s.unit===unit);
      if(updated) setSelected(updated);
    }catch(e:any){
      setActionError(e?.message || 'Action failed');
    }finally{
      setActionBusy(false);
    }
  }

  const canControl = !!(props?.user && (
    (Array.isArray(props.user.roles) && props.user.roles.includes('admin')) ||
    // fallback: any authenticated user in this MVP is the single admin
    (!Array.isArray(props.user.roles))
  ));

  return (
    <Card className="mb-3" data-testid="services-widget">
      <Card.Body>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h5 className="mb-0">Services</h5>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button
              size="sm"
              variant="outline-primary"
              onClick={async ()=>{
                setDiagOpen(true);
                if(!canControl) return; // guard: admin only
                setDiagBusy(true);
                setDiagError('');
                setDiagData(null);
                try{
                  const res: any = await runMqttSanityTest();
                  setDiagData(res);
                }catch(e:any){
                  setDiagError(e?.message || 'Diagnostics failed');
                }finally{
                  setDiagBusy(false);
                }
              }}
              disabled={!canControl || diagBusy}
              title={canControl ? 'Run device-side MQTT sanity test' : 'Admin only'}
            >
              {diagBusy ? (<><Spinner as="span" animation="border" size="sm" /> Running...</>) : 'Sanity Check'}
            </Button>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          {loading ? (
            <Spinner animation="border" size="sm" />
          ) : error ? (
            <div style={{ color: '#c00' }}>{error}</div>
          ) : (
            <>
              {services.length === 0 ? (
                <div>No services found.</div>
              ) : (
                <Row className="g-3">
                  {services.map((s) => {
                    const variant = s.status === 'active' ? 'success' : (s.status === 'inactive' ? 'secondary' : 'warning');
                    return (
                      <Col key={s.unit} xs={12} sm={6} md={4} lg={3} xl={2}>
                        <div
                          role="button"
                          onClick={() => setSelected(s)}
                          style={{
                            border: '1px solid #e0e0e0',
                            borderRadius: 8,
                            padding: 12,
                            height: '100%',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>
                            {prettyUnitName(s.unit)}{' '}
                            {s.version ? <span style={{ fontWeight: 400, fontSize: 12, color:'#666' }}>v{s.version}</span> : null}
                          </div>
                          <div style={{ marginTop: 8 }}>
                            <Badge bg={variant}>{s.status}</Badge>
                          </div>
                        </div>
                      </Col>
                    );
                  })}
                </Row>
              )}
              <Modal show={!!selected} onHide={() => setSelected(null)} centered size="xl" scrollable fullscreen="md-down">
                <Modal.Header closeButton>
                  <Modal.Title>Service details</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                  {selected && (
                    <div>
                      <div style={{ marginBottom: 6 }}><strong>Service:</strong> {prettyUnitName(selected.unit)}</div>
                      {selected.version ? (
                        <div style={{ marginBottom: 6 }}><strong>Version:</strong> v{selected.version}</div>
                      ) : null}
                      <div style={{ marginBottom: 6, opacity: 0.7 }}><small>Unit id: {selected.unit}</small></div>
                      <div style={{ marginBottom: 12 }}><strong>Status:</strong> <Badge bg={statusVariant(selected.status)}>{selected.status}</Badge></div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
                        <Button size="sm" variant="success" disabled={!canControl || actionBusy} onClick={()=>doAction('start', selected.unit)}>Start</Button>
                        <Button size="sm" variant="warning" disabled={!canControl || actionBusy} onClick={()=>doAction('restart', selected.unit)}>Restart</Button>
                        <Button size="sm" variant="danger" disabled={!canControl || actionBusy} onClick={()=>doAction('stop', selected.unit)}>Stop</Button>
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
                  <Button variant="secondary" onClick={() => setSelected(null)}>Close</Button>
                </Modal.Footer>
              </Modal>
              {/* Diagnostics Modal */}
              <Modal show={diagOpen} onHide={()=>{ if(!diagBusy) setDiagOpen(false); }} centered size="lg" scrollable>
                <Modal.Header closeButton>
                  <Modal.Title>Sanity Check — Device MQTT Diagnostics</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                  {diagBusy && (
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <Spinner animation="border" size="sm" />
                      <span>Running device-side test…</span>
                    </div>
                  )}
                  {!diagBusy && (
                    <div>
                      {diagError && <div style={{ color:'#c00', marginBottom: 8 }}>{diagError}</div>}
                      {diagData && (
                        <div>
                          <div style={{ marginBottom: 8, fontWeight: 600 }}>
                            Result: {diagData.ok ? <span style={{ color:'#0a0' }}>OK</span> : <span style={{ color:'#a00' }}>FAIL</span>} {' '}
                            <small style={{ color:'#666' }}>(exit {diagData.exitCode ?? 'n/a'}, {diagData.durationMs ?? '?'} ms)</small>
                          </div>
                          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                            <div>
                              <div style={{ fontWeight:600, marginBottom:4 }}>STDOUT</div>
                              <pre style={{ background:'#0b0b10', color:'#e0e6f0', borderRadius:8, padding:8, maxHeight:240, overflow:'auto', whiteSpace:'pre-wrap', overflowWrap:'anywhere', wordBreak:'break-word' }}>{diagData.stdout || ''}</pre>
                            </div>
                            <div>
                              <div style={{ fontWeight:600, marginBottom:4 }}>STDERR</div>
                              <pre style={{ background:'#0b0b10', color:'#e0e6f0', borderRadius:8, padding:8, maxHeight:240, overflow:'auto', whiteSpace:'pre-wrap', overflowWrap:'anywhere', wordBreak:'break-word' }}>{diagData.stderr || ''}</pre>
                            </div>
                          </div>
                        </div>
                      )}
                      {!diagError && !diagData && (
                        <div className="text-muted">No diagnostics output.</div>
                      )}
                    </div>
                  )}
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="secondary" onClick={()=> setDiagOpen(false)} disabled={diagBusy}>Close</Button>
                </Modal.Footer>
              </Modal>
            </>
          )}
        </div>
      </Card.Body>
    </Card>
  );
}
