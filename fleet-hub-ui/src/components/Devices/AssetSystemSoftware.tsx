import { useEffect, useState } from "react";
import { Button, Col, Form, Row } from "react-bootstrap";
import NotificationBox from "../Notification";
import { direct_getSystemApplicationInfo, direct_updateSystemApplication } from "../../api/directMethods";

const AssetSystemSoftware = (props:{assetId:string, assetShadow:any })=>{
    const[ disabled, setDisabled ] = useState<boolean>(false);
    // Error or success messages
    const[ message, setMessage ] = useState<string>('');
    const[ isError, setIsError ] = useState<boolean>(false);

    // System application info
    const[ appVersion, setAppVersion ] = useState<string>('');
    const[ cpuUsage, setCpuUsage ] = useState<string>('');
    const[ memUsage, setMemUsage ] = useState<string>('');
    const[ appStatus, setAppStatus ] = useState<string>('');

    useEffect(()=>{
        getSystemApplicationInfo();
    },[])

    // Disappearing messages
    useEffect(()=>{
        if( message === '' ) return;
        setTimeout(()=>{
            setMessage('');
            setIsError(false);
        },3500);
    },[message]);

    // Get system application info
    async function getSystemApplicationInfo(){
        if( !props.assetId ) return;
        setDisabled(true);
        const result = await direct_getSystemApplicationInfo( props.assetId );
        if(!result){
            setDisabled(false);
            return;
        }          
        if(result.message){
            setIsError(true);
            setMessage(result.message);
        }
        else {
            // Set the parameters in the fields
            if( typeof(result.version) === 'string' ) setAppVersion(result.version);
            if( typeof(result.cpuUsage) === 'string' ) setCpuUsage(result.cpuUsage);
            if( typeof(result.memUsage) === 'string' ) setMemUsage(result.memUsage);
            if( typeof(result.status) === 'string' ) setAppStatus(result.status);
        }
        setDisabled(false);
    }

    // Request system software update
    async function requestSystemSoftwareUpdate(){
        // Check if user is sure about this action
        if( !window.confirm("Update system software?") ) return;
        setDisabled(true);

        const result = await direct_updateSystemApplication(props.assetId);
        if( !result.ok ){
            setIsError(true);
            setMessage(result.message);
        }
        else{
            setIsError(false);
            setMessage(result.message);
        }
        setDisabled(false);
        return;
    }

    return(
        <>
            <h2>System software</h2>
            {/*<StatusIndicator message={appStatus==='online'?'Running':appStatus} type={appStatus==='online'?'success':'danger'}/>*/}
            <Form>
                <Form.Group as={Row} className="mb-2">
                    <Form.Label column sm={2}>CPU usage</Form.Label>
                    <Col sm={6}>
                        <Form.Control type={'text'} placeholder={'CPU usage'} value={cpuUsage} disabled/>
                    </Col>
                </Form.Group>
                <Form.Group as={Row} className="mb-2">
                    <Form.Label column sm={2}>Memory usage</Form.Label>
                    <Col sm={6}>
                        <Form.Control type={'text'} placeholder={'Memory usage'} value={memUsage} disabled/>
                    </Col>
                </Form.Group>
                <Form.Group as={Row} className="mb-2">
                    <Form.Label column sm={2}>Application version</Form.Label>
                    <Col sm={6}>
                        <Form.Control type={'text'} placeholder={'Version'} value={appVersion} disabled/>
                    </Col>
                </Form.Group>
                <NotificationBox message={message} isError={isError} />
                <Form.Group as={Row} className="mb-2">
                    <Form.Label column sm={2}></Form.Label>
                    <Col sm={6}>
                        <Button variant={'danger'} onClick={()=>{requestSystemSoftwareUpdate()}} disabled={disabled}>Update</Button>
                    </Col>
                </Form.Group>
            </Form>
        </>
    );
}

export default AssetSystemSoftware;