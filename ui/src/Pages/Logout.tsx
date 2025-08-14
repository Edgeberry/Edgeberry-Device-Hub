import { useNavigate } from 'react-router-dom';
import { api_user_logout } from '../api/user';
import { useEffect } from 'react';

const Logout = (props:{user:any|null, onLogout:Function }) => {
    useEffect(()=>{
        navigateToLogin();
    },[]);


    const navigate = useNavigate();

    async function navigateToLogin(){
        // Log out the user
        await api_user_logout();
        // Call the onLogout function
        props.onLogout();
        // Navigate to login
        navigate('/login');
    }

    return(<p>Logging out...</p>);
}

export default Logout;