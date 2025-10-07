/**
 * Token Management Widget
 * 
 * Displays and manages API tokens for external application access
 * Used on the main dashboard for quick access to token management
 */
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Form, Modal, Spinner, Table } from 'react-bootstrap';

type ApiToken = {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
  expires_at?: string;
  last_used?: string;
};

export default function TokenManagementWidget(props: { user: any | null }) {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  
  // Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenExpiry, setNewTokenExpiry] = useState('');
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

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

  useEffect(() => {
    if (props.user) {
      loadTokens();
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
        await loadTokens();
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
    if (!confirm(`Delete token "${token.name}"? This action cannot be undone.`)) return;
    
    try {
      const resp = await fetch(`/api/tokens/${token.id}`, { method: 'DELETE' });
      if (resp.ok) {
        await loadTokens();
      } else {
        setError('Failed to delete token');
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to delete token');
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
        await loadTokens();
      } else {
        setError('Failed to update token status');
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to update token');
    }
  }

  if (!props.user) {
    return null;
  }

  return (
    <>
      <Card className="mb-3">
        <Card.Header className="d-flex justify-content-between align-items-center">
          <div>
            <i className="fa-solid fa-key me-2"></i>
            API Tokens
            <small className="text-muted ms-2">
              ({tokens.filter(t => t.active).length} active)
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
              <i className="fa fa-plus"></i> New Token
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
              No API tokens configured.
              {isAdmin && ' Click "New Token" to create one.'}
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm mb-0">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Expires</th>
                    <th>Last Used</th>
                    {isAdmin && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((token) => {
                    const isExpired = token.expires_at && new Date(token.expires_at) < new Date();
                    return (
                      <tr key={token.id}>
                        <td className="align-middle">{token.name}</td>
                        <td className="align-middle">
                          <Badge bg={!token.active ? 'secondary' : isExpired ? 'danger' : 'success'}>
                            {!token.active ? 'Inactive' : isExpired ? 'Expired' : 'Active'}
                          </Badge>
                        </td>
                        <td className="align-middle">
                          {new Date(token.created_at).toLocaleDateString()}
                        </td>
                        <td className="align-middle">
                          {token.expires_at ? (
                            isExpired ? (
                              <span className="text-danger">Expired</span>
                            ) : (
                              new Date(token.expires_at).toLocaleDateString()
                            )
                          ) : (
                            'Never'
                          )}
                        </td>
                        <td className="align-middle">
                          {token.last_used ? new Date(token.last_used).toLocaleDateString() : 'Never'}
                        </td>
                        {isAdmin && (
                          <td className="align-middle">
                            <Button
                              size="sm"
                              variant={token.active ? 'outline-warning' : 'outline-success'}
                              className="me-1"
                              onClick={() => toggleTokenStatus(token)}
                            >
                              {token.active ? 'Disable' : 'Enable'}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline-danger"
                              onClick={() => deleteToken(token)}
                            >
                              Delete
                            </Button>
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
              Contact an administrator to manage API tokens.
            </div>
          )}
        </Card.Body>
      </Card>

      {/* Create Token Modal */}
      <Modal show={showCreateModal} onHide={() => !creating && setShowCreateModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Create API Token</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {generatedToken ? (
            <div>
              <Alert variant="success">
                <Alert.Heading>Token Created Successfully!</Alert.Heading>
                <p>Copy this token now. You won't be able to see it again.</p>
              </Alert>
              <Form.Group>
                <Form.Label>Your API Token:</Form.Label>
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
                <strong>Integration Examples:</strong>
                <ul className="small">
                  <li>Node-RED: Configure in HTTP request nodes</li>
                  <li>curl: <code>-H "Authorization: Bearer TOKEN"</code></li>
                  <li>WebSocket: Send in connection params</li>
                </ul>
              </div>
            </div>
          ) : (
            <div>
              <Form.Group className="mb-3">
                <Form.Label>Token Name</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="e.g., Node-RED Integration"
                  value={newTokenName}
                  onChange={(e) => setNewTokenName(e.target.value)}
                  disabled={creating}
                />
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
                {creating ? <><Spinner animation="border" size="sm" /> Creating...</> : 'Create Token'}
              </Button>
            </>
          )}
        </Modal.Footer>
      </Modal>
    </>
  );
}
