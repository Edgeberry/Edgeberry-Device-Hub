import { useEffect, useState } from "react";
import { Card, Col, Container, Row } from "react-bootstrap";
import { api_things_getThingIndex, api_things_getThingShadow} from "../../api/things";
import NotificationBox from "../Notification";
import StatusIndicator from "../StatusIndicator";
import { api_admin_getDeviceList } from "../../api/admin";

const AdminDeviceList = (props:{selected?:string})=>{
    const[ message, setMessage ] = useState<string>('');
    const[ isError, setIsError ] = useState<boolean>(false);
    const[ thingList, setThingList ] = useState<any[]>([]);

    useEffect(()=>{
        getThingsList();
    },[]);

    /* Get the list of things from the API */
    async function getThingsList(){
        const result = await api_admin_getDeviceList();
        if( result.message ){
            setIsError(true);
            setMessage(result.message);
            return;
        }
        setThingList(result);
    }

    return(
        <Container>
            <NotificationBox message={message} isError={isError}/>
            <Row className="asset-cartdeck" >
                {thingList.map((thing:any, index:number)=>{return <AdminDeviceListItem thing={thing} key={thing.name+'-'+index} selected={props.selected===thing.thingName}/>})}
            </Row>
        </Container>
    );
}


export default AdminDeviceList;

const AdminDeviceListItem = (props:{thing:any, selected:boolean})=>{
    // First-sight info about the device
    const[ connected, setConnected ] = useState<boolean>(false);        // the current connection state
    const[ deviceName, setDeviceName ] = useState<string>('');          // the name the user gave to the device
    const[ devicePlatform, setDevicePlatform ] = useState<string>('');  // the platform (e.g. Raspberry Pi 3B+)

    useEffect(()=>{
        updateAsset();
    },[]);

    // Update Asset
    async function updateAsset(){
        await getThingIndex();
        await getThingShadow();
    }

    // The 'Thing Index' contains information like
    // the connection state (+ timestamp), thing type, ... . And our
    // custom attributes 'deviceName' and 'deviceOwner' from the thing
    // template. Note that the 'thingId' from the result is not the
    // deviceId from the device EEPROM (!). - TODO: check possibilities
    async function getThingIndex(){
        const result = await api_things_getThingIndex(props.thing.thingName);
        if( result.message ){
            // TODO - do something with the error...
        }
        setConnected(result?.connectivity?.connected);
        setDeviceName(result?.attributes?.deviceName);
    }

    // The 'Thing Shadow' contains information about the device state
    // like what the last known state is of the system (e.g. 'rebooting',
    // 'updating', 'running')
    async function getThingShadow(){
        const result = await api_things_getThingShadow(props.thing.thingName);
        if( result.message ){
            // TODO - do something with the error...
        }
        // The device hardware platform is also in this info
        setDevicePlatform(result?.state?.reported?.system?.system?.platform);
    }

    return(
        <Container style={{padding:'1px'}}>
            <Card>
                <Row>
                    <Col xs='3' sm='2' md='1' style={{padding:'15px'}}>
                        <img src={process.env.PUBLIC_URL+'/Edgeberry_rendering.png'} width="100%" />
                    </Col>
                    <Col>
                        <div style={{height:'100%', padding:'5px'}}>
                            <div style={{fontWeight:'bold', fontSize:'1.2rem'}}>
                                <StatusIndicator noText message={connected?"Online":"Offline"} type={connected?"success":"danger"} />&nbsp;
                                {props.thing.thingName}
                            </div>
                            <div style={{color:'var(--edgeberry_dark_gray)'}}>
                                {devicePlatform?devicePlatform:"No platform"}<br/>
                                {deviceName?deviceName:"No device name"}
                            </div>
                        </div>
                    </Col>
                </Row>
            </Card>
        </Container>
    );
}
