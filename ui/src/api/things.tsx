/*
 *  Things API
 */

/* Get list of all things */
export async function api_things_getThingsList(){
    const response = await fetch( window.location.origin+'/api/things/list',{
        method: 'GET',
        headers: {'Content-Type': 'application/json'},
        credentials: 'include'
    });
    try{
        const content = await response.json();
        return content;
    } catch(err:any){
        return {message:err.toString()};
    }
}

/* Get Thing Description */
export async function api_things_getThingDescription( thingName:string ){
    const response = await fetch( window.location.origin+'/api/things/description?thingName='+thingName,{
        method: 'GET',
        headers: {'Content-Type': 'application/json'},
        credentials: 'include'
    });
    try{
        const content = await response.json();
        return content;
    } catch(err:any){
        return {message:err.toString()};
    }
}

/* Update thing description */
export async function api_things_updateThingDescription( thingName:string, deviceName:string, deviceOwner:string ){
    const response = await fetch( window.location.origin+'/api/things/description?thingName='+thingName,{
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        credentials: 'include',
        body: JSON.stringify({
            deviceOwner: deviceOwner,
            deviceName: deviceName
        })
    });
    try{
        let content = await response.json();
        return content;
    } catch(err:any){
        return {message:err.toString()};
    }
}

/* Get Thing Fleet index */
export async function api_things_getThingIndex( thingName:string ){
    const response = await fetch( window.location.origin+'/api/things/index?thingName='+thingName,{
        method: 'GET',
        headers: {'Content-Type': 'application/json'},
        credentials: 'include'
    });
    try{
        const content = await response.json();
        return content;
    } catch(err:any){
        return {message:err.toString()};
    }
}

export async function api_things_getThingShadow( thingName:string ){
    const response = await fetch( window.location.origin+'/api/things/shadow?thingName='+thingName,{
        method: 'GET',
        headers: {'Content-Type': 'application/json'},
        credentials: 'include'
    });
    try{
        const content = await response.json();
        return content;
    } catch(err:any){
        return {message:err.toString()};
    }
}

/* Invoke Direct Method */
export async function api_things_invokeDirectMethod( deviceId:string, methodName:string, methodBody:string ){
    const response = await fetch( window.location.origin+'/api/things/directmethod',{
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        credentials: 'include',
        body: JSON.stringify({
            deviceId: deviceId,
            methodName: methodName,
            methodBody: methodBody
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

/* Delete thing */
export async function api_things_delete( thingName:string ){
    const response = await fetch( window.location.origin+'/api/things/delete?thingName='+thingName,{
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        credentials: 'include'
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
 *  Claim Thing
 *  Claim a device by UUID to link to the user account
 */
export async function api_things_claim( thingName:string ){
    const response = await fetch( window.location.origin+'/api/things/claim?thingName='+thingName,{
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