/**
 * Logout Page
 *
 * Purpose: Immediately logs the user out when navigated to.
 *
 * Flow:
 *  - Calls `/api/auth/logout` to clear the HttpOnly cookie.
 *  - Hard-navigates to `/` via `window.location.replace` - deliberately not
 *    React Router's `navigate()` + App.tsx's usual reload-on-auth-change
 *    pattern. Client-side `navigate()` followed by a later `reload()` is a
 *    race between a `history.replaceState` call and the reload picking up
 *    that new URL in time; lose it and the reload fires while still on
 *    `/logout`, so the *next* login reloads back onto this exact route and
 *    logs the user straight back out. `location.replace('/')` is a single
 *    atomic browser navigation with no such window - it's simply
 *    impossible to land back on `/logout` afterward, so no client-side
 *    state update is needed here either (the fresh document load handles
 *    that itself).
 */
import { useEffect } from 'react';

export default function Logout(){
  useEffect(()=>{
    (async ()=>{
      try{ await fetch('/api/auth/logout', { method: 'POST' }); }catch{}
      window.location.replace('/');
    })();
  },[]);
  return null;
}
