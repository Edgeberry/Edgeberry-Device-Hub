import {useState, SyntheticEvent, useEffect } from 'react';
import { Button, Container, Form } from 'react-bootstrap';
import { Navigate, useNavigate } from 'react-router-dom';
import logo from '../EdgeBerry_Logo_text.svg';
import NotificationBox from '../components/Notification';
import TermsAndConditionsModal from '../components/TermsAndConditionsModal';
import { api_user_register } from '../api/user';

const Register = (props:{user:any, onLogin:Function }) => {
    const[ name, setName ] = useState<string>("");
    const[ email, setEmail ] = useState<string>("");
    const[ password, setPassword ] = useState<string>("");
    const[ retypePassword, setRetypePassword ] = useState<string>("");

    const[ isError, setIsError] = useState<boolean>(false);
    const[ message, setMessage] = useState<string>('');

    // Terms & Conditions modal
    const[ show, setShow ] = useState<boolean>(false);
    // Navigate
    const navigate = useNavigate();
    // disable input fields
    const[ disabled, setDisabled ] = useState<boolean>(false);

    // Disappearing messages
    useEffect(()=>{
        if( message === '' ) return;
        setTimeout(()=>{
            setMessage('');
            setIsError(false);
        },3500);
    },[message]);

    // Register user
    const submit = async (e:SyntheticEvent) =>{
        e.preventDefault();   // prevents page refresh
        setDisabled(true);

        // Run some checks
        if( password !== retypePassword){
            setDisabled(false);
            setIsError(true);
            return setMessage("The passwords are not the same. Please ensure the passwords are provided correctly.");
        }
        
        // register the new user
        const result = await api_user_register( email, password, name );

        if(result.message !== 'success'){
            setDisabled(false)
            setIsError(true);
            return setMessage(result.message);
        }

        setIsError(false);
        setTimeout(()=>{navigate("/dashboard")},2000);
        return setMessage("Registration successful! Check your inbox for the activation e-mail.");
    }
    
    // if a user is logged in, redirect to home
    if( props.user ){
        return (<Navigate to='/assets' />);
    }

    return(
        <Container className="container-page">
            <Container className="centerbox">
                <Form onSubmit={submit}>
                    <img src={logo} width="100%" alt="logo" />
                    <br/>
                    <br/>
                    <Form.Group className="mb-2">
                        <Form.Control type={'text'} placeholder={'Name'} value={name} onChange={(e)=>{setName(e.target.value)}} required disabled={disabled}/>
                    </Form.Group>
                    <Form.Group className="mb-2">
                        <Form.Control type={'email'} placeholder={'E-mail'} value={email} onChange={(e)=>{setEmail(e.target.value)}} autoComplete="username" required disabled={disabled}/>
                    </Form.Group>
                    <Form.Group className="mb-2">
                        <Form.Control type={'password'} placeholder={'Password'} minLength={8} value={password} onChange={(e)=>{setPassword(e.target.value)}} autoComplete="new-password" required disabled={disabled}/>
                    </Form.Group>
                    <Form.Group className="mb-2">
                        <Form.Control type={'password'} placeholder={'Retype password'} minLength={8} value={retypePassword} onChange={(e)=>{setRetypePassword(e.target.value)}} autoComplete="new-password" required disabled={disabled}/>
                    </Form.Group>
                    <hr/>
                    <Form.Group className="mb-2">
                        <Form.Check required type={'checkbox'} label={<>Agree to <span style={{cursor:'pointer', color:'var(--edgeberry_blue)'}} onClick={()=>setShow(true)}>terms & conditions</span></>}  disabled={disabled}/>
                    </Form.Group>
                    <NotificationBox message={message} isError={isError} />
                    <Button variant={'primary'} className="w-100 btn btn-lg" type="submit" disabled={disabled}>Register</Button>
                </Form>
            </Container>
            <TermsAndConditionsModal show={show} onClose={()=>{setShow(false)}}/>
        </Container>
    )
}

export default Register;