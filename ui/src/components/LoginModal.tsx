import React, { useState } from 'react';
import { Modal, Button, Form, Spinner } from 'react-bootstrap';
import logo from '../EdgeBerry_Logo_text.svg';

export default function LoginModal(props: { show: boolean; onClose: () => void; onLoggedIn: () => Promise<void>; }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string|null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e?: React.FormEvent){
    if (e) e.preventDefault();
    setError(null);
    setLoading(true);
    try{
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      if (res.ok){
        await props.onLoggedIn();
        props.onClose();
      } else {
        const d = await res.json().catch(()=>({}));
        setError(d.error || 'Invalid credentials');
      }
    }catch(err:any){ setError(err?.message || 'Login failed'); }
    finally { setLoading(false); }
  }

  return (
    <Modal show={props.show} onHide={props.onClose} centered>
      <Form onSubmit={submit}>
        <Modal.Header closeButton>
          <Modal.Title>
            <img src={logo} alt="Edgeberry" style={{height:24, marginRight:8}}/>
            Sign in
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group className="mb-2">
            <Form.Label>Username</Form.Label>
            <Form.Control value={username} onChange={e=>setUsername(e.target.value)} placeholder="admin" />
          </Form.Group>
          <Form.Group>
            <Form.Label>Password</Form.Label>
            <Form.Control value={password} onChange={e=>setPassword(e.target.value)} type='password' placeholder="••••••" />
          </Form.Group>
          <div style={{ color:'#b00020', fontSize:12, minHeight:16, marginTop:6 }}>{error}</div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={props.onClose} disabled={loading}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={loading}>
            {loading ? (<><Spinner size="sm" animation="border" className="me-2"/>Signing in...</>) : 'Sign in'}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
