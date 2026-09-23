/**
 * Sign-in panel.
 *
 * Login is required to see any Device Hub content (see Dashboard's auth
 * gate), so this is not a dialog interrupting something - it IS the page
 * until there is a session. It used to be a Modal with `backdrop="static"`,
 * `keyboard={false}` and no close button: a dialog with every dismissal route
 * disabled, dimming an empty page behind it. The backdrop had nothing to
 * recede, and the greyed-out navbar and footer read as broken rather than
 * inactive.
 */
import React, { useState } from 'react';
import { Alert, Button, Form, Spinner } from 'react-bootstrap';

export default function LoginPanel(props: { onLoggedIn: () => Promise<void> }) {
  // Empty: the field used to arrive pre-filled with "admin", which told
  // anyone who reached this screen what the account is called. The hub's
  // default really is `admin` (see ADMIN_USER in src/config.ts), so the box
  // was doing half the guessing for them. The placeholder below names the
  // kind of account rather than the account.
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      if (res.ok) {
        await props.onLoggedIn();
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error || 'Invalid credentials');
      }
    } catch (err: any) {
      setError(err?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="d-flex justify-content-center" style={{ paddingTop: '10vh' }}>
      <div className="card" style={{ width: '100%', maxWidth: 360 }}>
        <div className="card-body" style={{ padding: '1.5rem' }}>
          {/* Nothing above the fields.
              No logo: the navbar already carries the wordmark and names the
              product. No visible heading or blurb either - two labelled
              fields under a full-width "Sign in" button say what this is
              without narrating it.
              The heading stays in the markup for assistive tech, which has no
              button to look at when navigating by headings. */}
          <h1 className="visually-hidden">Sign in to Edgeberry Device Hub</h1>

          <Form onSubmit={submit}>
            <Form.Group className="mb-3">
              <Form.Label htmlFor="eb-login-user">Username</Form.Label>
              <Form.Control
                id="eb-login-user"
                autoComplete="username"
                placeholder="Administrator"
                autoFocus
                value={username}
                onChange={e => setUsername(e.target.value)}
                disabled={loading}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label htmlFor="eb-login-pass">Password</Form.Label>
              {/* Dots rather than a word: a password field's placeholder is
                  the one case where the masking character is the clearest
                  thing to show, and it cannot leak anything about the value. */}
              <Form.Control
                id="eb-login-pass"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••••••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={loading}
              />
            </Form.Group>

            {error && <Alert variant="danger" className="py-2 mb-3" style={{ fontSize: '0.85rem' }}>{error}</Alert>}

            {/* Not disabled on an empty password: the first thing you see
                would be a greyed-out primary button, which reads as "this
                page is broken" rather than "type something". The server
                rejects empty credentials anyway. */}
            <Button type="submit" variant="primary" className="w-100" disabled={loading}>
              {loading
                ? <><Spinner animation="border" size="sm" className="me-2" />Signing in…</>
                : 'Sign in'}
            </Button>
          </Form>
        </div>
      </div>
    </div>
  );
}
