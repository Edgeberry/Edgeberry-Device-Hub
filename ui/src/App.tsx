import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './Pages/Dashboard';
import Overview from './Pages/Overview';
import Health from './Pages/Health';
import DeviceDetail from './Pages/DeviceDetail';
import Settings from './Pages/Settings';
import Login from './Pages/Login';
import Register from './Pages/Register';
import Logout from './Pages/Logout';
import NotFound from './Pages/NotFound';

function App(){
  const [user, setUser] = useState<any|null>(null);
  const onLogin = ()=>{}; // placeholder auth hooks

  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          <Route index element={<Navigate to="/" />} />
          <Route path='/login' element={<Login user={user} onLogin={()=>{onLogin()}}/>} />
          <Route path='/register' element={<Register user={user} onLogin={()=>{onLogin()}}/>} />
          <Route path='/' element={<Dashboard user={user}/> }>
            <Route index element={<Overview user={user} />} />
            <Route path='/logout' element={<Logout user={user} onLogout={()=>{onLogin()}}/>} />
            <Route path='/overview' element={<Overview user={user} />} />
            <Route path='/devices/:assetId' element={<DeviceDetail user={user} />} />
            <Route path='/settings' element={<Settings user={user} />}/>
            <Route path='/health' element={<Health />}/>
            <Route path='/*' element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </div>
  );
}
export default App;
