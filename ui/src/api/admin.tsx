/*
 *  Admin API
 */

/*
 *  Device onboarding
 *  Adding a new device to the Edgeberry ecosystem
 */
export async function api_admin_onboardDevice( id:string, version:string, batch:string ){
    const response = await fetch( window.location.origin+'/api/admin/onboard',{
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        credentials: 'include',
        body: JSON.stringify({
            id:id,
            hardwareVersion: version,
            batchNumber: batch
        })
    });
    try{
        let content = await response.json();
        content.ok = response.ok;
        return content;
    } catch(err:any){
        return {message:err.toString()};
    }
}

/*
 *  List Devices
 *  List all the devices of the Edgeberry Dashboard
 */
export async function api_admin_getDeviceList(){
    const response = await fetch( window.location.origin+'/api/admin/devices/list',{
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

/*
 *  List Users
 *  List all the users of the Edgeberry Dashboard
 */
export async function api_admin_getUserList(){
    const response = await fetch( window.location.origin+'/api/admin/users/list',{
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
