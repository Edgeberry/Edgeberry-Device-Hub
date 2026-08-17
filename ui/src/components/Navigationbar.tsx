/**
 * Top navigation bar.
 *
 * Login is required to see any Device Hub content at all (see Dashboard's
 * auth gate), so by the time this ever renders with `user` set, there is no
 * meaningful logged-out state to design for here - just a Logout link.
 */
import { Container, Navbar } from "react-bootstrap";
import { Link } from "react-router-dom";
import logo from '../EdgeBerry_Logo_text.svg';

const NavigationBar = (props:{user:any|null})=>{
    return(
        <Navbar sticky="top" data-bs-theme={'dark'} style={{ backgroundColor: 'var(--eb-navbar-bg)' }}>
            <Container className="container-fluid" style={{paddingRight:'10px', paddingLeft:'10px'}}>
                <Navbar.Brand as={Link} to='/'>
                    <img src={logo} alt="Edgeberry Device Hub" height={'32px'}/>
                </Navbar.Brand>
                {props.user && (
                    <Link className="d-flex align-items-center" to='/logout' style={{ gap: 8, color: 'var(--eb-navbar-fg)', textDecoration: 'none' }}>
                        <i className="fa-solid fa-right-from-bracket" style={{ fontSize: '1.1rem' }} />
                        <span style={{ fontSize: '0.9rem' }}>Logout</span>
                    </Link>
                )}
            </Container>
        </Navbar>
    );
}
export default NavigationBar;
