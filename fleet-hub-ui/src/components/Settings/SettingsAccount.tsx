import { SyntheticEvent, useEffect, useState } from "react";
import { Button, Col, Form, Row } from "react-bootstrap";
import NotificationBox from "../Notification";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faUser } from "@fortawesome/free-solid-svg-icons";
import SettingsAccountDeleteModal from "./SettingsAccountDeleteModal";
import { api_user_updateProfile } from "../../api/user";
import SettingsAccountUpdatePasswordModal from "./SettingsAccountUpdatePasswordModal";

const SettingsAccount = (props:{user:any|null})=>{
    const[ disabled, setDisabled ] = useState<boolean>(false);
    const[ message, setMessage ] = useState<string>('');
    const[ isError, setIsError ] = useState<boolean>(false);
    // Input fields
    const[ username, setUsername ] = useState<string>('');
    const[ email, setEmail ] = useState<string>('');
    // Delete user modal
    const[ deleteModalShow, setDDeleteModalShow ] = useState<boolean>(false);
    // Update password modal
    const[ passwordModalShow, setPasswordModalShow ] = useState<boolean>(false);

    useEffect(()=>{
        if(typeof(props.user?.username) === 'string') setUsername(props.user.username);
        if(typeof(props.user?.email) === 'string') setEmail(props.user.email);
    },[props.user]);

    // Disappearing messages
    useEffect(()=>{
        if( message === '' ) return;
        setTimeout(()=>{
            setMessage('');
            setIsError(false);
        },3500);
    },[message]);

    async function updateUserProfile(e:SyntheticEvent){
        e.preventDefault();   // prevents page refresh
        setDisabled(true);

        const result = await api_user_updateProfile( username, email );

        if(result.message !== 'success'){
            setIsError(true);
            setMessage(result.message);
        }
        else {
            setIsError(false);
            setMessage('User data successfully updated!');
        }
        setDisabled(false);
    }

    return (
        <>
            <h2><FontAwesomeIcon icon={faUser} /> Account</h2>
            <p className="text-subtitle">Your Edgeberry Fleet Hub user account settings </p>
            <Form onSubmit={(e)=>{updateUserProfile(e)}}>
                <Form.Group as={Row} className="mb-2">
                    <Form.Label column sm={2}>Username</Form.Label>
                    <Col sm={6}>
                        <Form.Control type={'text'} placeholder={'Username'} value={username} onChange={(e)=>{setUsername(e.target.value)}} required disabled={disabled}/>
                    </Col>
                </Form.Group>
                <Form.Group as={Row} className="mb-2">
                    <Form.Label column sm={2}>E-mail</Form.Label>
                    <Col sm={6}>
                        <Form.Control type={'email'} placeholder={'E-mail'} value={email} onChange={(e)=>{setEmail(e.target.value)}} required disabled={disabled}/>
                    </Col>
                </Form.Group>
                <Form.Group as={Row} className="mb-2">
                    <Form.Label column sm={2}></Form.Label>
                    <Col sm={6}>
                        <Button variant={'primary'} disabled={disabled} onClick={()=>{setPasswordModalShow(true)}}>Change password</Button>
                    </Col>
                </Form.Group>
                <NotificationBox message={message} isError={isError} />
                <div style={{width:'100%', textAlign:'right'}}>
                    <Button variant={'primary'} type="submit" disabled={disabled}>Save</Button>&nbsp;
                    <Button variant={'danger'} onClick={()=>{setDDeleteModalShow(true)}} disabled={disabled}>Delete account</Button>
                </div>
            </Form>

            <SettingsAccountDeleteModal show={deleteModalShow} onClose={()=>{setDDeleteModalShow(false)}}/>
            <SettingsAccountUpdatePasswordModal show={passwordModalShow} onClose={()=>{setPasswordModalShow(false)}} />
        </>
    );
}

export default SettingsAccount;
