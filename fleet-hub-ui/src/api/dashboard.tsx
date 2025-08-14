/* 
 *  Dashboard API
 */

/* 
 *  Get Provisioning parameters
 *  Get the required parameters to configure a device for provisioning
 *  to connect with the Edgeberry Dashboard.
 */
export async function api_dashboard_provisioningParameters(){
    const response = await fetch( window.location.origin+'/api/dashboard/provisioningparameters', {
        method: 'GET',
        headers: {'Content-Type': 'application/json'},
        credentials: 'include'
    });
    try{
        let content = await response.json();
        return content;
    } catch(err:any){
        return {message:err.toString()};
    }
}