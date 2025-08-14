import { SyntheticEvent, useEffect, useState } from "react";
import { Button, Col, Form, Modal, Row } from "react-bootstrap";
import NotificationBox from "../Notification";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMicrochip } from "@fortawesome/free-solid-svg-icons";
import { api_admin_onboardDevice } from "../../api/admin";

const AdminDeviceOnboardingModal = ( props:{ show:boolean, onClose:Function })=>{
    const[ disabled, setDisabled ] = useState<boolean>(false);
    // Error or success messages
    const[ message, setMessage ] = useState<string>('');
    const[ isError, setIsError ] = useState<boolean>(false);
    // Fields
    const[ deviceId, setDeviceId ] = useState<string>('');
    const[ hardwareVersion, setHardwareVersion ] = useState<string>('');
    const[ batchNumber, setBatchNumber ] = useState<string>('');

    // Disappearing messages
    useEffect(()=>{
        if( message === '' ) return;
        setTimeout(()=>{
            setMessage('');
            setIsError(false);
        },3500);
    },[message]);

    // Submit: onboard new device
    async function onboardDevice(e:SyntheticEvent){
        e.preventDefault();   // prevents page refresh
        setDisabled(true);

        const result = await api_admin_onboardDevice( deviceId, hardwareVersion, batchNumber);

        if( result.message !== 'success'){
            setDisabled(false);
            setIsError(true);
            setMessage(result.message);
            return;
        }
        setDisabled(false);
        setIsError(false);
        setMessage("Device onboarding was successful!");
        return;
    }

   
    return(<>
            <Modal size={'lg'} onHide={()=>{props.onClose()}} show={props.show} >
                <Modal.Header closeButton>
                    <Modal.Title><FontAwesomeIcon icon={faMicrochip}/> Onboard a new device</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form onSubmit={onboardDevice}>
                        <Form.Group as={Row} className="mb-2">
                            <Form.Label column sm={4}>Device UUID</Form.Label>
                            <Col sm={6}>
                                <Form.Control type={'text'} placeholder={'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'} value={deviceId} onChange={(e)=>{setDeviceId(e.target.value)}} required disabled={disabled}/>
                            </Col>
                        </Form.Group>
                        <Form.Group as={Row} className="mb-2">
                            <Form.Label column sm={4}>Hardware version</Form.Label>
                            <Col sm={6}>
                                <Form.Control type={'text'} placeholder={'e.g. 1.6'} value={hardwareVersion} onChange={(e)=>{setHardwareVersion(e.target.value)}} required disabled={disabled}/>
                            </Col>
                        </Form.Group>
                        <Form.Group as={Row} className="mb-2">
                            <Form.Label column sm={4}>Batch number</Form.Label>
                            <Col sm={6}>
                                <Form.Control type={'text'} placeholder={'e.g. 1428420'} value={batchNumber} onChange={(e)=>{setBatchNumber(e.target.value)}} required disabled={disabled}/>
                            </Col>
                        </Form.Group>
                        <hr/>
                        <NotificationBox message={message} isError={isError} />
                        <Button variant={'danger'} className="mb-2" onClick={()=>{props.onClose()}} disabled={disabled}>Cancel</Button>
                        <Button variant={'primary'} style={{float:'right'}} className="mb-2" type="submit" disabled={disabled}>Onboard</Button>
                    </Form>
                </Modal.Body>
            </Modal>
        </>);
}

export default AdminDeviceOnboardingModal;