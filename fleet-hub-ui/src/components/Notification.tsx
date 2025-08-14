import { faCheck, faWarning } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Alert } from "react-bootstrap";

const NotificationBox = ( props:{ message:string, isError?:boolean })=>{
    return(<>
            {props.message?
                <Alert variant={props.isError?'danger':'success'}>
                    <FontAwesomeIcon icon={props.isError?faWarning:faCheck}/> {props.message}
                </Alert>
            :<></>}
        </>);
}

export default NotificationBox;