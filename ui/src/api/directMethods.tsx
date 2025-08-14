/*
 *  Direct Method API
 *  For communication with the devices
 */

import { api_things_invokeDirectMethod } from "./things";

/*
 *  Connectivity
 */

// Get connection parameters
export async function direct_getConnectionParameters( deviceId:string ){
    const result = await api_things_invokeDirectMethod( deviceId, 'getConnectionParameters', '');
    if( result.message ) return result;
    return result.payload;
}

// Update connection parameters
export async function direct_updateConnectionParameters( deviceId:string, parameters:any ){
    const result = await api_things_invokeDirectMethod( deviceId, 'updateConnectionParameters', JSON.stringify({parameters: parameters}) );
    if( result.message ) return result;
    return result.payload;
}

// Request reconnect
export async function direct_reconnect( deviceId:string ){
    const result = await api_things_invokeDirectMethod( deviceId, 'reconnect', '');
    if( result.message ) return result;
    return result.payload;
}


// Get provisioning parameters
export async function direct_getProvisioningParameters( deviceId:string ){
    const result = await api_things_invokeDirectMethod( deviceId, 'getProvisioningParameters', '');
    if( result.message ) return result;
    return result.payload;
}

// Update provisioning parameters
export async function direct_updateProvisioningParameters( deviceId:string, parameters:any ){
    const result = await api_things_invokeDirectMethod( deviceId, 'updateProvisioningParameters', JSON.stringify({parameters: parameters}) );
    if( result.message ) return result;
    return result.payload;
}

// Request reprovision
export async function direct_reprovision( deviceId:string ){
    const result = await api_things_invokeDirectMethod( deviceId, 'reprovision', '');
    if( result.message ) return result;
    return result.payload;
}


/*
 *  System
 */

// Request physical system identification (tsjeeptsjeep & bleepbleep)
export async function direct_identifySystem( deviceId:string ){
    const result = await api_things_invokeDirectMethod( deviceId, 'identify', '');
    if( result.message ) return result;
    return result.payload;
}

// Request system reboot
export async function direct_restartSystem( deviceId:string ){
    const result = await api_things_invokeDirectMethod( deviceId, 'reboot', '');
    if( result.message ) return result;
    return result.payload;
}


// Get system application info
export async function direct_getSystemApplicationInfo( deviceId:string ){
    const result = await api_things_invokeDirectMethod( deviceId, 'getSystemApplicationInfo', '');
    if( result.message ) return result;
    return result.payload;
}

// Request system application update
export async function direct_updateSystemApplication( deviceId:string ){
    const result = await api_things_invokeDirectMethod( deviceId, 'updateSystemApplication', '');
    if( result.message ) return result;
    return result.payload;
}

// Get network info
export async function direct_getSystemNetworkInfo( deviceId:string ){
    const result = await api_things_invokeDirectMethod( deviceId, 'getSystemNetworkInfo', '');
    if( result.message ) return result;
    return result.payload;
}

/*
 *  Application
 */

// Get application info
export async function direct_getApplicationInfo( deviceId:string ){
    const result = await api_things_invokeDirectMethod( deviceId, 'getApplicationInfo', '');
    if( result.message ) return result;
    return result.payload;
}

// Restart the application
export async function direct_restartApplication( deviceId:string ){
    const result = await api_things_invokeDirectMethod( deviceId, 'restartApplication', '');
    if( result.message ) return result;
    return result.payload;
}

// Stop the application
export async function direct_stopApplication( deviceId:string ){
    const result = await api_things_invokeDirectMethod( deviceId, 'stopApplication', '');
    if( result.message ) return result;
    return result.payload;
}


