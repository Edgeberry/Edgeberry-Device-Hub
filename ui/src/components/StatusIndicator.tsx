import React from 'react';

export default function StatusIndicator(props:{ type:'success'|'danger'|'secondary'|'warning', message?:string, noText?:boolean }){
  const { type, message, noText } = props;
  const color = type === 'success' ? '#28a745' : type === 'danger' ? '#dc3545' : type === 'warning' ? '#ffc107' : '#6c757d';
  return (
    <span style={{ display:'inline-flex', alignItems:'center' }}>
      <span style={{ width:10, height:10, borderRadius:'50%', backgroundColor: color, display:'inline-block', marginRight: noText?0:6 }} />
      {!noText && (message || '')}
    </span>
  );
}
