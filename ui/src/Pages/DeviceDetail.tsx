/**
 * DeviceDetail Page
 *
 * Purpose: Show raw details for a single device identified by `assetId` (URL param).
 *
 * Data:
 *  - Fetched via `getDevice(assetId)` from `ui/src/api/devicehub.ts`.
 *  - Rendered as JSON for simplicity (MVP).
 *
 * Auth:
 *  - Route protected by `RequireAuth` in `App.tsx`. `props.user` is the authenticated admin.
 */
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card } from 'react-bootstrap';
import { getDevice } from '../api/devicehub';

export default function DeviceDetail(props:{user:any}){
  const { assetId } = useParams();
  const [device, setDevice] = useState<any>(null);
  useEffect(()=>{ (async()=>{ if(assetId){ const d = await getDevice(assetId); setDevice(d); } })(); },[assetId]);
  return (
    <Card>
      <Card.Header>
        <i className="fa-solid fa-microchip me-2"></i>
        Device: {assetId}
      </Card.Header>
      <Card.Body>
        <pre style={{margin:0}}>{JSON.stringify(device,null,2)}</pre>
      </Card.Body>
    </Card>
  );
}
