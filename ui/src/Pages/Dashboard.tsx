import { Container, Spinner } from 'react-bootstrap';
import { Outlet } from 'react-router-dom';
import NavigationBar from '../components/Navigationbar';
import LoginModal from '../components/LoginModal';

// Login is required to see anything here - there is no anonymous/scrubbed
// view of Device Hub data. While the initial /api/auth/me check is still in
// flight (`loading`), nothing renders rather than flashing the login gate at
// an already-authenticated visitor. Once resolved: signed in shows the real
// page (Outlet - Overview, Settings, Logout, whatever's routed), signed out
// shows the mandatory LoginModal over an empty content area.
export default function Dashboard(props:{user:any, loading:boolean, onLoggedIn: ()=>Promise<void>}){
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', width:'100vw', overflow:'hidden' }}>
      <NavigationBar user={props.user} />
      <div style={{ flex:1, minHeight:0, overflow:'auto' }}>
        {props.loading ? (
          <div className="text-center p-5"><Spinner animation="border" size="sm"/></div>
        ) : props.user ? (
          <Container style={{ paddingTop: 16, textAlign: 'left' }}>
            <Outlet />
          </Container>
        ) : null}
      </div>
      <footer style={{ padding: '12px 0', background: 'transparent', borderTop: '1px solid #e5e7eb' }}>
        <Container style={{ fontSize: '12px', color: '#555' }}>
          <p style={{ margin: 0 }}>
            <a
              href="https://github.com/Edgeberry"
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontWeight: 'bold', color: 'inherit', textDecoration: 'none' }}
            >
              Edgeberry Device Hub
            </a>{' '}is open-source software. Licensed under GPL-3.0-or-later. Consider
            {' '}<a
              href="https://github.com/sponsors/Edgeberry"
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontWeight: 'bold', color: 'inherit', textDecoration: 'none' }}
            >
              sponsoring the project
            </a>.
          </p>
        </Container>
      </footer>
      {!props.loading && !props.user && <LoginModal show onLoggedIn={props.onLoggedIn} />}
    </div>
  );
}
