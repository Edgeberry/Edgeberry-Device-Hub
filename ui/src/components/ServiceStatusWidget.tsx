import React, { useEffect, useState } from 'react';
import { Card, Table, Badge, Spinner, Button } from 'react-bootstrap';
import { getServices } from '../api/fleethub';

type ServiceItem = { unit: string; status: string };

type ServicesResponse = { services: ServiceItem[] } | { message?: string };

export default function ServiceStatusWidget() {
  const [loading, setLoading] = useState<boolean>(true);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [error, setError] = useState<string>('');

  async function load() {
    try {
      setLoading(true);
      const res: ServicesResponse = await getServices();
      if ((res as any).message) throw new Error((res as any).message);
      const list = (res as any).services || [];
      setServices(list);
    } catch (e: any) {
      setError(e?.message || 'Failed to load services');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <Card className="mb-3" data-testid="services-widget">
      <Card.Body>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h5 className="mb-0">Services</h5>
          <Button size="sm" variant="outline-secondary" onClick={load} disabled={loading}>Refresh</Button>
        </div>
        <div style={{ marginTop: 12 }}>
          {loading ? (
            <Spinner animation="border" size="sm" />
          ) : error ? (
            <div style={{ color: '#c00' }}>{error}</div>
          ) : (
            <Table size="sm" hover responsive>
              <thead>
                <tr>
                  <th>Unit</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s.unit}>
                    <td>{s.unit}</td>
                    <td>
                      <Badge bg={s.status === 'active' ? 'success' : (s.status === 'inactive' ? 'secondary' : 'warning')}>{s.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </Card.Body>
    </Card>
  );
}
