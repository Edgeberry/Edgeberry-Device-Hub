/**
 * Logout Page
 *
 * Purpose: Immediately logs the user out when navigated to.
 *
 * Flow:
 *  - Calls `/api/auth/logout` to clear the HttpOnly cookie.
 *  - Invokes `props.onLogout()` (clears UI auth state), then navigates to `/login`.
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Logout(props:{user:any,onLogout:()=>void}){
  const nav = useNavigate();
  useEffect(()=>{
    (async ()=>{
      try{ await fetch('/api/auth/logout', { method: 'POST' }); }catch{}
      props.onLogout();
      nav('/login', { replace: true });
    })();
  },[]);
  return null;
}
