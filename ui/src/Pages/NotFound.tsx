/**
 * NotFound Page (404)
 *
 * Purpose: Minimal 404 page for unknown routes handled by the SPA router.
 * Shown when a user navigates to a client route that doesn't exist.
 */
import logo from '../EdgeBerry_Logo_text.svg';

export default function NotFound(){
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'50vh' }}>
      <div style={{ textAlign:'center' }}>
        <img src={logo} alt="Edgeberry" style={{ height:36, marginBottom:12 }} />
        <div style={{ fontSize:24, fontWeight:700, marginBottom:6 }}>404</div>
        <div style={{ color:'#555' }}>Page not found</div>
      </div>
    </div>
  );
}
