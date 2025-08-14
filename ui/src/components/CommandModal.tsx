import { useEffect, useState } from "react";
import { Button, Form, Modal } from "react-bootstrap";
import NotificationBox from "./Notification";
import { api_things_invokeDirectMethod } from "../api/things";

const CommandModal = ( props:{ deviceId:string, show:boolean, onClose:Function })=>{
    // Direct Method
    const[ methodName, setMethodName ] = useState<string>('');
    const[ body, setBody ] = useState<string>('');
    // User feedback
    const[ message, setMessage ] = useState<string>('');
    const[ isError, setIsError ] = useState<boolean>(false);
    const[ disabled, setDisabled ] = useState<boolean>(false);

    // Disappearing messages
    const[ timeoutKeeper, setTimeoutKeeper ] = useState<ReturnType<typeof setTimeout>|null>(null);
    useEffect(()=>{
        if( message === '' ) return;
        if( timeoutKeeper ) clearTimeout( timeoutKeeper );
        setTimeoutKeeper(setTimeout(()=>{
            setMessage('');
            setIsError(false);
        },3500));
    },[message]);

    // Send the message
    async function sendMessage(){
        setDisabled(true);
        setIsError(false);
        setMessage("Executing command...");

        const result = await api_things_invokeDirectMethod( props.deviceId, methodName, body );
        if( result.message ){
            setDisabled(false);
            setIsError(true);
            setMessage(result.message);
        }
        else{
            setDisabled(false);
            setIsError(false);
            setMessage(JSON.stringify(result.payload));
        }
    }

    return(<>
            <Modal size={'lg'} onHide={()=>{props.onClose()}} show={props.show} >
                <Modal.Header closeButton>
                    <Modal.Title>Command</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form>
                        <Form.Group className="mb-2">
                            <Form.Label>Device ID</Form.Label>
                            <Form.Control type={'text'} placeholder={'Device ID'} value={props.deviceId} disabled/>
                        </Form.Group>
                        <Form.Group className="mb-2">
                            <Form.Label>Command name</Form.Label>
                            <Form.Control type={'text'} placeholder={'Command name'} value={methodName} onChange={(e)=>{setMethodName(e.target.value)}} spellCheck={false} disabled={disabled}/>
                        </Form.Group>
                        <Form.Group className="mb-2">
                            <Form.Label>Command body</Form.Label>
                            <Form.Control as={'textarea'} rows={5} placeholder={'Command body'} value={body} onChange={(e)=>{setBody(e.target.value)}} spellCheck={false} disabled={disabled}/>
                        </Form.Group>
                        {/*
                        <Row className="mb-2">
                        <Col sm={6}>
                            <Form.Control type={'text'} placeholder={'Key'} value={''} onChange={(e)=>{}}/>
                        </Col>
                        <Col sm={6}>
                            <Form.Control type={'text'} placeholder={'Value'} value={''} onChange={(e)=>{}}/>
                        </Col>
                        </Row>*/}
                    </Form>
                    <NotificationBox message={message} isError={isError} />
                </Modal.Body>
                <Modal.Footer>
                    <Button variant={'danger'} onClick={()=>{sendMessage()}}>Execute command</Button>
                </Modal.Footer>
            </Modal>
        </>);
}

export default CommandModal;