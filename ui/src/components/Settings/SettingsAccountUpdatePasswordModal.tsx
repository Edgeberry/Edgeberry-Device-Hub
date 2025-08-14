import { SyntheticEvent, useEffect, useState } from "react";
import { Button, Form, Modal } from "react-bootstrap";
import NotificationBox from "../Notification";
import { api_user_updatePassword } from "../../api/user";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faKey } from "@fortawesome/free-solid-svg-icons";

const SettingsAccountUpdatePasswordModal = ( props:{ show:boolean, onClose:Function })=>{
    const navigate = useNavigate();
    // Input fields
    const[ password, setPassword ] = useState<string>('');
    const[ newPassword, setNewPassword ] = useState<string>('');
    const[ retypePassword, setRetypePassword ] = useState<string>('');
    // User feedback
    const[ message, setMessage ] = useState<string>('');
    const[ isError, setIsError ] = useState<boolean>(false);
    const[ disabled, setDisabled ] = useState<boolean>(false);

    // Disappearing messages
    const[ timeoutKeeper, setTimeoutKeeper ] = useState<ReturnType<typeof setTimeout>|null>(null);
    useEffect(()=>{
        if( message === '' ) return;
        if( timeoutKeeper ) clearTimeout( timeoutKeeper );
        setTimeoutKeeper(setTimeout(()=>{
            setMessage('');
            setIsError(false);
        },3500));
    },[message]);

    // On submit, update the user password
    async function updateUserPassword(e:SyntheticEvent){
        e.preventDefault();   // prevents page refresh

        setDisabled(true);
        if( newPassword.length < 8 ){
            setIsError(true);
            setDisabled(false);
            return setMessage("New password too short");
        }
        // Check whether the new password has no typo's
        if( newPassword !== retypePassword ){
            setIsError(true);
            setDisabled(false);
            return setMessage("New passwords not the same");
        }
        // Update the password
        const result = await api_user_updatePassword( password, newPassword );
        if( result.message !== 'success'){
            setIsError(true);
            setDisabled(false);
            return setMessage(result.message);
        }
        setIsError(false);
        setDisabled(false);
        setMessage("Password successfully updated!");
    }

    return(<>
            <Modal onHide={()=>{props.onClose()}} show={props.show} >
                <Modal.Body>
                    <Form onSubmit={(e)=>{updateUserPassword(e)}}>
                        <h4><FontAwesomeIcon icon={faKey} /> Change password</h4>
                        <hr/>
                        <Form.Group className="mb-2">
                            <Form.Label>Current password</Form.Label>
                            <Form.Control type={'password'} placeholder={'Current password'} value={password} autoComplete="current-password" onChange={(e)=>{setPassword(e.target.value)}} required disabled={disabled}/>
                        </Form.Group>
                        <Form.Group className="mb-2">
                            <Form.Label>New password</Form.Label>
                            <Form.Control type={'password'} placeholder={'New password'} value={newPassword} autoComplete="new-password" onChange={(e)=>{setNewPassword(e.target.value)}} required disabled={disabled}/>
                        </Form.Group>
                        <Form.Group className="mb-2">
                            <Form.Label>Retype password</Form.Label>
                            <Form.Control type={'password'} placeholder={'New password'} value={retypePassword} autoComplete="new-password"  onChange={(e)=>{setRetypePassword(e.target.value)}} required disabled={disabled}/>
                        </Form.Group>
                        <hr/>
                        <NotificationBox message={message} isError={isError} />
                        <Button variant={'primary'} onClick={()=>{props.onClose()}} disabled={disabled}>Cancel</Button>
                        <Button variant={'danger'} type="submit" disabled={disabled} style={{float:'right'}}>Save</Button>
                    </Form>
                </Modal.Body>
            </Modal>
        </>);
}

export default SettingsAccountUpdatePasswordModal;