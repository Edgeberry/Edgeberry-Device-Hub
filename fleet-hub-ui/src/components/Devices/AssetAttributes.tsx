import { useEffect, useState } from "react";
import { Button, Col, Form, Row } from "react-bootstrap";
import NotificationBox from "../Notification";
import { api_things_delete, api_things_getThingDescription, api_things_updateThingDescription } from "../../api/things";

const AssetAttributes = ( props:{assetId:string, assetShadow:any, onChange?:Function })=>{
    const[ disabled, setDisabled ] = useState<boolean>(false);
    const[ message, setMessage ] = useState<string>('');
    const[ isError, setIsError ] = useState<boolean>(false);

    // Attributes
    const[ deviceName, setDeviceName ] = useState<string>('');
    const[ deviceGroup, setDeviceGroup ] = useState<string>('');
    const[ deviceOwnerId, setDeviceOwnerId ] = useState<string>('');

    useEffect(()=>{
        getThingDescription();
    },[]);

    // Disappearing messages
    useEffect(()=>{
        if( message === '' ) return;
        setTimeout(()=>{
            setMessage('');
            setIsError(false);
        },3500);
    },[message]);

    // Get the thing description
    // the by the user given device name etc is in its attributes
    async function getThingDescription(){
        setDisabled(true);
        const result = await api_things_getThingDescription(props.assetId);
        if( result.message ){
            // TODO - do something with the error...
            return setDisabled(false);
        }
        setDeviceName(result?.attributes?.deviceName);
        setDeviceGroup(result?.attributes?.deviceGroup);
        setDeviceOwnerId(result?.attributes?.deviceOwner);

        setDisabled(false);
    }

    // Save the device attributes
    async function saveAttributes(){
        setDisabled(true);

        const result = await api_things_updateThingDescription(props.assetId, deviceName, deviceOwnerId);
        if( result.message ){
            setIsError(true);
            setMessage(result.message);
            return setDisabled(false);
        }
        if(typeof(props.onChange)==='function')  props.onChange();
        setIsError(false);
        setMessage("Device attributes successfully updated!");
        return setDisabled(false);
    }

    // Delete Asset
    async function deleteAsset(){
        if( !window.confirm("Delete '"+props.assetId+"'?")) return;
    
        const result = await api_things_delete( props.assetId );
        if( result.message ){
            // TODO: do something with the error
            console.log(result.message);
        }
        if(typeof(props.onChange)==='function') props.onChange(true);
    }

    return (
        <>
            <h2>Device</h2>
            <Form>
                <Form.Group as={Row} className="mb-2">
                    <Form.Label column sm={2}>Device name</Form.Label>
                    <Col sm={6}>
                        <Form.Control type={'text'} placeholder={'Device name'} value={deviceName} onChange={(e)=>{setDeviceName(e.target.value)}} required disabled={disabled}/>
                    </Col>
                </Form.Group>
                <Form.Group as={Row} className="mb-2">
                    <Form.Label column sm={2}>Device Group</Form.Label>
                    <Col sm={6}>
                        <Form.Control type={'text'} placeholder={'Device Group'} value={deviceGroup} onChange={(e)=>{setDeviceGroup(e.target.value)}} disabled={disabled}/>
                    </Col>
                </Form.Group>
                {/*<Form.Group as={Row} className="mb-2">
                    <Form.Label column sm={2}>Device owner ID</Form.Label>
                    <Col sm={6}>
                        <Form.Control type={'text'} placeholder={'Device owner ID'} value={deviceOwnerId} disabled/>
                    </Col>
    </Form.Group>*/}
                <NotificationBox message={message} isError={isError} />
                <div style={{width:'100%', textAlign:'right'}}>
                    <Button variant={'primary'} onClick={()=>{saveAttributes()}} disabled={disabled}>Save</Button>&nbsp;
                    <Button variant={'danger'} onClick={()=>{deleteAsset()}}>Delete</Button>
                </div>
            </Form>
        </>
    );
}

export default AssetAttributes;