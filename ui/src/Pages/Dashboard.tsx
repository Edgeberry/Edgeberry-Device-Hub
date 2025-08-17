import { useState } from 'react';
import { Container } from 'react-bootstrap';
import { Outlet } from 'react-router-dom';
import NavigationBar from '../components/Navigationbar';
import LoginModal from '../components/LoginModal';

export default function Dashboard(props:{user:any, onLoggedIn: ()=>Promise<void>}){
  const [showLogin, setShowLogin] = useState(false);
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', width:'100vw', overflow:'hidden' }}>
      <NavigationBar user={props.user} onLoginClick={()=> setShowLogin(true)} />
      <div style={{ flex:1, minHeight:0, overflow:'auto' }}>
        <Container style={{ paddingTop: 16, textAlign: 'left' }}>
          <Outlet />
        </Container>
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
      <LoginModal show={showLogin} onClose={()=> setShowLogin(false)} onLoggedIn={props.onLoggedIn} />
    </div>
  );
}
