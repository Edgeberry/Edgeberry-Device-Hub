import { useState } from "react";
import { Alert, Button, Carousel, Form, FormGroup, Modal } from "react-bootstrap";
import { faInfoCircle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { api_things_claim } from "../../api/things";
import LoaderOverlay from "../LoadingOverlay";
import NotificationBox from "../Notification";

const AssetAddNewModal = ( props:{ show:boolean, onClose:Function, onChange?:Function })=>{
    // device ID
    const[ deviceId, setDeviceId ] = useState<string>('');
    // Loading overlay
    const[ loading, setLoading ] = useState<boolean>(false);
    const[ text, setText ] = useState<string>('');
    // Finish message
    const[ message, setMessage ] = useState('');
    const[ isError, setIsError ] = useState(false);
    // Carousel index
    const [index, setIndex] = useState(0);

    // Claim the device
    // When the device is successfully claimed by the user,
    // the return message is 'success'.
    async function claimDevice(){
        setText('Claiming...');
        setLoading(true);
        const result = await api_things_claim(deviceId);
        if( result.message !== 'success' ){
            setIsError(true);
            setMessage('Failed to claim this device. '+result.message);
            setText('');
            setLoading(false);
            return;
        }
        if(typeof props.onChange === 'function') props.onChange();
        setIsError(false);
        setMessage('The device was successfully claimed!');
        setText('');
        setLoading(false);
        return;
    }

    // When the modal is closed,
    // Reset everything.
    function onClose(){
        props.onClose();
        setDeviceId('');
        setIsError(false);
        setMessage('');
        setLoading(false);
        setText('');
        setIndex(0);
    }

    return(<>
            <Modal onHide={()=>{onClose()}} show={props.show} >
                <LoaderOverlay hidden={!loading} spinner text={text} />
                <Modal.Body style={{minHeight:'250px'}}>
                <Carousel controls={false} indicators={false} interval={null} activeIndex={index} slide={false}>
                    <Carousel.Item style={{minHeight:'250px'}}>
                        <Form onSubmit={(e)=>{e.preventDefault(); setIndex(index+1)}}>
                            <Alert variant={'primary'}>
                                <FontAwesomeIcon icon={faInfoCircle} /> <strong>Make sure your device is connected to the internet</strong>,
                                and you have physical access to the device.
                            </Alert>
                            <FormGroup className="mb-2">
                                <Form.Label>Enter the device serial number</Form.Label>
                                <Form.Control type="text" value={deviceId} onChange={(e)=>{setDeviceId(e.target.value)}} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" minLength={36}></Form.Control>
                            </FormGroup>
                            <div style={{width:'100%', textAlign:'right', position:'absolute', bottom:'0' }}>
                                <Button variant={'danger'} type={'submit'}>Next</Button>
                                <Button variant={'danger'} onClick={()=>{onClose()}} style={{float:'left'}}>Cancel</Button>
                            </div>
                        </Form>
                    </Carousel.Item>
                    <Carousel.Item style={{minHeight:'250px'}}>
                            <Alert variant={'primary'}>
                                <FontAwesomeIcon icon={faInfoCircle} /> <strong>Make sure you have physical access to the device</strong>. In the next step 
                                you will have <strong>10 seconds</strong> to press the button on the front of your Edgeberry device once the 
                                status indicator flashed green.
                            </Alert>
                            <div style={{width:'100%', textAlign:'right', position:'absolute', bottom:'0' }}>
                                <Button variant={'danger'} onClick={()=>{setIndex(index+1); claimDevice();}}>Next</Button>
                                <Button variant={'danger'} onClick={()=>{setIndex(index-1)}} style={{float:'left'}}>Back</Button>
                            </div>
                    </Carousel.Item>    
                    <Carousel.Item style={{minHeight:'250px'}}>
                        <NotificationBox message={message} isError={isError}/>
                            <div style={{width:'100%', textAlign:'right', position:'absolute', bottom:'0' }}>
                                <Button variant={'danger'} onClick={()=>{onClose()}}>Finish</Button>
                                <Button variant={'danger'} onClick={()=>{setIndex(index-1)}} style={{float:'left'}}>Back</Button>
                            </div>
                    </Carousel.Item>
                    </Carousel>
                </Modal.Body>
            </Modal>
        </>);
}

export default AssetAddNewModal;