import { faCircle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useState } from "react";

const StatusIndicator = ( props:{ message:string, type?:string, noText?:boolean})=>{
    const[ color, setColor ] = useState<string>('#28a745');

    useEffect(()=>{
        switch(props.type){
            case 'danger':  //setColor('#dc3545');
                            setColor('#dc143c');
                            break;
            case 'warning': setColor('#ffc107');
                            break;
            default:        //setColor('#28a745');
                            setColor('#0007ff');
                            break;
        }
    },[props.type]);

    return(<>
            {props.message?
                <span style={{fontWeight:'bold', color:`${color}`}}><FontAwesomeIcon icon={faCircle}/> {props.noText?'':props.message}</span>
            :<></>}
        </>);
}

export default StatusIndicator;