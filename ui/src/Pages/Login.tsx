import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Login(props:{user:any,onLogin:()=>Promise<void>}){
  const nav = useNavigate();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string|null>(null);

  async function submit(e?: React.FormEvent){
    if (e) e.preventDefault();
    setError(null);
    try{
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      if (res.ok){
        // Ensure parent updates auth state (via /api/auth/me) before navigating
        await props.onLogin();
        nav('/', { replace: true });
      } else {
        const d = await res.json().catch(()=>({}));
        setError(d.error || 'Invalid credentials');
      }
    }catch(err:any){ setError(err?.message || 'Login failed'); }
  }

  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh' }}>
      <form onSubmit={submit} style={{ minWidth: 320, maxWidth: 360, width:'100%', border:'1px solid #e5e7eb', borderRadius:12, padding:20, background:'#fff' }}>
        <h2 style={{ fontSize:18, marginTop:0 }}>Admin Login</h2>
        <label style={{ display:'block', fontSize:12, color:'#555' }}>Username</label>
        <input value={username} onChange={e=>setUsername(e.target.value)} placeholder="admin" style={{width:'100%', padding:'10px 12px', border:'1px solid #d1d5db', borderRadius:8}}/>
        <label style={{ display:'block', fontSize:12, color:'#555', marginTop:8 }}>Password</label>
        <input value={password} onChange={e=>setPassword(e.target.value)} type='password' placeholder="••••••" style={{width:'100%', padding:'10px 12px', border:'1px solid #d1d5db', borderRadius:8}}/>
        <div style={{ color:'#b00020', fontSize:12, minHeight:16, marginTop:6 }}>{error}</div>
        <button type='submit' style={{width:'100%', marginTop:12, padding:'10px 12px', border:'1px solid #2563eb', background:'#2563eb', color:'#fff', borderRadius:8}}>Sign in</button>
        <div style={{ color:'#666', fontSize:12, marginTop:8 }}>Registration is disabled.</div>
      </form>
    </div>
  );
}
