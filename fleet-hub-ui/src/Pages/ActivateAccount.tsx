import {  useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Container } from 'react-bootstrap';
import { api_user_activateAccount, api_user_logout } from '../api/user';
import LoaderOverlay from '../components/LoadingOverlay';
import NotificationBox from '../components/Notification';

const ActivateAccount = ( props:{user:any|null, onChange?:Function|null } )=>{
  // Loading Overlay
  const[ loading, setLoading] = useState(true);
  const[ loadingText, setLoadingText ] = useState('Activating account');
  const[ loadingSubtext, setLoadingSubtext ] = useState('Just a sec...');
  // Error message
  const[ errMsg, setErrMsg ] = useState('');
  // Navigate
  const navigate = useNavigate();

  // Get e-mail and activation token from URL query
  const [searchParams, setSearchParams] = useSearchParams();
  const email = searchParams.get("email");
  const token = searchParams.get("token");

  // If a user is already logged in, log out
  if(props.user){
    api_user_logout();
  }

  useEffect(()=>{
    activateAccount();
  },[]);

  // Delete this user
  async function activateAccount(){
    if(!email || !token) return;
    setLoadingText('Activating account...');
    setLoadingSubtext('Just a sec...');
    setLoading(true);
    const result = await api_user_activateAccount( email, token );
    if( result.message !== 'success' ){
      setLoading(false);
      setErrMsg(result.message);
      return;
    }
    setLoadingText('Account activated!');
    setLoadingSubtext('You can now log in...')
    setTimeout(()=>{
      setLoading(false);
      navigate('/dashboard/login');
    },1500);
  }

  return(
    <>
      <LoaderOverlay spinner hidden={!loading} text={loadingText} subtext={loadingSubtext}/>
      <Container>
        <br/>
        <NotificationBox message={errMsg} isError={true} />
      </Container>
    </>
  )
}

export default ActivateAccount;