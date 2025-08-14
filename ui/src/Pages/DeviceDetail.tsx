import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card } from 'react-bootstrap';
import { getDevice } from '../api/fleethub';

export default function DeviceDetail(props:{user:any}){
  const { assetId } = useParams();
  const [device, setDevice] = useState<any>(null);
  useEffect(()=>{ (async()=>{ if(assetId){ const d = await getDevice(assetId); setDevice(d); } })(); },[assetId]);
  return (
    <Card>
      <Card.Header>Device: {assetId}</Card.Header>
      <Card.Body>
        <pre style={{margin:0}}>{JSON.stringify(device,null,2)}</pre>
      </Card.Body>
    </Card>
  );
}
