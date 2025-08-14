import { Button, Container } from "react-bootstrap";
import AssetList from "./Devices/AssetList";
import { useNavigate } from "react-router-dom";
import { useRef, useState } from "react";
import AssetListHeader from "./Devices/AssetListHeader";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus } from "@fortawesome/free-solid-svg-icons";
import AssetAddNewModal from "./Devices/AssetAddNewModal";
import HealthWidget from "./HealthWidget";

const Assets = (props:{user:any})=>{
    // Add new device modal (optional for Registrar role)
    const[ showAddNew, setShowAddNew ] = useState<boolean>(false);

    const assetListRef = useRef<{refresh():void}>();

    // Refresh the device list
    function refreshAssetList(){
        // allow the system to implement changes (dirty?...)
        setTimeout(()=>{assetListRef.current?.refresh()},700);
    }

    const navigate = useNavigate();
    function goToCreate(){ setShowAddNew(true); }

    return (
        <>
            <Container style={{textAlign:'left'}}>
                <br/>
                <HealthWidget />
                <AssetListHeader />
                <hr/>
                <AssetList ref={assetListRef} />
                <hr/>
                {props.user? (
                    <Button variant={"primary"} onClick={goToCreate}><FontAwesomeIcon icon={faPlus} />Add device</Button>
                ) : null}
            </Container>
            {/* Create device modal (optional). Only if authenticated. */}
            {props.user? (
                <AssetAddNewModal show={showAddNew} onClose={()=>{setShowAddNew(false)}} onChange={(close?:boolean)=>{refreshAssetList()}}/>
            ) : null}
        </>
    );
}

export default Assets;
