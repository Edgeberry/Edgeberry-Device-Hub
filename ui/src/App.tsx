/**
 * App shell and routing.
 *
 * Auth model: single-user admin. We verify authentication via `/api/auth/me`
 * and store a minimal `user` object in state with `roles: ['admin']`.
 * All application routes are wrapped in `RequireAuth`, which redirects to `/login`
 * when unauthenticated. After login/logout the shell refreshes auth state
 * using `refreshUser()` which re-queries `/api/auth/me`.
 * 
 * Session Management:
 * - JWT expiration is tracked via SessionManager component
 * - Warning modal appears 20 seconds before expiration
 * - Page automatically refreshes on login/logout
 * - Session validity is checked when page becomes visible (after sleep)
 */
import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './Pages/Dashboard';
import Overview from './Pages/Overview';
import Settings from './Pages/Settings';
import Logout from './Pages/Logout';
import SessionManager from './components/SessionManager';

function App(){
  const [user, setUser] = useState<any|null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(()=>{
    let cancelled = false;
    (async ()=>{
      try{
        const res = await fetch('/api/auth/me');
        if (!cancelled && res.ok){
          const data = await res.json();
          if (data?.authenticated){ setUser({ name: data.user || 'admin', roles: ['admin'] }); }
        }
      }catch{}
      if(!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  },[]);

  async function refreshUser(){
    try{
      const r = await fetch('/api/auth/me');
      if (r.ok){ const d = await r.json(); if (d?.authenticated){ setUser({ name: d.user || 'admin', roles: ['admin'] }); return; } }
    }catch{}
    setUser(null);
  }

  async function handleLogin(){
    await refreshUser();
    // Refresh page to ensure clean state
    window.location.reload();
  }

  async function handleLogout(){
    setUser(null);
    // Refresh page to clear any cached data
    window.location.reload();
  }

  function handleSessionExpired(){
    setUser(null);
    // Automatically refresh page to show login
    window.location.reload();
  }

  function RequireAuth(props:{ children: React.ReactNode }){
    if (loading) return null; // or a spinner
    if (!user) return <Navigate to='/login' replace />;
    return <>{props.children}</>;
  }

  return (
    <div className="App">
      <SessionManager user={user} onSessionExpired={handleSessionExpired} />
      <BrowserRouter>
        <Routes>
          { /* Login is handled via a modal inside Dashboard */ }

          { /* One-page app: everything resolves to '/' with Overview */ }
          <Route path='/' element={<Dashboard user={user} onLoggedIn={handleLogin} /> }>
            <Route index element={<Overview user={user} />} />
            <Route path='settings' element={<RequireAuth><Settings user={user} /></RequireAuth>} />
            { /* Protected route for logout action */ }
            <Route path='logout' element={<RequireAuth><Logout user={user} onLogout={handleLogout} /></RequireAuth>} />
            <Route path='*' element={<Navigate to='/' replace />} />
          </Route>
          <Route path='*' element={<Navigate to='/' replace />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}
export default App;
