/**
 * Top navigation bar.
 *
 * Anonymous visitors get a single Login affordance. Authenticated admins get
 * an account icon that opens a portal dropdown (who's signed in, Settings,
 * Logout) instead of a row of separate buttons - the same compact-icon +
 * dropdown convention Edgeberry-device-software's navbar uses for its own
 * menus (see PortalMenu in components/ui.tsx).
 */
import { Container, Navbar } from "react-bootstrap";
import { Link } from "react-router-dom";
import logo from '../EdgeBerry_Logo_text.svg';
import { PortalMenu } from './ui';

const NavigationBar = (props:{user:any|null, onLoginClick?: ()=>void })=>{
    return(
        <Navbar sticky="top" data-bs-theme={'dark'} style={{ backgroundColor: 'var(--eb-navbar-bg)' }}>
            <Container className="container-fluid" style={{paddingRight:'10px', paddingLeft:'10px'}}>
                <Navbar.Brand as={Link} to='/'>
                    <img src={logo} alt="Edgeberry Device Hub" height={'32px'}/>
                </Navbar.Brand>
                <div className="d-flex align-items-center" style={{gap:'8px'}}>
                    {props.user ? (
                        <PortalMenu
                            title="Account"
                            trigger={
                                <span className="d-flex align-items-center" style={{ gap: 8, color: 'var(--eb-navbar-fg)' }}>
                                    <i className="fa-solid fa-circle-user" style={{ fontSize: '1.1rem' }} />
                                    <span style={{ fontSize: '0.9rem' }}>{props.user?.name || 'admin'}</span>
                                </span>
                            }
                        >
                            {close => (
                                <>
                                    <li>
                                        <Link className="dropdown-item d-flex align-items-center gap-2" to='/settings' onClick={close}>
                                            <i className="fa-solid fa-gear fa-fw" />Settings
                                        </Link>
                                    </li>
                                    <li>
                                        <Link className="dropdown-item d-flex align-items-center gap-2" to='/logout' onClick={close}>
                                            <i className="fa-solid fa-right-from-bracket fa-fw" />Logout
                                        </Link>
                                    </li>
                                </>
                            )}
                        </PortalMenu>
                    ) : (
                        <>
                            <span style={{ color:'var(--eb-navbar-fg)', fontSize:'0.9rem', opacity: 0.9 }}>
                                Viewing as <b>anonymous</b>
                            </span>
                            <button className='btn btn-sm btn-outline-light' onClick={props.onLoginClick}>Login</button>
                        </>
                    )}
                </div>
            </Container>
        </Navbar>
    );
}
export default NavigationBar;
