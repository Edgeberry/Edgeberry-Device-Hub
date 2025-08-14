import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Alert, Card, Col, Container, Row } from "react-bootstrap";
import { getDevices } from "../../api/fleethub";
import NotificationBox from "../Notification";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faInfoCircle } from "@fortawesome/free-solid-svg-icons";

const AssetList = forwardRef((props:{selected?:string},ref)=>{
    const[ message, setMessage ] = useState<string>('');
    const[ isError, setIsError ] = useState<boolean>(false);
    const[ deviceList, setDeviceList ] = useState<any[]>([]);

    // Function callable by parent
    useImperativeHandle(ref,()=>({
        refresh(){ loadDevices()}       
    }));

    useEffect(()=>{
        loadDevices();
    },[]);

    /* Get the list of devices from the API */
    async function loadDevices(){
        setDeviceList([]);
        const result = await getDevices();
        if( result?.message ){
            setIsError(true);
            setMessage(result.message);
            return;
        }
        setDeviceList(Array.isArray(result)?result:[]);
    }

    return(
        <Container>
            <NotificationBox message={message} isError={isError}/>
            {deviceList.length >= 1?
                <Row className="asset-cartdeck" >
                    {deviceList.map((d:any, index:number)=>{return <AssetListItem device={d} key={(d.id||d.name||'device')+'-'+index} selected={false}/>})}
                </Row>:
                <Alert>
                    <FontAwesomeIcon icon={faInfoCircle} /> <strong>You don't seem to have any devices yet</strong>. To add your first device, click the 'Add device' button below.
                </Alert>
            }
        </Container>
    );
});


export default AssetList;

const AssetListItem = (props:{device:any, selected:boolean})=>{
    const navigate = useNavigate();
    const id = props?.device?.id || props?.device?.name;
    const name = props?.device?.name || id;
    const model = props?.device?.model || '-';
    const status = props?.device?.status || '-';
    function open(){ if(id) navigate('/devices/'+id); }

    return(
        <Col className="asset-card-container" xl='3' lg='4' md='4' sm='6' xs='6'>
            <Card className="asset-card" onClick={open} style={{cursor:'pointer'}}>
                <Card.Img variant="top" src={process.env.PUBLIC_URL+'/Edgeberry_rendering.png'} style={{minHeight:'200px'}} />
                <Card.Body className="asset-card-body">
                    <Card.Title className="asset-card-title">{name}</Card.Title>
                    <Card.Text className="asset-card-text">{model} • {status}</Card.Text>
                </Card.Body>
            </Card>
        </Col>
    );
}
