import { useEffect, useState } from "react";
import { Alert, Button, Modal, Tab, Tabs } from "react-bootstrap";
import CommandModal from "../CommandModal";
import AssetApplication from "./AssetApplication";
import { faArrowRightArrowLeft, faInfoCircle, faLocationDot, faPowerOff } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import AssetConnection from "./AssetConnection";
import AssetSystem from "./AssetSystem";
import StatusIndicator from "../StatusIndicator";
import { api_things_getThingDescription, api_things_getThingShadow } from "../../api/things";
import AssetSystemNetwork from "./AssetSystemNetwork";
import NotificationBox from "../Notification";
import { direct_identifySystem, direct_restartSystem } from "../../api/directMethods";

const AssetDetailModal = ( props:{ assetId:string, show:boolean, onClose:Function, onChange?:Function })=>{
    const[ description, setDescription ] = useState<any|null>(null);
    const[ shadow, setShadow ] = useState<any|null>(null);

    // Command Modal
    const[ show, setShow ] = useState<boolean>(false);
    const[ disabled, setDisabled ] = useState<boolean>(false);

    // Error or success messages
    const[ message, setMessage ] = useState<string>('');
    const[ isError, setIsError ] = useState<boolean>(false);

    // Disappearing messages
    useEffect(()=>{
        if( message === '' ) return;
        setTimeout(()=>{
            setMessage('');
            setIsError(false);
        },3500);
    },[message]);

    useEffect(()=>{
        getThingDescription();
        getThingShadow();
    },[props.assetId]);

    // Get the Thing description
    async function getThingDescription(){
        if( !props.assetId ) return;
        const result = await api_things_getThingDescription(props.assetId);
        if( result.message ){
            // TODO: do something with the error
            return;
        }
        setDescription(result);
    }
    
    async function getThingShadow(){
        if( !props.assetId ) return;
        const result = await api_things_getThingShadow(props.assetId);
        if( result.message ){
            // TODO: do something with the error
            console.log(result.message);
            return;
        }
        setShadow(result);
        console.log(result);
    }

        // Request system restart
        async function requestSystemRestart(){
            // Check if user is sure about this action
            if( !window.confirm("Restart system?") ) return;
            setDisabled(true);
    
            const result = await direct_restartSystem( props.assetId );
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
    
        // Request system identification
        async function requestSystemIdentifycation(){
            const result = await direct_identifySystem( props.assetId );
    
            if( !result.ok ){
                setIsError(true);
                setMessage(result.message);
            }
            else{
                setIsError(false);
                setMessage(result.message);
            }
            return;
        }

    return(<>
            <Modal size={'xl'} onHide={()=>{props.onClose()}} show={props.show} >
                <Modal.Body style={{minHeight:'50vh'}}>
                        <div style={{float:'right'}}>
                            <Button variant={'primary'} className="mb-2" onClick={()=>{setShow(true)}}><FontAwesomeIcon icon={faArrowRightArrowLeft}/></Button>&nbsp;
                            <Button variant={'primary'} className="mb-2" onClick={()=>{requestSystemIdentifycation()}} disabled={disabled}><FontAwesomeIcon icon={faLocationDot}/></Button>&nbsp;
                            <Button variant={'danger'} className="mb-2" onClick={()=>{requestSystemRestart()}} disabled={disabled}><FontAwesomeIcon icon={faPowerOff}/></Button>
                        </div>
                        <h2>{description && description?.attributes?.deviceName?description.attributes.deviceName:props.assetId}</h2>
                        <p className="text-subtitle">
                            {/*{description && description?.thingTypeName? description.thingTypeName:'No asset type'} &nbsp;
                            {shadow && shadow?.state?.reported?.system?.system?.version? shadow?.state?.reported?.system?.system?.version:'No hardware platform'} &nbsp;
                            (*/}
                            {shadow && shadow?.state?.reported?.system?.system?.platform? shadow?.state?.reported?.system?.system?.platform:'No hardware platform'} {/*})*/}
                        </p>
                        {/*<NotificationBox message={message} isError={isError} />*/}
                         <CommandModal show={show} deviceId={description?.thingName?description.thingName:''} onClose={()=>{setShow(false)}}/>

                        <Tabs defaultActiveKey="application" className="mb-3">
                        
                            <Tab eventKey="application" title={<><StatusIndicator message="b" noText type={(shadow && shadow?.state?.reported?.system?.application?.state === 'ok')?'success':'danger'}/> Application</>}>
                                <AssetApplication assetId={props.assetId} />
                            </Tab>
                
                            <Tab eventKey="connection" title={<><StatusIndicator message="b" noText type={(shadow && shadow?.state?.reported?.system?.connection?.connection === 'connected')?'success':'danger'}/> Connection</>}>
                                <AssetSystemNetwork assetId={props.assetId} assetShadow={shadow} />
                                <hr/>
                                <AssetConnection assetId={props.assetId} />
                            </Tab>
                            <Tab eventKey="System" title={<><StatusIndicator message="b" noText type={(shadow && shadow?.state?.reported?.system?.system?.state === 'running')?'success':'danger'}/> System</>}>
                                <AssetSystem assetId={props.assetId} assetShadow={shadow} onChange={props.onChange}/>
                            </Tab>
                        </Tabs>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant={'danger'} onClick={()=>{props.onClose()}} disabled={disabled}>Close</Button>
                </Modal.Footer>
            </Modal>
        </>);
}

export default AssetDetailModal;