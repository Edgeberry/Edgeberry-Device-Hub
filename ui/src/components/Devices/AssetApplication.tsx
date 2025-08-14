import { useEffect, useState } from "react";
import { Alert, Button, Col, Container, Form, Row } from "react-bootstrap";
import NotificationBox from "../Notification";
import { direct_getApplicationInfo, direct_restartApplication, direct_stopApplication } from "../../api/directMethods";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faWarning } from "@fortawesome/free-solid-svg-icons";

const AssetApplication = (props:{assetId:string})=>{
    const[ disabled, setDisabled ] = useState<boolean>(false);
    // Error or success messages
    const[ message, setMessage ] = useState<string>('');
    const[ isError, setIsError ] = useState<boolean>(false);

    const[ appName, setAppName ] = useState<string>('');
    // Application info
    const[ appVersion, setAppVersion ] = useState<string>('');
    const[ appDescription, setAppDescription ] = useState<string>('');

    useEffect(()=>{
        getApplicationInfo();
    },[]);

    // Disappearing messages
    useEffect(()=>{
        if( message === '' ) return;
        setTimeout(()=>{
            setMessage('');
            setIsError(false);
        },3500);
    },[message]);

    // Start the application
    async function restartApplication(){
        // Check if user is sure about this action
        if( !window.confirm("Restart the application?") ) return;
        setDisabled(true);

        const result = await direct_restartApplication( props.assetId );
        if( result.message ){
            setIsError(true);
            setMessage(result.message);
        }
        else{
            setIsError(false);
            setMessage(result.message);
        }
        setDisabled(false);
        // TODO: make event-driven
        setTimeout(getApplicationInfo,500);
        return;
    }

    // Stop the application
    async function stopApplication(){
        // Check if user is sure about this action
        if( !window.confirm("Stop the application?") ) return;
        setDisabled(true);
        
        const result = await direct_stopApplication( props.assetId );
        if( result.message ){
            setIsError(true);
            setMessage(result.message);
        }
        else{
            setIsError(false);
            setMessage(result.message);
        }
        setDisabled(false);
        // TODO: make event-driven
        setTimeout(getApplicationInfo,500);
        
        return;
    }

    // Get the application info
    async function getApplicationInfo(){
        const result = await direct_getApplicationInfo( props.assetId );
        if( result.message ){
            setIsError(true);
            setMessage(result.message);
        }
        if( typeof(result.name) === 'string' ) setAppName(result.name);
        if( typeof(result.version) === 'string' ) setAppVersion(result.version);
        if( typeof(result.description) === 'string' ) setAppDescription(result.description);
        return;
    }

    return(
        <Container>
            {appName?<>
            <div style={{float:'right'}}>
                <Button variant={'danger'} onClick={()=>{restartApplication()}} disabled>Restart</Button>&nbsp;
                <Button variant={'danger'} onClick={()=>{stopApplication()}} disabled>Stop</Button>
            </div>
            <h2>Application</h2>
                <Form.Group as={Row} className="mb-2">
                    <Form.Label column sm={2}>Application name</Form.Label>
                    <Col sm={6}>
                        <Form.Control type={'text'} placeholder={'Application name'} value={appName} disabled/>
                    </Col>
                </Form.Group>
                <Form.Group as={Row} className="mb-2">
                    <Form.Label column sm={2}>Description</Form.Label>
                    <Col sm={6}>
                        <Form.Control type={'text'} placeholder={'Description'} value={appDescription} disabled/>
                    </Col>
                </Form.Group>
                <Form.Group as={Row} className="mb-2">
                    <Form.Label column sm={2}>Version</Form.Label>
                    <Col sm={6}>
                        <Form.Control type={'text'} placeholder={'Version'} value={appVersion} disabled/>
                    </Col>
                </Form.Group>
                <Form.Group as={Row} className="mb-2">
                    <Form.Label column sm={2}></Form.Label>
                    <Col sm={6}>
                        <Button variant={'danger'} disabled>Update</Button>
                    </Col>
                </Form.Group>
            </>:<Alert variant={'warning'}><FontAwesomeIcon icon={faWarning}/> <strong>No application</strong> is registered to the Edgeberry service.</Alert>}
            <NotificationBox message={message} isError={isError} />
        </Container>
    );
}

export default AssetApplication;