import { useEffect, useState } from "react";
import { Col, Form, Row } from "react-bootstrap";
import NotificationBox from "../Notification";
import { direct_getSystemNetworkInfo } from "../../api/directMethods";


const AssetSystemNetwork = (props:{assetId:string, assetShadow:any })=>{
    const[ disabled, setDisabled ] = useState<boolean>(false);
    // Error or success messages
    const[ message, setMessage ] = useState<string>('');
    const[ isError, setIsError ] = useState<boolean>(false);

    // Network
    const[ ssid, setSsid ] = useState<string>('');
    const[ ipAddress, setIpAddress ] = useState<string>('');

    useEffect(()=>{
        getSystemNetworkInfo();
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
    async function getSystemNetworkInfo(){
        if( !props.assetId ) return;
        setDisabled(true);
        const result = await direct_getSystemNetworkInfo( props.assetId );
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
            if( typeof(result.ssid) === 'string' ) setSsid(result.ssid);
            if( typeof(result.ipAddress) === 'string' ) setIpAddress(result.ipAddress);
        }
        setDisabled(false);
    }

    return(
        <>
            <h2>Network</h2>
            <Form>
                <Form.Group as={Row} className="mb-2">
                    <Form.Label column sm={2}>SSID</Form.Label>
                    <Col sm={6}>
                        <Form.Control type={'text'} placeholder={'SSID'} value={ssid} disabled/>
                    </Col>
                </Form.Group>
                <Form.Group as={Row} className="mb-2">
                    <Form.Label column sm={2}>IP address</Form.Label>
                    <Col sm={6}>
                        <Form.Control type={'text'} placeholder={'IP address'} value={ipAddress} disabled/>
                    </Col>
                </Form.Group>
            </Form>
            <NotificationBox message={message} isError={isError} />
        </>
    );
}

export default AssetSystemNetwork;