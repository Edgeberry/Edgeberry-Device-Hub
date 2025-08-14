import {useState, SyntheticEvent } from 'react';
import { Button, Container, Form } from 'react-bootstrap';
import { Link, Navigate } from 'react-router-dom';
import logo from '../EdgeBerry_Logo_text.svg';
import { api_user_login } from '../api/user';
import NotificationBox from '../components/Notification';

const Login = (props:{user:any, onLogin:Function }) => {
    const[ email, setEmail ] = useState("");
    const[ password, setPassword ] = useState("");
    const[ message, setMessage] = useState('');

    // on submit ('log in'), post the username and password to the login api,
    const submit = async (e:SyntheticEvent) =>{
        e.preventDefault();   // prevents page refresh
        const content = await api_user_login( email, password );   // login user with API call

        if(content.message !== 'success'){
            setMessage(content.message);
        }
        else {
            props.onLogin(true);
        }
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
                        <Form.Control type={'e-mail'} placeholder={'E-mail'} value={email} onChange={(e)=>{setEmail(e.target.value)}} autoComplete="username" required/>
                    </Form.Group>
                    <Form.Group className="mb-2">
                        <Form.Control type={'password'} placeholder={'Password'} value={password} onChange={(e)=>{setPassword(e.target.value)}} autoComplete="current-password" required/>
                    </Form.Group>
                    <NotificationBox message={message} isError={true} />
                    <Button variant={'primary'} className="w-100 btn btn-lg mb-2" type="submit">Log in</Button>
                    <p>No account yet? <Link to='/register'>Register</Link> now</p>
                </Form>
            </Container>
        </Container>
    )
}

export default Login;