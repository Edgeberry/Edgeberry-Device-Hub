/**
 * App shell and routing.
 *
 * Auth model: single-user admin. We verify authentication via `/api/auth/me`
 * and store a minimal `user` object in state with `roles: ['admin']`.
 * All application routes are wrapped in `RequireAuth`, which redirects to `/login`
 * when unauthenticated. After login/logout the shell refreshes auth state
 * using `refreshUser()` which re-queries `/api/auth/me`.
 */
import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './Pages/Dashboard';
import Overview from './Pages/Overview';
import Logout from './Pages/Logout';

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

  function RequireAuth(props:{ children: React.ReactNode }){
    if (loading) return null; // or a spinner
    if (!user) return <Navigate to='/login' replace />;
    return <>{props.children}</>;
  }

  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          { /* Login is handled via a modal inside Dashboard */ }

          { /* One-page app: everything resolves to '/' with Overview */ }
          <Route path='/' element={<Dashboard user={user} onLoggedIn={async ()=>{ await refreshUser(); }} /> }>
            <Route index element={<Overview user={user} />} />
            { /* Protected route for logout action */ }
            <Route path='logout' element={<RequireAuth><Logout user={user} onLogout={()=>{ setUser(null); }} /></RequireAuth>} />
            <Route path='*' element={<Navigate to='/' replace />} />
          </Route>
          <Route path='*' element={<Navigate to='/' replace />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}
export default App;
