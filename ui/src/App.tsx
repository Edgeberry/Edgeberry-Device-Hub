/*
 *  Edgeberry Fleet Hub UI
 *  An asset management platform for Edgeberry devices
 * 
 *  Copyright 2024 Sanne 'SpuQ' Santens
 * 
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program. If not, see <https://www.gnu.org/licenses/>.
 * 
 */

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Login from './Pages/Login';
import NotFound from './Pages/404';
import Dashboard from './Pages/Dashboard';
import Assets from './components/DashboardAssets';
import Settings from './components/DashboardSettings';
import DeviceDetail from './Pages/DeviceDetail';
import Health from './Pages/Health';
import { api_user_getAuthenticatedUser } from './api/user';
import { useEffect, useState } from 'react';
import Logout from './Pages/Logout';
import Register from './Pages/Register';
import ActivateAccount from './Pages/ActivateAccount';
import Admin from './Pages/Admin';

function App() {
  const[ user, setUser ] = useState<any|null>(null);
  const[ loading, setLoading ] = useState<boolean>(true);

  useEffect(()=>{
    onLogin();
  },[])

  // on a successful login event
  async function onLogin(){
    setLoading(true);
    // fetch the logged in user
    const result = await api_user_getAuthenticatedUser();
    if( !result.message) setUser(result);
    else setUser(null);

    setLoading(false);
  }

  if( loading ){
    return<div className='App'></div>;
  }

  return (
    <div className="App">
    <BrowserRouter basename={process.env.PUBLIC_URL}>
      <Routes>
      <Route index element={<Navigate to="/devices" />} />
        {/* Fleet Hub: nested routes */}
        <Route path='/login' element={<Login user={user} onLogin={()=>{onLogin()}}/>} />
        <Route path='/register' element={<Register user={user} onLogin={()=>{onLogin()}}/>} />
        <Route path='/activate' element={<ActivateAccount user={user} />} />
        <Route path='/' element={<Dashboard user={user}/>}>
          <Route index element={<Navigate to="/devices" />} />
          <Route path='/admin' element={<Admin user={user} />} />
          <Route path='/logout' element={<Logout user={user} onLogout={()=>{onLogin()}}/>} />
          <Route path='/devices' element={<Assets user={user}/>} />
          <Route path='/devices/:assetId' element={<DeviceDetail user={user} />} />
          <Route path='/settings' element={<Settings user={user} />}/>
          <Route path='/health' element={<Health />}/>
          <Route path='/*' element={<NotFound />} />
        </Route>
        <Route path='*' element={<NotFound />} />
      </Routes>
    </BrowserRouter>
    </div>
  );
}

export default App;
