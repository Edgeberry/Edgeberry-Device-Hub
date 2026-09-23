/**
 * Top navigation bar.
 *
 * Login is required to see any Device Hub content at all (see Dashboard's
 * auth gate), so by the time this ever renders with `user` set, there is no
 * meaningful logged-out state to design for here - just a Logout link.
 */
import { useEffect, useState } from "react";
import { Container, Navbar } from "react-bootstrap";
import { Link } from "react-router-dom";
import logo from '../EdgeBerry_Logo_text.svg';
import { getVersion } from '../api/devicehub';

const NavigationBar = (props:{user:any|null})=>{
    // /api/version is behind the auth gate, so this only resolves once signed
    // in; until then the wordmark carries the product name without a build.
    const [version, setVersion] = useState<string>('');
    useEffect(()=>{
        if(!props.user){ setVersion(''); return; }
        let cancelled = false;
        (async()=>{
            try{
                const v: any = await getVersion();
                const val = typeof v?.version === 'string' ? v.version : '';
                if(!cancelled && val && val !== 'unknown') setVersion(val);
            }catch{ /* the build number is decorative; never block the bar on it */ }
        })();
        return ()=>{ cancelled = true; };
    },[props.user]);

    return(
        <Navbar sticky="top" data-bs-theme={'dark'} style={{ backgroundColor: 'var(--eb-navbar-bg)' }}>
            <Container className="container-fluid" style={{paddingRight:'10px', paddingLeft:'10px'}}>
                {/* Wordmark with the product ranged right beneath it, as the
                    Edgeberry banner artwork sets it. */}
                <Navbar.Brand as={Link} to='/' className="d-flex flex-column align-items-end py-0">
                    <img src={logo} alt="Edgeberry" height={'30px'}/>
                    <span className="eb-brand-subtext">
                        Device Hub{version && ` v${version}`}
                    </span>
                </Navbar.Brand>
                {props.user && (
                    <Link
                        className="eb-navbar-action"
                        to='/logout'
                        title="Log out"
                        aria-label="Log out"
                    >
                        <i className="fa-solid fa-right-from-bracket" aria-hidden="true" />
                    </Link>
                )}
            </Container>
        </Navbar>
    );
}
export default NavigationBar;
