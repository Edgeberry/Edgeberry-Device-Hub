import { useEffect, useState } from "react";
import { Alert, Button, Col, Form, Row } from "react-bootstrap";
import NotificationBox from "../Notification";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMicrochip, faWarning } from "@fortawesome/free-solid-svg-icons";
import CertificateControl from "../CertificateControl";
import { api_dashboard_provisioningParameters } from "../../api/dashboard";

const SettingsDevices = (props:{user:any|null})=>{
    // Notificaton
    const[ message, setMessage ] = useState<string>('');
    const[ isError, setIsError ] = useState<boolean>(false);
    // Parameters
    const[ hostname, setHostname ] = useState<string>('');
    const[ cert, setCert ] = useState<string>('');
    const[ key, setKey ] = useState<string>('');

    useEffect(()=>{
        getDashboardProvisioningParameters();
    },[]);

    // Disappearing messages
    useEffect(()=>{
        if( message === '' ) return;
        setTimeout(()=>{
            setMessage('');
            setIsError(false);
        },3500);
    },[message]);

    // Get the provisioning parameters for the
    // Edgeberry Fleet Hub connection
    async function getDashboardProvisioningParameters(){
        const result = await api_dashboard_provisioningParameters();
        if( result.message ){
            setIsError(true);
            setMessage( result.message );
            return;
        }
        if( typeof(result.endpoint) === 'string' ) setHostname( result.endpoint );
        if( typeof(result.certificate) === 'string') setCert( result.certificate );
        if( typeof(result.privateKey) === 'string') setKey( result.privateKey );
    }

    return (
        <>
            <h2><FontAwesomeIcon icon={faMicrochip}/> Devices</h2>
            <p className="text-subtitle">Edgeberry device configuration settings for connecting to the Edgeberry Fleet Hub</p>

            {/* Device provisioning certificate and private key. The user can copy/paste or download the device
                provisioning information for connecting to the official Edgeberry Fleet Hub here.*/}
            <h3>Device Provisioning</h3>
            <Alert variant={'danger'}><FontAwesomeIcon icon={faWarning}/> <strong>This is private information</strong>. Never share 
            this information with untrusted sources for the security of your connected devices and the security of the Edgeberry 
            Fleet Hub platform.</Alert>
            <Form>
                <Form.Group as={Row} className="mb-2">
                    <Form.Label column sm={2}>Hostname</Form.Label>
                    <Col sm={6}>
                        <Form.Control type={'text'} placeholder="a11fkxltf4r89e-ats.iot.eu-north-1.amazonaws.com" value={hostname} disabled/>
                    </Col>
                </Form.Group>
                <Form.Group as={Row} className="mb-2">
                    <Form.Label column sm={2}>Provisioning certificate</Form.Label>
                    <Col sm={6}>
                        <CertificateControl name={'Provisioning Certificate'} value={cert} onChange={(e:any)=>{setCert(e.target.value)}} disabled/>
                    </Col>
                </Form.Group>
                <Form.Group as={Row} className="mb-2">
                    <Form.Label column sm={2}>Provisioning private key</Form.Label>
                    <Col sm={6}>
                        <CertificateControl name={'Provisioning Private Key'} value={key} onChange={(e:any)=>{setKey(e.target.value)}} disabled/>
                    </Col>
                </Form.Group>
                <Form.Group as={Row} className="mb-2">
                    <Form.Label column sm={2}></Form.Label>
                    <Col sm={6}>
                        <Button variant={'primary'}>Download</Button>
                    </Col>
                </Form.Group>
                <NotificationBox message={message} isError={isError} />
            </Form>
        </>
    );
}

export default SettingsDevices;
