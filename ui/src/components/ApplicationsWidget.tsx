/**
 * Applications Widget
 * 
 * Displays and manages external applications that access Device Hub.
 * Shows API tokens, their connection status, and active WebSocket connections.
 * Provides a comprehensive view of the application layer that consumes device data.
 * 
 * Applications (like Node-RED, custom dashboards) connect via:
 * - REST API with token authentication
 * - WebSocket connections for real-time telemetry
 */
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Modal, Spinner } from 'react-bootstrap';
import { StatusPill, SectionLabel, Field } from './ui';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faKey, faToggleOn, faToggleOff, faTrash, faCopy, faPlus } from '@fortawesome/free-solid-svg-icons';

type ApiToken = {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
  expires_at?: string;
  last_used?: string;
};

type ActiveConnection = {
  tokenId: string;
  appName: string;
  connectionCount: number;
  subscriptions: {
    topics: string[];
    devices: string[];
  }[];
};

type ConnectionStatus = {
  totalConnections: number;
  activeApplications: number;
  connections: ActiveConnection[];
};

export default function ApplicationsWidget() {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [connections, setConnections] = useState<ConnectionStatus>({ totalConnections: 0, activeApplications: 0, connections: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  
  // Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenExpiry, setNewTokenExpiry] = useState('');
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  
  // View token modal state
  const [viewTokenModal, setViewTokenModal] = useState(false);
  const [viewingToken, setViewingToken] = useState<{id: string, name: string, token: string} | null>(null);

  async function loadTokens() {
    try {
      setLoading(true);
      setError('');
      const resp = await fetch('/api/tokens');
      if (resp.ok) {
        const data = await resp.json();
        setTokens(Array.isArray(data?.tokens) ? data.tokens : []);
      } else if (resp.status === 401) {
        setTokens([]);
      } else {
        setError('Failed to load tokens');
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load tokens');
    } finally {
      setLoading(false);
    }
  }

  async function loadConnections() {
    try {
      const resp = await fetch('/api/applications/connections');
      if (resp.ok) {
        const data = await resp.json();
        setConnections(data);
      }
    } catch (e: any) {
      // Silently fail - connections are optional data
      setConnections({ totalConnections: 0, activeApplications: 0, connections: [] });
    }
  }

  async function loadAll() {
    await Promise.all([loadTokens(), loadConnections()]);
  }

  useEffect(() => {
    loadAll();
    // Refresh connections every 10 seconds
    const interval = setInterval(loadConnections, 10000);
    return () => clearInterval(interval);
  }, []);

  async function createToken() {
    try {
      setCreating(true);
      const body: any = { name: newTokenName || 'API Token' };
      if (newTokenExpiry) {
        body.expiresIn = parseInt(newTokenExpiry) * 86400 * 1000; // Convert days to milliseconds
      }
      
      const resp = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      
      if (resp.ok) {
        const data = await resp.json();
        setGeneratedToken(data.token);
        await loadAll();
      } else {
        const err = await resp.json().catch(() => ({}));
        setError(err.error || 'Failed to create token');
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to create token');
    } finally {
      setCreating(false);
    }
  }

  async function deleteToken(token: ApiToken) {
    if (!confirm(`Delete application "${token.name}"? This will revoke access for all services using this token.`)) return;
    
    try {
      const resp = await fetch(`/api/tokens/${token.id}`, { method: 'DELETE' });
      if (resp.ok) {
        await loadAll();
      } else {
        setError('Failed to delete token');
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to delete token');
    }
  }

  async function viewToken(tokenId: string, tokenName: string) {
    try {
      const resp = await fetch(`/api/tokens/${tokenId}/reveal`);
      if (resp.ok) {
        const data = await resp.json();
        setViewingToken({ id: tokenId, name: tokenName, token: data.token });
        setViewTokenModal(true);
      } else {
        setError('Failed to retrieve token');
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to retrieve token');
    }
  }

  function copyTokenToClipboard() {
    if (viewingToken?.token) {
      navigator.clipboard.writeText(viewingToken.token);
    }
  }

  async function toggleTokenStatus(token: ApiToken) {
    try {
      const resp = await fetch(`/api/tokens/${token.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !token.active })
      });
      if (resp.ok) {
        await loadAll();
      } else {
        setError('Failed to update token status');
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to update token');
    }
  }

  // Get connection info for a specific token
  function getConnectionInfo(tokenId: string): ActiveConnection | undefined {
    return connections.connections.find(c => c.tokenId === tokenId);
  }

  return (
    <>
      <Card className="mb-3">
        <Card.Header className="justify-content-between">
          {/* One summary line beside the title, matching the Devices panel:
              how many there are, how many are up. These counts used to be
              stated twice - here, and again as a strip under the table. */}
          <div className="d-flex align-items-baseline gap-2 flex-wrap">
            <span className="eb-panel-title">
              <i className="fa-solid fa-cloud"></i>
              Applications
            </span>
            <span className="eb-panel-meta">
              {tokens.filter(t => t.active).length} configured · {connections.activeApplications} connected
            </span>
          </div>
          <Button
            size="sm"
            variant="outline-secondary"
            title="Add Application"
            onClick={() => {
              setNewTokenName('');
              setNewTokenExpiry('');
              setGeneratedToken(null);
              setShowCreateModal(true);
            }}
          >
            <FontAwesomeIcon icon={faPlus} />
          </Button>
        </Card.Header>
        <Card.Body className="eb-body-flush">
          {loading ? (
            <div className="text-center py-4">
              <Spinner animation="border" size="sm" />
            </div>
          ) : error ? (
            <Alert variant="danger" className="m-3">
              {error}
            </Alert>
          ) : tokens.length === 0 ? (
            <div className="eb-muted text-center py-5 px-3">
              No applications configured yet.
              <div className="small eb-subtle mt-2">
                Node-RED, custom dashboards and other tools connect with an API token.
                Add one with the <FontAwesomeIcon icon={faPlus} /> button above.
              </div>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table eb-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Connection</th>
                    <th>Created</th>
                    <th>Last Used</th>
                    <th className="text-end">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((token) => {
                    const isExpired = token.expires_at && new Date(token.expires_at) < new Date();
                    const connInfo = getConnectionInfo(token.id);
                    const isConnected = !!connInfo && connInfo.connectionCount > 0;
                    
                    return (
                      <tr key={token.id} className="device-row">
                        <td className="fw-semibold">
                          {token.name}
                        </td>
                        <td>
                          <StatusPill
                            tone={!token.active ? 'idle' : isExpired ? 'fault' : 'ok'}
                            label={!token.active ? 'Inactive' : isExpired ? 'Expired' : 'Active'}
                          />
                        </td>
                        <td>
                          {/* Connected or not, and nothing more. The socket
                              count that used to sit here answered a question
                              nobody asks: one token belongs to one
                              application, so how many WebSockets that
                              application happens to hold open is its own
                              business. */}
                          <StatusPill
                            tone={isConnected ? 'ok' : 'idle'}
                            label={isConnected ? 'Connected' : 'Disconnected'}
                          />
                        </td>
                        <td className="eb-muted eb-num">
                          <small>{new Date(token.created_at).toLocaleDateString()}</small>
                        </td>
                        <td className="eb-muted eb-num">
                          <small>{token.last_used ? new Date(token.last_used).toLocaleDateString() : 'Never'}</small>
                        </td>
                        <td className="text-end">
                          <div className="d-inline-flex gap-1 device-actions" role="group">
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost"
                              onClick={() => viewToken(token.id, token.name)}
                              title="View Token"
                            >
                              <FontAwesomeIcon icon={faKey} />
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost"
                              onClick={() => toggleTokenStatus(token)}
                              title={token.active ? 'Disable' : 'Enable'}
                            >
                              <FontAwesomeIcon icon={token.active ? faToggleOn : faToggleOff} />
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost btn-ghost-danger"
                              onClick={() => deleteToken(token)}
                              title="Delete"
                            >
                              <FontAwesomeIcon icon={faTrash} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

        </Card.Body>
      </Card>

      {/* View Token Modal */}
      <Modal show={viewTokenModal} onHide={() => setViewTokenModal(false)} centered>
        <Modal.Header closeButton closeVariant="white">
          <Modal.Title><FontAwesomeIcon icon={faKey} />View token</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {viewingToken && (
            <>
              <Field label="Application" value={viewingToken.name} />
              <div className="mt-3 mb-3">
                <label className="form-label">Token</label>
                <div className="input-group">
                  <input 
                    type="text" 
                    className="form-control eb-mono" 
                    value={viewingToken.token} 
                    readOnly
                    style={{ fontSize: '0.875rem' }}
                  />
                  <button 
                    className="btn btn-outline-secondary" 
                    type="button"
                    onClick={copyTokenToClipboard}
                    title="Copy to clipboard"
                  >
                    <FontAwesomeIcon icon={faCopy} />
                  </button>
                </div>
              </div>
              <Alert variant="warning" className="mb-0">
                <small>
                  Keep this token secure. Anyone holding it can read and control this Device Hub.
                </small>
              </Alert>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setViewTokenModal(false)}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Create Application Token Modal */}
      <Modal show={showCreateModal} onHide={() => !creating && setShowCreateModal(false)}>
        <Modal.Header closeButton closeVariant="white">
          <Modal.Title><FontAwesomeIcon icon={faPlus} />Add new application</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {generatedToken ? (
            <div>
              <Alert variant="success">
                <Alert.Heading>Application token created</Alert.Heading>
                <p className="mb-0">Copy this token now — you won't be able to see it again.</p>
              </Alert>
              <Form.Group className="mt-3">
                <Form.Label>API token</Form.Label>
                <Form.Control
                  type="text"
                  value={generatedToken}
                  readOnly
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <Form.Text>
                  Sent as <code>Authorization: Bearer {generatedToken.substring(0, 10)}…</code>
                </Form.Text>
              </Form.Group>
              <div className="mt-4">
                <SectionLabel>How to use it</SectionLabel>
                <Field label="REST API" value={<code>Authorization: Bearer TOKEN</code>} />
                <Field label="WebSocket" value={<code>ws://devicehub:8090/ws?token=TOKEN</code>} />
                <Field label="Node-RED" value="Edgeberry Device Hub nodes, with this token" />
              </div>
            </div>
          ) : (
            <div>
              <Form.Group className="mb-3">
                <Form.Label>Application name</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="e.g., Node-RED Production, Custom Dashboard, Analytics Tool"
                  value={newTokenName}
                  onChange={(e) => setNewTokenName(e.target.value)}
                  disabled={creating}
                />
                <Form.Text>
                  A descriptive name to identify this application
                </Form.Text>
              </Form.Group>
              <Form.Group>
                <Form.Label>Expiration (optional)</Form.Label>
                <Form.Control
                  type="number"
                  placeholder="Days until expiration (leave empty for no expiration)"
                  value={newTokenExpiry}
                  onChange={(e) => setNewTokenExpiry(e.target.value)}
                  disabled={creating}
                />
                <Form.Text>
                  Leave empty for tokens that never expire
                </Form.Text>
              </Form.Group>
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          {generatedToken ? (
            <Button variant="primary" onClick={() => setShowCreateModal(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setShowCreateModal(false)} disabled={creating}>
                Cancel
              </Button>
              <Button variant="primary" onClick={createToken} disabled={creating || !newTokenName}>
                {creating ? <><Spinner animation="border" size="sm" className="me-2" />Creating…</> : 'Create token'}
              </Button>
            </>
          )}
        </Modal.Footer>
      </Modal>
    </>
  );
}
