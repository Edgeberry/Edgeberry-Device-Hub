/**
 * Top navigation bar and off-canvas menu.
 *
 * Shows inline auth status ("Signed in as ...") and conditionally renders
 * admin-only links (Settings, Logout) when a `user` is present.
 */
import { Button, Container, ListGroup, Nav, Navbar, Offcanvas } from "react-bootstrap";
import logo from '../EdgeBerry_Logo_text.svg';
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBars, faCogs, faGear, faGauge, faSignOutAlt } from "@fortawesome/free-solid-svg-icons";
import { useState } from "react";
import { Link } from "react-router-dom";

const NavigationBar = (props:{user:any|null})=>{
    const[ show, setShow ] = useState<boolean>(false);
    return(
        <>
            <Navbar sticky="top" bg={'dark'} data-bs-theme={'dark'}>
                <Container className="container-fluid" style={{paddingRight:'10px', paddingLeft:'10px'}}>
                    <Navbar.Brand as={Link} to='/'>
                        <img src={logo} alt="Edgeberry Fleet Hub" height={'32px'}/>
                    </Navbar.Brand>
                    <Nav className="d-flex align-items-center" style={{gap:'12px'}}>
                        {props.user ? (
                            <span style={{ color:'#cfe3ff', fontSize:'0.9rem' }}>
                                Signed in as <b>{props.user?.name || 'admin'}</b>
                            </span>
                        ) : null}
                        <Button variant={'transparent'} className="btn-outline-light" onClick={()=>{setShow(true)}}><FontAwesomeIcon icon={faBars}/></Button>
                    </Nav>
                </Container>
            </Navbar>
            <Offcanvas show={show} onHide={()=>{setShow(false)}} placement={'end'} style={{maxWidth:'300px'}}>
                <Offcanvas.Header closeButton>
                    <Offcanvas.Title>Menu</Offcanvas.Title>
                </Offcanvas.Header>
                <Offcanvas.Body style={{padding:'0px'}}>
                    <ListGroup>
                        <ListGroup.Item as={Link} to='/' onClick={()=>{setShow(false)}}>
                            <FontAwesomeIcon icon={faGauge} /> Overview
                        </ListGroup.Item>
                        <ListGroup.Item as={Link} to='/health' onClick={()=>{setShow(false)}}>
                            <FontAwesomeIcon icon={faGear} /> Health
                        </ListGroup.Item>
                        {props.user? <>
                            <ListGroup.Item as={Link} to='/settings' onClick={()=>{setShow(false)}}>
                                <FontAwesomeIcon icon={faCogs} /> Settings
                            </ListGroup.Item>
                            <ListGroup.Item as={Link} to='/logout' onClick={()=>{setShow(false)}}>
                                <FontAwesomeIcon icon={faSignOutAlt} /> Log out
                            </ListGroup.Item>
                            {/* Admin features are integrated across pages; no dedicated page/link */}
                        </> : <>
                            <ListGroup.Item as={Link} to='/login' onClick={()=>{setShow(false)}}>
                                Login
                            </ListGroup.Item>
                        </>}
                    </ListGroup>
                    <Container className="container-bottom" style={{fontSize:'12px'}}>
                        <hr/>
                        <p>Edgeberry Fleet Hub is open-source software.</p>
                    </Container>
                </Offcanvas.Body>
            </Offcanvas>
        </>
    );
}
export default NavigationBar;
