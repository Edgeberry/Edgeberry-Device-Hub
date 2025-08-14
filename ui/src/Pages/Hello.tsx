import React, { useCallback, useEffect, useMemo, useState } from 'react';

type ServiceStatus = { unit: string; status: string };

type LogsResponse = { entries: Array<Record<string, any>> };

export default function Hello() {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [logs, setLogs] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const okCount = useMemo(() => services.filter(s => s.status === 'active').length, [services]);

  const loadServices = useCallback(async () => {
    try {
      const res = await fetch('/api/services');
      if (!res.ok) throw new Error('services http ' + res.status);
      const data = await res.json();
      setServices(data.services || []);
    } catch (e: any) {
      setError(e.message || String(e));
    }
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/logs?lines=100');
      if (!res.ok) throw new Error('logs http ' + res.status);
      const data: LogsResponse = await res.json();
      const lines = (data.entries || []).map((e) => {
        const unit = e.SYSLOG_IDENTIFIER || e._SYSTEMD_UNIT || '';
        const msg = e.MESSAGE || JSON.stringify(e);
        return `[${unit}] ${msg}`;
      });
      setLogs(lines.join('\n'));
    } catch (e: any) {
      setError(e.message || String(e));
    }
  }, []);

  const emitHello = useCallback(async () => {
    try {
      const res = await fetch('/api/logs/hello', { method: 'POST' });
      if (!res.ok) throw new Error('emit http ' + res.status);
      await loadLogs();
    } catch (e: any) {
      setError(e.message || String(e));
    }
  }, [loadLogs]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.allSettled([loadServices(), loadLogs()]);
      setLoading(false);
    })();
  }, [loadServices, loadLogs]);

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial' }}>
      <h1>Fleet Hub — Hello World</h1>
      <p>Unified core-service is serving this page and the API.</p>
      {error && (
        <div style={{ color: '#b00020', marginBottom: 12 }}>Error: {error}</div>
      )}
      {loading ? (
        <div>Loading…</div>
      ) : (
        <>
          <section style={{ marginBottom: 24 }}>
            <h2>Services</h2>
            <div style={{ marginBottom: 8 }}>
              Active: {okCount}/{services.length}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 6 }}>Unit</th>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 6 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s.unit}>
                    <td style={{ padding: 6, borderBottom: '1px solid #f0f0f0' }}>{s.unit}</td>
                    <td style={{ padding: 6, borderBottom: '1px solid #f0f0f0', color: s.status === 'active' ? 'green' : 'red' }}>{s.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section style={{ marginBottom: 24 }}>
            <h2>Logs</h2>
            <div style={{ marginBottom: 8 }}>
              <button onClick={emitHello}>Emit demo hello logs</button>
              <button onClick={loadLogs} style={{ marginLeft: 8 }}>Refresh</button>
            </div>
            <pre style={{ background: '#111', color: '#ddd', padding: 12, borderRadius: 6, maxHeight: 360, overflow: 'auto' }}>
              {logs}
            </pre>
          </section>
        </>
      )}
    </div>
  );
}
