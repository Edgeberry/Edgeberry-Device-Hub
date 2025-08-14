import { useEffect, useState } from "react";
import { Button, Col, Form, Row } from "react-bootstrap";
import NotificationBox from "../Notification";
import { direct_getConnectionParameters, direct_reconnect, direct_reprovision, direct_updateConnectionParameters } from "../../api/directMethods";
import CertificateControl from "../CertificateControl";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faRetweet } from "@fortawesome/free-solid-svg-icons";

const AssetConnection = ( props:{assetId:string|null})=>{
    const[ disabled, setDisabled ] = useState<boolean>(false);
    const[ message, setMessage ] = useState<string>('');
    const[ isError, setIsError ] = useState<boolean>(false);

    /* AWS IoT Core connection parameters */
    const[ hostname, setHostname ] = useState<string>('');
    const[ deviceId, setDeviceId ] = useState<string>('');
    // X.509 Certificate
    const[ cert, setCert ] = useState<string>('');
    const[ pKey, setPKey ] = useState<string>('');
    const[ rootca, setRootca ] = useState<string>('');

    useEffect(()=>{
        getConnectionParameters();
    },[props.assetId]);

    // Disappearing messages
    useEffect(()=>{
        if( message === '' ) return;
        setTimeout(()=>{
            setMessage('');
            setIsError(false);
        },3500);
    },[message]);

    // Get this user's AWS settings
    async function getConnectionParameters(){
        if( !props.assetId ) return;
        setDisabled(true);
        const result = await direct_getConnectionParameters( props.assetId );
        if(result.message){
            setIsError(true);
            setMessage(result.message);
        }
        else {
            // Set the parameters in the fields
            if( typeof(result.hostName) === 'string' ) setHostname(result.hostName);
            if( typeof(result.deviceId) === 'string' ) setDeviceId(result.deviceId);
            if( typeof(result.certificate) === 'string' ) setCert(result.certificate);
            if( typeof(result.privateKey) === 'string' ) setPKey(result.privateKey);
            if( typeof(result.rootCertificate) === 'string' ) setRootca(result.rootCertificate);
        }
        setDisabled(false);
    }
    
    // on submit, update connection parameters
    async function updateConnectionParameters(){
        setDisabled(true);

        const parameters = {
            hostName: hostname,
            deviceId: deviceId,
            certificate: cert,
            privateKey: pKey,
            rootCertificate: rootca
        }

        const result = await direct_updateConnectionParameters( deviceId, parameters );

        if(result.message !== 'success'){
            setIsError(true);
            setMessage(result.message);
        }
        else {
            setIsError(false);
            setMessage('Connection parameters succesfully updated!');
        }
        setDisabled(false);
    }

    // Request device reconnection to Fleet Hub
    async function requestReconnect(){
        // First update the connection parameters
        await updateConnectionParameters();
        // Then reconnect
        direct_reconnect(deviceId);
    }

    // Request device reprovisioning
    async function requestReprovision(){
        direct_reprovision(deviceId);
    }


    return (
        <>
            <div style={{float:'right'}}>
                <Button variant={'danger'} className="mb-2" onClick={()=>{requestReconnect()}} disabled={disabled}><FontAwesomeIcon icon={faRetweet}/> Reconnect</Button>&nbsp;
                {/*<Button variant={'danger'} className="mb-2" onClick={()=>{requestReprovision()}} disabled={disabled}><FontAwesomeIcon icon={faRetweet}/> Reprovision</Button>&nbsp; */}
            </div>

            <h2>Fleet Hub connection</h2>
            <p className="text-subtitle">The settings of the device's cloud connection.</p>
            
            <Form>
                <Form.Group as={Row} className="mb-2">
                    <Form.Label column sm={2}>Hostname</Form.Label>
                    <Col sm={6}>
                        <Form.Control type={'text'} placeholder={'Hostname'} value={hostname} onChange={(e)=>{setHostname(e.target.value)}} required spellCheck={false} disabled/>
                    </Col>
                </Form.Group>
                <Form.Group as={Row} className="mb-2">
                    <Form.Label column sm={2}>Device ID</Form.Label>
                    <Col sm={6}>
                        <Form.Control type={'text'} placeholder={'Device ID'} value={deviceId} onChange={(e)=>{setDeviceId(e.target.value)}} required spellCheck={false} disabled/>
                    </Col>
                </Form.Group>
                    <Form.Group as={Row} className="mb-2">
                        <Form.Label column sm={2}>Certificate</Form.Label>
                        <Col sm={6}>
                            <CertificateControl name={'Certificate'} value={cert} onChange={(e:any)=>{setCert(e.target.value)}} disabled={disabled}/>
                        </Col>
                    </Form.Group>
                    <Form.Group as={Row} className="mb-2">
                        <Form.Label column sm={2}>Private key</Form.Label>
                        <Col sm={6}>
                            <CertificateControl name={'Private Key'} value={pKey} onChange={(e:any)=>{setPKey(e.target.value)}} disabled={disabled}/>
                        </Col>
                    </Form.Group>
                    <Form.Group as={Row} className="mb-2">
                        <Form.Label column sm={2}>Root certificate</Form.Label>
                        <Col sm={6}>
                            <CertificateControl name={'Root Certificate'} value={rootca} onChange={(e:any)=>{setRootca(e.target.value)}} disabled={disabled}/>
                        </Col>
                    </Form.Group>
                <NotificationBox message={message} isError={isError} />
            </Form>
        </>
    );
}

export default AssetConnection;
