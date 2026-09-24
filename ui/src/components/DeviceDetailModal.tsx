import React, { useEffect, useState } from 'react';
import { Button, Modal, Alert, Spinner } from 'react-bootstrap';
import { Field, StatusPill, Chip } from './ui';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMicrochip } from '@fortawesome/free-solid-svg-icons';
import { getDevice, getDeviceEvents, getDeviceTwin, decommissionDevice, deleteWhitelistByDevice } from '../api/devicehub';

/*
 *  A device has two sources of truth, and this dialog used to blur them.
 *
 *  The registry is what the Hub decided: identity, certificates, lifecycle.
 *  The twin is what the device says about itself, over MQTT, and it can be
 *  stale or absent while the registry entry is perfectly fine. They live in
 *  separate databases, keyed differently (uuid vs the assigned MQTT name).
 *
 *  Everything below is built to keep that difference visible. It used to be a
 *  raw JSON dump of the registry row labelled "Device" — which reads as live
 *  device data, and is not — and which rendered the application token in plain
 *  text. Every card now says where its contents came from, and reported data
 *  says how old it is: a twin holds latest-value with no freshness of its own,
 *  so a dead device's last state is otherwise indistinguishable from live.
 */

/** Age of an ISO timestamp, coarsely. */
function formatAge( iso:string ):string{
  const sec = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if(!Number.isFinite(sec)) return '';
  if(sec < 120)          return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if(min < 60)           return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if(hr < 48)            return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function formatWhen( value?:string|null ):string{
  if(!value) return '—';
  const t = Date.parse(value);
  if(!Number.isFinite(t)) return String(value);
  return new Date(t).toLocaleString();
}

const MEDIUM_LABEL:Record<string,string> = {
  wifi: 'Wi-Fi', ethernet: 'Ethernet', other: 'Other', none: 'No link',
};

/**
 * Signal strength as a bar plus its number.
 *
 * NetworkManager's 0-100 scale, not dBm — it is already the "how good is
 * this" figure, so it needs no conversion. Banded rather than a gradient so
 * the colour means something: below ~35 a link is usually dropping packets.
 */
function SignalMeter({ strength, width = 64 }:{ strength:number; width?:number }){
  const pct  = Math.max(0, Math.min(100, strength));
  const tone = pct >= 60 ? 'var(--eb-ok)' : pct >= 35 ? 'var(--eb-warn)' : 'var(--eb-fault)';
  return (
    <span className="d-inline-flex align-items-center gap-2">
      <span style={{ display:'inline-block', width, height:6, borderRadius:3,
                     background:'var(--eb-surface-sunken)', border:'1px solid var(--eb-line)',
                     overflow:'hidden', verticalAlign:'middle' }}>
        <span style={{ display:'block', width:`${pct}%`, height:'100%', background:tone }} />
      </span>
      <span>{pct}%</span>
    </span>
  );
}

/*
 *  Where a card's contents came from.
 *
 *  'hub' uses the plain Chip — deliberately uncoloured, because provenance is
 *  not a state the system is reporting. 'device' carries the age, since that is
 *  the only thing telling a live reading from a fossil.
 */
function SourceChip({ kind, age }:{ kind:'hub'|'device'|'stale'; age?:string|null }){
  if(kind === 'device'){
    return <StatusPill tone="ok" label={age ? `Device · ${age}` : 'Device'} />;
  }
  if(kind === 'stale'){
    return <StatusPill tone="warn" label={age ? `Hub · frozen ${age}` : 'Hub · frozen'} />;
  }
  return <Chip>Hub registry</Chip>;
}

function DetailCard({ title, chip, children }:{
  title: React.ReactNode;
  chip?: React.ReactNode;
  children: React.ReactNode;
}){
  return (
    <div style={{ border:'1px solid var(--eb-line)', borderRadius:'var(--eb-radius)',
                  background:'var(--eb-surface)', overflow:'hidden' }}>
      <div className="d-flex align-items-center gap-2"
           style={{ padding:'0.6rem 1rem', borderBottom:'1px solid var(--eb-surface-sunken)' }}>
        <span style={{ fontSize:'0.8125rem', fontWeight:700, flexGrow:1 }}>{title}</span>
        {chip}
      </div>
      <div style={{ padding:'0.6rem 1rem' }}>{children}</div>
    </div>
  );
}

/** Two columns of Fields that collapse to one on a narrow dialog. */
function Split({ left, right }:{ left:React.ReactNode; right:React.ReactNode }){
  return (
    <div className="d-flex flex-wrap" style={{ columnGap:'1.75rem' }}>
      <div style={{ flex:'1 1 240px', minWidth:0 }}>{left}</div>
      <div style={{ flex:'1 1 240px', minWidth:0 }}>{right}</div>
    </div>
  );
}

function Tile({ label, value, tone, sub }:{
  label: string;
  value: React.ReactNode;
  tone?: 'warn'|'fault';
  sub?: React.ReactNode;
}){
  const toneClass = tone === 'fault' ? ' eb-metric-value-fault' : tone === 'warn' ? ' eb-metric-value-warn' : '';
  return (
    <div className="eb-tile" style={{ flex:'1 1 130px', minWidth:0 }}>
      <div className="eb-metric-label">{label}</div>
      <div className={`eb-metric-value${toneClass}`}
           style={{ fontSize:'1.05rem', marginTop:'0.25rem' }}>{value}</div>
      <div className="eb-subtle" style={{ fontSize:'0.75rem', marginTop:'0.15rem' }}>{sub ?? ' '}</div>
    </div>
  );
}

/*
 *  The four questions somebody opens this dialog to answer, before they read
 *  anything else: is it there, is it talking to us, how is its link, and is
 *  the application healthy.
 */
function StatusStrip({ device, conn, app, network }:{
  device:any; conn:any; app:any; network:any;
}){
  const c = conn ?? {};
  const a = app ?? {};
  const wifi = network?.wifi ?? null;

  const online = device?.online === true;
  const hubUp  = c.connection === 'connected';

  const health = typeof a.health === 'string' ? a.health : 'unknown';
  const healthTone: 'warn'|'fault'|undefined =
    health === 'warning' ? 'warn' :
    (health === 'error' || health === 'critical' || health === 'emergency') ? 'fault' : undefined;

  let linkValue: React.ReactNode = '—';
  let linkSub:   React.ReactNode = 'not reported';
  if(network){
    if(network.medium === 'wifi' && typeof wifi?.strength === 'number'){
      linkValue = <SignalMeter strength={wifi.strength} width={48} />;
      linkSub   = wifi.ssid ?? 'Wi-Fi';
    } else {
      linkValue = MEDIUM_LABEL[network.medium] ?? network.medium ?? '—';
      linkSub   = network.interface ?? '';
    }
  }

  return (
    <div className="d-flex flex-wrap gap-2 mb-3">
      <Tile label="Presence" value={online ? 'Online' : 'Offline'} tone={online ? undefined : 'fault'}
            sub={online ? 'reporting' : (device?.last_seen ? `last seen ${formatAge(device.last_seen)}` : 'never seen')} />
      <Tile label="Hub link" value={hubUp ? 'Connected' : (c.connection ?? 'unknown')}
            tone={hubUp ? undefined : 'fault'}
            sub={c.network ? `network ${c.network}` : 'not reported'} />
      <Tile label="Link" value={linkValue} sub={linkSub} />
      <Tile label="Application" value={health === 'unknown' ? '—' : health} tone={healthTone}
            sub={a.version && a.version !== 'unknown' ? `v${a.version}` : 'version not reported'} />
    </div>
  );
}

function NetworkBody({ network }:{ network:any }){
  /*
   *  A device that has never reported one is the normal case for most of the
   *  fleet, not an error: network reporting arrived in a later device-software
   *  version, and a device only fills this in once it reconnects afterwards.
   */
  if(!network || typeof network !== 'object'){
    return (
      <div className="eb-subtle" style={{ fontSize:'0.8125rem' }}>
        Not reported. This device is running a version of the device software from
        before network reporting, or has not reconnected since being updated.
      </div>
    );
  }

  const wifi = network.wifi && typeof network.wifi === 'object' ? network.wifi : null;
  const ipv4 = network.ipv4 && typeof network.ipv4 === 'object' ? network.ipv4 : {};

  // Band, channel and negotiated rate are three facts about one radio link —
  // three separate rows would push the fields that matter off the top.
  const radio = wifi ? [
    wifi.band,
    wifi.channel != null ? `channel ${wifi.channel}` : null,
    wifi.bitrate != null ? `${(wifi.bitrate / 1000).toFixed(1)} Mb/s` : null,
  ].filter(Boolean).join(' · ') : '';

  return (
    <Split
      left={<>
        <Field label="Medium" value={MEDIUM_LABEL[network.medium] ?? network.medium ?? 'unknown'} />
        {wifi?.ssid             && <Field label="SSID" value={wifi.ssid} />}
        {wifi?.strength != null && <Field label="Signal" value={<SignalMeter strength={wifi.strength} />} />}
        {radio                  && <Field label="Radio" value={radio} />}
        {wifi?.security         && <Field label="Security" value={String(wifi.security).toUpperCase()} />}
      </>}
      right={<>
        {ipv4.address && <Field label="IPv4" value={ipv4.prefix != null ? `${ipv4.address}/${ipv4.prefix}` : ipv4.address} mono />}
        {ipv4.gateway && <Field label="Gateway" value={ipv4.gateway} mono />}
        {Array.isArray(ipv4.dns) && ipv4.dns.length > 0 && <Field label="DNS" value={ipv4.dns.join(', ')} mono />}
        {network.interface && <Field label="Interface" value={network.interface} mono />}
        {network.mac       && <Field label="MAC" value={network.mac} mono />}
        {wifi?.bssid       && <Field label="BSSID" value={wifi.bssid} mono />}
      </>}
    />
  );
}

/*
 *  What the device declared about itself when it claimed its identity.
 *
 *  `devices.meta` is a free-form blob the device sends in its provisioning
 *  request. It is written once and never updated, and nothing in the Hub reads
 *  it — it informs no decision anywhere. It is kept, and shown, for the one
 *  thing the twin cannot give: a device that provisioned and never reported
 *  since has no twin at all, and this is then the only record of what it is.
 *  For everything else the twin is both live and more accurate.
 *
 *  Only fields worth comparing are compared. `meta.platform` is the hardcoded
 *  literal 'edgeberry' on every device — a platform family, not a hardware
 *  model — while the twin's system.platform is /proc/device-tree/model. Putting
 *  those side by side reported a conflict on every device forever, which is
 *  what this card did on its first outing. `meta.uuid` is dropped too: the Hub
 *  injects it, and Identity above already shows it.
 *
 *  What does compare meaningfully is firmware against the reported version, and
 *  board against the reported board — same units, same source, so a difference
 *  is real: the device has been updated, or the hardware behind this identity
 *  changed.
 */
function ProvisioningCard({ meta, system }:{ meta:any; system:any }){
  if(!meta || typeof meta !== 'object') return null;

  const rows: Array<{ label:string; was:any; now:any }> = [
    { label: 'Firmware', was: meta.firmware, now: system?.version },
    { label: 'Board',    was: meta.model,    now: system?.board },
  ].filter(r => r.was);

  if(rows.length === 0) return null;

  const drifted = rows.some(r => r.now && String(r.was).toLowerCase() !== String(r.now).toLowerCase());

  return (
    <DetailCard
      title="At provisioning"
      chip={<SourceChip kind="stale" age={meta.startedAt ? formatAge(meta.startedAt) : null} />}
    >
      <div className="eb-muted" style={{ fontSize:'0.8125rem', marginBottom:'0.5rem', lineHeight:1.5 }}>
        What the device declared when it enrolled. Never updated since — for a device
        that has reported a twin, the values above are the current ones.
      </div>
      {rows.map(r => {
        const changed = Boolean(r.now && String(r.was).toLowerCase() !== String(r.now).toLowerCase());
        return (
          <Field key={r.label} label={r.label} value={
            <span>
              <span className="eb-mono">{r.was}</span>
              {changed && <span style={{ color:'var(--eb-warn-text)' }}> → now <span className="eb-mono">{r.now}</span></span>}
            </span>
          } />
        );
      })}
      {!drifted && (
        <div className="eb-subtle" style={{ fontSize:'0.75rem', marginTop:'0.35rem' }}>
          Unchanged since enrollment.
        </div>
      )}
    </DetailCard>
  );
}

/*
 *  Registry events for this device — devicehub.db's own table, keyed by uuid.
 *
 *  Deliberately not the connection/heartbeat history: that lives in twin.db
 *  keyed by the device's name, and no endpoint exposes it. Presence in the
 *  strip above already comes from it, which is the part anyone reads.
 */
function ActivityBody({ events }:{ events:any[] }){
  if(!events?.length){
    return <div className="eb-subtle" style={{ fontSize:'0.8125rem' }}>No registry events recorded for this device.</div>;
  }
  return (
    <div style={{ maxHeight:260, overflowY:'auto' }}>
      {events.map((e:any, i:number) => (
        <div key={e?.id ?? i} className="d-flex gap-3 align-items-baseline"
             style={{ padding:'0.3rem 0',
                      borderBottom: i === events.length - 1 ? 'none' : '1px solid var(--eb-surface-sunken)' }}>
          <span className="eb-mono eb-muted" style={{ fontSize:'0.75rem', flexShrink:0 }}>{formatWhen(e?.ts)}</span>
          <span style={{ fontSize:'0.8125rem', flexShrink:0 }}>{e?.event_type ?? 'event'}</span>
          <span className="eb-mono eb-subtle" style={{ fontSize:'0.75rem', wordBreak:'break-all' }}>
            {e?.payload != null ? (typeof e.payload === 'string' ? e.payload : JSON.stringify(e.payload)) : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function DeviceDetailModal(props:{
  deviceId: string,
  show: boolean,
  onClose: ()=>void,
}){
  const { deviceId, show, onClose } = props;
  const [device, setDevice] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [twin, setTwin] = useState<any>(null);
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{text:string,type:'success'|'danger'|''}>({text:'',type:''});

  useEffect(()=>{
    let mounted = true;
    (async()=>{
      if(!deviceId) return;
      // Drop the previous device's twin before fetching this one's, so the
      // modal cannot show one device's network under another's name while the
      // request is in flight. A revealed token is re-hidden for the same reason.
      setTwin(null);
      setShowToken(false);
      try{ const d = await getDevice(deviceId); if(mounted) setDevice(d); }catch{}
      try{ const e = await getDeviceEvents(deviceId); if(mounted) setEvents(Array.isArray(e?.events)? e.events : []); }catch{}
      // Separate from the device record: the twin is reported by the device
      // itself, so it can be absent or stale while the registry entry is fine.
      // Failing to load it must not blank the rest of the modal.
      try{ const t = await getDeviceTwin(deviceId); if(mounted) setTwin(t); }catch{}
    })();
    return ()=>{ mounted=false; };
  },[deviceId, show]);

  useEffect(()=>{
    if(!msg.text) return; const t = setTimeout(()=> setMsg({text:'',type:''}), 3000); return ()=> clearTimeout(t);
  },[msg]);

  async function onDecommission(){
    if(!window.confirm('Decommission this device? This will remove it from the device list.')) return;
    try{
      setBusy(true);
      const res:any = await decommissionDevice(deviceId);
      const wlCount = Number(res?.whitelist_entries || 0);
      if (wlCount > 0) {
        const doWipe = window.confirm(`There are ${wlCount} whitelist entr${wlCount===1?'y':'ies'} for this device. Remove them now?`);
        if (doWipe) {
          await deleteWhitelistByDevice(deviceId);
        }
      }
      // Close the modal after successful decommission
      onClose();
    }catch(err:any){
      setMsg({ text: err?.toString?.() || 'Failed to decommission device', type: 'danger' });
    } finally{
      setBusy(false);
    }
  }

  /*
   *  Reported state, tolerant of both shapes.
   *
   *  Current device software publishes one top-level key per section. Older
   *  software published the whole document under 'system', so the sections also
   *  appear nested inside it — prefer the flat keys and fall back, so a device
   *  that has not been updated still renders rather than showing nothing.
   */
  const doc      = twin?.reported?.doc ?? null;
  const nested   = doc?.system ?? null;
  const system   = (doc?.system && doc.system.platform !== undefined) ? doc.system : (nested?.system ?? null);
  const conn     = doc?.connection  ?? nested?.connection  ?? null;
  const appState = doc?.application ?? nested?.application ?? null;
  const network  = doc?.network ?? null;
  const reportedAge = network?.updatedAt ? formatAge(network.updatedAt) : null;

  return (
    <Modal show={show} onHide={onClose} size="lg" centered scrollable contentClassName="eb-modal-content">
      {/* Header is a bare Modal.Title, like every other modal here. It used to
          wrap the title in a div with the Hardware ID beneath it, which made
          this one header two lines tall while the rest were one - the identity
          line moved into the body instead.

          No role assigned yet: the hardware uuid is the only identity there is
          to show, so it takes the title rather than a vague "Unassigned"
          placeholder (that's fine in a table row of many devices, but this is
          the one place looking at a single device). */}
      <Modal.Header closeButton closeVariant="white">
        <Modal.Title><FontAwesomeIcon icon={faMicrochip} />{device ? (device.role || device.uuid) : deviceId}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {msg.text && (<Alert variant={msg.type==='danger'?'danger':'success'}>{msg.text}</Alert>)}
        {!device && (<div className="text-center p-4"><Spinner animation="border" size="sm"/> Loading…</div>)}
        {device && (
          <>
            <StatusStrip device={device} conn={conn} app={appState} network={network} />

            <div className="d-flex flex-column gap-3">

              <DetailCard title="Identity" chip={<SourceChip kind="hub" />}>
                <Split
                  left={<>
                    {device.role && <Field label="Role" value={device.role} />}
                    <Field label="Device name" value={device.name ?? '—'} mono />
                    {/* Why this one matters: it is the MQTT client ID, the
                        certificate CN, and the key the twin is stored under. */}
                    <div className="eb-subtle" style={{ fontSize:'0.75rem', marginLeft:'130px', marginTop:'-4px', marginBottom:'4px' }}>
                      MQTT client ID · certificate CN · twin key
                    </div>
                    <Field label="Hardware ID" value={device.uuid} mono />
                  </>}
                  right={<>
                    <Field label="Registered" value={formatWhen(device.created_at)} />
                    {device.token && (
                      /* Used to be rendered in full inside a JSON dump. It is an
                         application credential; putting it on screen should take
                         a deliberate act. */
                      <Field label="App token" value={
                        <span className="d-inline-flex align-items-center gap-2">
                          <span className="eb-mono">{showToken ? device.token : '••••••••••••'}</span>
                          <button type="button" className="btn btn-sm btn-outline-secondary py-0 px-2"
                                  style={{ fontSize:'0.75rem' }}
                                  onClick={()=> setShowToken(v => !v)}>
                            {showToken ? 'Hide' : 'Reveal'}
                          </button>
                        </span>
                      } />
                    )}
                  </>}
                />
              </DetailCard>

              <DetailCard title="Network" chip={<SourceChip kind="device" age={reportedAge} />}>
                <NetworkBody network={network} />
              </DetailCard>

              {system && (
                <DetailCard title="System" chip={<SourceChip kind="device" age={reportedAge} />}>
                  <Split
                    left={<>
                      {system.platform && <Field label="Platform" value={system.platform} />}
                      {system.board && <Field label="Board" value={
                        system.board_version ? `${system.board} rev ${system.board_version}` : system.board
                      } />}
                    </>}
                    right={<>
                      {system.version && <Field label="Software" value={system.version} />}
                      {system.state   && <Field label="State" value={system.state} />}
                    </>}
                  />
                </DetailCard>
              )}

              {appState && (
                <DetailCard title="Application" chip={<SourceChip kind="device" age={reportedAge} />}>
                  <Split
                    left={<>
                      {appState.health && <Field label="Health" value={appState.health} />}
                      {appState.state  && <Field label="Lifecycle" value={appState.state} />}
                    </>}
                    right={
                      <Field label="Version" value={
                        appState.version && appState.version !== 'unknown'
                          ? appState.version
                          : <span className="eb-subtle">not reported</span>
                      } />
                    }
                  />
                </DetailCard>
              )}

              <ProvisioningCard meta={device.meta} system={system} />

              <DetailCard title={`Activity${events?.length ? ` (${events.length})` : ''}`} chip={<SourceChip kind="hub" />}>
                <ActivityBody events={events} />
              </DetailCard>

            </div>

            {/* Decommissioning lives with the content it acts on, not in the
                footer next to a dismiss button. "Close" is gone entirely -
                the header's X already does that, and a dialog does not need
                two ways to be dismissed. */}
            <div className="eb-danger-zone">
              <div>
                <div className="eb-section-title mb-1">Decommission</div>
                <div className="eb-muted" style={{ fontSize: '0.85rem' }}>
                  Removes this device, its twin and its history from the Hub. Its hardware ID can be whitelisted again later.
                </div>
              </div>
              <Button variant="outline-danger" onClick={onDecommission} disabled={busy}>
                {busy
                  ? <><Spinner animation="border" size="sm" className="me-2" />Removing…</>
                  : 'Decommission'}
              </Button>
            </div>
          </>
        )}
      </Modal.Body>
    </Modal>
  );
}
