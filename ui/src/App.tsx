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
import Health from './Pages/Health';
import DeviceDetail from './Pages/DeviceDetail';
import Settings from './Pages/Settings';
import Login from './Pages/Login';
import Logout from './Pages/Logout';
import NotFound from './Pages/NotFound';

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
          { /* Public auth route */ }
          <Route path='/login' element={<Login user={user} onLogin={async ()=>{ await refreshUser(); }} />} />

          { /* Protected app shell */ }
          <Route path='/' element={<RequireAuth><Dashboard user={user}/></RequireAuth> }>
            <Route index element={<Overview user={user} />} />
            <Route path='logout' element={<Logout user={user} onLogout={()=>{ setUser(null); }} />} />
            <Route path='overview' element={<Overview user={user} />} />
            <Route path='devices/:assetId' element={<DeviceDetail user={user} />} />
            <Route path='settings' element={<Settings user={user} />}/>
            <Route path='health' element={<Health />}/>
            <Route path='*' element={<NotFound />} />
          </Route>
          <Route path='*' element={<Navigate to='/' replace />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}
export default App;
