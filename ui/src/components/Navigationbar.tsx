/**
 * Top navigation bar (no menu).
 *
 * Shows inline auth status and a Login/Logout button.
 */
import { Container, Nav, Navbar } from "react-bootstrap";
import logo from '../EdgeBerry_Logo_text.svg';
import { Link } from "react-router-dom";

const NavigationBar = (props:{user:any|null, onLoginClick?: ()=>void })=>{
    return(
        <>
            <Navbar sticky="top" bg={'dark'} data-bs-theme={'dark'}>
                <Container className="container-fluid" style={{paddingRight:'10px', paddingLeft:'10px'}}>
                    <Navbar.Brand as={Link} to='/'>
                        <img src={logo} alt="Edgeberry Device Hub" height={'32px'}/>
                    </Navbar.Brand>
                    <Nav className="d-flex align-items-center" style={{gap:'12px'}}>
                        {props.user ? (
                            <span style={{ color:'#cfe3ff', fontSize:'0.9rem' }}>
                                Signed in as <b>{props.user?.name || 'admin'}</b>
                            </span>
                        ) : (
                            <span style={{ color:'#cfe3ff', fontSize:'0.9rem', opacity: 0.9 }}>
                                Viewing as <b>anonymous</b>
                            </span>
                        )}
                        {props.user ? (
                          <>
                            <Link to='/logout' className='btn btn-sm btn-outline-light'>Logout</Link>
                            <Link to='/settings' className='btn btn-sm btn-outline-light' title='Settings'>
                              <i className="fa-solid fa-cog"></i>
                            </Link>
                          </>
                        ) : (
                          <button className='btn btn-sm btn-outline-light' onClick={props.onLoginClick}>Login</button>
                        )}
                    </Nav>
                </Container>
            </Navbar>
        </>
    );
}
export default NavigationBar;

