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
import { Alert, Badge, Button, Card, Form, Modal, Spinner, Table } from 'react-bootstrap';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faKey, faToggleOn, faToggleOff, faTrash, faCopy } from '@fortawesome/free-solid-svg-icons';

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

export default function ApplicationsWidget(props: { user: any | null }) {
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

  // Check if user is admin
  const isAdmin = props.user && (
    (Array.isArray(props.user.roles) && props.user.roles.includes('admin')) ||
    (!Array.isArray(props.user.roles))
  );

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
    if (props.user) {
      loadAll();
      // Refresh connections every 10 seconds
      const interval = setInterval(loadConnections, 10000);
      return () => clearInterval(interval);
    }
  }, [props.user]);

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

  if (!props.user) {
    return null;
  }

  return (
    <>
      <Card className="mb-3">
        <Card.Header className="d-flex justify-content-between align-items-center">
          <div>
            <i className="fa-solid fa-cloud me-2"></i>
            Applications
            <small className="text-muted ms-2">
              ({tokens.filter(t => t.active).length} configured · {connections.activeApplications} connected)
            </small>
          </div>
          {isAdmin && (
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setNewTokenName('');
                setNewTokenExpiry('');
                setGeneratedToken(null);
                setShowCreateModal(true);
              }}
            >
              <i className="fa fa-plus"></i> New Application
            </Button>
          )}
        </Card.Header>
        <Card.Body>
          {loading ? (
            <div className="text-center">
              <Spinner animation="border" size="sm" />
            </div>
          ) : error ? (
            <Alert variant="danger" className="mb-0">
              <i className="fa fa-exclamation-triangle me-2"></i>
              {error}
            </Alert>
          ) : tokens.length === 0 ? (
            <div className="text-muted text-center py-3">
              <i className="fa fa-info-circle me-2"></i>
              No applications configured.
              {isAdmin && ' Click "New Application" to create one.'}
              <div className="small mt-2">
                Applications like Node-RED, custom dashboards, or other tools can connect via API tokens.
              </div>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm mb-0">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Connection</th>
                    <th>Created</th>
                    <th>Last Used</th>
                    {isAdmin && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((token) => {
                    const isExpired = token.expires_at && new Date(token.expires_at) < new Date();
                    const connInfo = getConnectionInfo(token.id);
                    const isConnected = !!connInfo && connInfo.connectionCount > 0;
                    
                    return (
                      <tr key={token.id}>
                        <td className="align-middle">
                          <div className="d-flex align-items-center">
                            <i className="fa-solid fa-cube me-2 text-muted"></i>
                            <span>{token.name}</span>
                          </div>
                        </td>
                        <td className="align-middle">
                          <Badge bg={!token.active ? 'secondary' : isExpired ? 'danger' : 'success'}>
                            {!token.active ? 'Inactive' : isExpired ? 'Expired' : 'Active'}
                          </Badge>
                        </td>
                        <td className="align-middle">
                          {isConnected ? (
                            <div>
                              <Badge bg="success" className="me-1">
                                <i className="fa fa-circle-dot me-1"></i>
                                Connected
                              </Badge>
                              <small className="text-muted">
                                {connInfo.connectionCount} {connInfo.connectionCount === 1 ? 'session' : 'sessions'}
                              </small>
                            </div>
                          ) : (
                            <Badge bg="secondary">
                              <i className="fa fa-circle me-1"></i>
                              Disconnected
                            </Badge>
                          )}
                        </td>
                        <td className="align-middle">
                          <small>{new Date(token.created_at).toLocaleDateString()}</small>
                        </td>
                        <td className="align-middle">
                          <small>{token.last_used ? new Date(token.last_used).toLocaleDateString() : 'Never'}</small>
                        </td>
                        {isAdmin && (
                          <td className="align-middle">
                            <div className="btn-group" role="group">
                              <button 
                                type="button" 
                                className="btn btn-sm btn-edgeberry"
                                onClick={() => viewToken(token.id, token.name)}
                                title="View Token"
                              >
                                <FontAwesomeIcon icon={faKey} />
                              </button>
                              <button 
                                type="button" 
                                className="btn btn-sm btn-edgeberry"
                                onClick={() => toggleTokenStatus(token)}
                                title={token.active ? 'Disable' : 'Enable'}
                              >
                                <FontAwesomeIcon icon={token.active ? faToggleOn : faToggleOff} />
                              </button>
                              <button 
                                type="button" 
                                className="btn btn-sm btn-edgeberry"
                                onClick={() => deleteToken(token)}
                                title="Delete"
                              >
                                <FontAwesomeIcon icon={faTrash} />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!isAdmin && tokens.length > 0 && (
            <div className="text-muted small mt-2">
              <i className="fa fa-info-circle me-1"></i>
              Contact an administrator to manage applications.
            </div>
          )}
          {connections.totalConnections > 0 && (
            <div className="mt-3 p-2 bg-light rounded">
              <small className="text-muted">
                <i className="fa fa-info-circle me-1"></i>
                <strong>{connections.totalConnections}</strong> active WebSocket connection{connections.totalConnections !== 1 ? 's' : ''} 
                from <strong>{connections.activeApplications}</strong> application{connections.activeApplications !== 1 ? 's' : ''}
              </small>
            </div>
          )}
        </Card.Body>
      </Card>

      {/* View Token Modal */}
      <Modal show={viewTokenModal} onHide={() => setViewTokenModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>View Token</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {viewingToken && (
            <>
              <p className="mb-2">
                <strong>Application:</strong> {viewingToken.name}
              </p>
              <div className="mb-3">
                <label className="form-label"><strong>Token:</strong></label>
                <div className="input-group">
                  <input 
                    type="text" 
                    className="form-control font-monospace" 
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
                  <i className="fa fa-exclamation-triangle me-1"></i>
                  Keep this token secure. Anyone with this token can access your Device Hub data.
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
        <Modal.Header closeButton>
          <Modal.Title>Add New Application</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {generatedToken ? (
            <div>
              <Alert variant="success">
                <Alert.Heading>Application Token Created!</Alert.Heading>
                <p>Copy this token now. You won't be able to see it again.</p>
              </Alert>
              <Form.Group>
                <Form.Label>API Token:</Form.Label>
                <Form.Control
                  type="text"
                  value={generatedToken}
                  readOnly
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <Form.Text className="text-muted">
                  Use this token in the Authorization header: Bearer {generatedToken.substring(0, 10)}...
                </Form.Text>
              </Form.Group>
              <div className="mt-3">
                <strong>How to use this token:</strong>
                <ul className="small">
                  <li><strong>REST API:</strong> Add header <code>Authorization: Bearer TOKEN</code></li>
                  <li><strong>WebSocket:</strong> Connect to <code>ws://devicehub:8090/ws?token=TOKEN</code></li>
                  <li><strong>Node-RED:</strong> Use the Edgeberry Device Hub nodes with this token</li>
                </ul>
              </div>
            </div>
          ) : (
            <div>
              <Form.Group className="mb-3">
                <Form.Label>Application Name</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="e.g., Node-RED Production, Custom Dashboard, Analytics Tool"
                  value={newTokenName}
                  onChange={(e) => setNewTokenName(e.target.value)}
                  disabled={creating}
                />
                <Form.Text className="text-muted">
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
                <Form.Text className="text-muted">
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
                {creating ? <><Spinner animation="border" size="sm" /> Creating...</> : 'Create Application Token'}
              </Button>
            </>
          )}
        </Modal.Footer>
      </Modal>
    </>
  );
}
