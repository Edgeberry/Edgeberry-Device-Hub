import { Container, Spinner } from 'react-bootstrap';
import { Outlet } from 'react-router-dom';
import NavigationBar from '../components/Navigationbar';
import LoginPanel from '../components/LoginPanel';

// Login is required to see anything here - there is no anonymous/scrubbed
// view of Device Hub data. While the initial /api/auth/me check is still in
// flight (`loading`), nothing renders rather than flashing the login gate at
// an already-authenticated visitor. Once resolved: signed in shows the real
// page (Outlet - Overview, Settings, Logout, whatever's routed), signed out
// shows the sign-in panel in the same content area. The panel is the page,
// not a dialog over it - the chrome around it (navbar, footer) stays live
// rather than being dimmed behind a backdrop.
export default function Dashboard(props:{user:any, loading:boolean, onLoggedIn: ()=>Promise<void>}){
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', width:'100vw', overflow:'hidden' }}>
      <NavigationBar user={props.user} />
      <div style={{ flex:1, minHeight:0, overflow:'auto' }}>
        {props.loading ? (
          <div className="text-center p-5"><Spinner animation="border" size="sm"/></div>
        ) : (
          <Container style={{ paddingTop: 24, paddingBottom: 24, textAlign: 'left' }}>
            {props.user ? <Outlet /> : <LoginPanel onLoggedIn={props.onLoggedIn} />}
          </Container>
        )}
      </div>
      <footer style={{ padding: '12px 0', background: 'transparent', borderTop: '1px solid var(--eb-line)' }}>
        <Container style={{ fontSize: '12px', color: 'var(--eb-fg-muted)' }}>
          <p style={{ margin: 0 }}>
            <a
              href="https://github.com/Edgeberry"
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontWeight: 700, color: 'var(--eb-fg)', textDecoration: 'none' }}
            >
              Edgeberry Device Hub
            </a>{' '}is open-source software. Licensed under AGPL-3.0-or-later. Consider
            {' '}<a
              href="https://github.com/sponsors/Edgeberry"
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontWeight: 700, color: 'var(--eb-fg)', textDecoration: 'none' }}
            >
              sponsoring the project
            </a>.
          </p>
        </Container>
      </footer>
    </div>
  );
}
