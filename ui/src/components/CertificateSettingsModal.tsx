/**
 * CertificateSettingsModal
 *
 * Admin-only modal for the Root CA and the fleet-wide provisioning ("claim")
 * certificate. There is exactly one claim certificate - it isn't a
 * general-purpose certificate store, so this only ever offers Download (for
 * installing it on devices out-of-band) and Renew (which replaces it and
 * revokes the outgoing one - see the confirmation text on that button).
 */
import React, { useEffect, useState } from 'react';
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCloudArrowDown } from '@fortawesome/free-solid-svg-icons';
import { getProvisioningCertFetchEnabled, setProvisioningCertFetchEnabled } from '../api/devicehub';

export default function CertificateSettingsModal(props:{ show:boolean; onClose:()=>void }){
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|undefined>();

  // Claim-certificate HTTP fetch switch
  const [certFetchEnabled, setCertFetchEnabled] = useState<boolean|undefined>();
  const [certFetchBusy, setCertFetchBusy] = useState(false);

  // Root CA - generated automatically in the background at startup (see
  // core-service's D-Bus bootstrap sequence), not something an admin needs
  // to configure. Shown here read-only, since the certificate itself is
  // still useful to grab (e.g. to trust it in other tooling).
  const [root, setRoot] = useState<{ exists: boolean; subject?: string; notAfter?: string }|undefined>();

  // The claim certificate (singular - see module doc comment above)
  const [claim, setClaim] = useState<{ exists: boolean; subject?: string; notAfter?: string }|undefined>();
  const [renewing, setRenewing] = useState(false);

  async function loadClaim(){
    try{
      const d = await (await fetch('/api/settings/certs/provisioning/provisioning')).json();
      if (d?.pem){ setClaim({ exists: true, subject: d?.meta?.subject, notAfter: d?.meta?.notAfter }); }
      else { setClaim({ exists: false }); }
    }catch{ setClaim({ exists: false }); }
  }

  useEffect(()=>{
    if (!props.show) return; // only load when opened
    let mounted = true;
    (async()=>{
      setLoading(true); setError(undefined);
      try{
        const resp = await fetch('/api/settings/certs/root');
        if (resp.ok){
          const d = await resp.json();
          if (mounted) setRoot({ exists: true, subject: d?.meta?.subject, notAfter: d?.meta?.notAfter });
        } else if (resp.status === 404){
          if (mounted) setRoot({ exists: false });
        } else {
          const d = await resp.json().catch(()=>({}));
          if (mounted) setError(d?.error || 'Failed to load root CA');
        }
      }catch{}
      if (mounted) await loadClaim();
      try{
        const s = await getProvisioningCertFetchEnabled();
        if (mounted) setCertFetchEnabled(s?.enabled ?? true);
      }catch{}
      if (mounted) setLoading(false);
    })();
    return ()=>{ mounted = false; };
  },[props.show]);

  async function toggleCertFetch(next: boolean){
    setCertFetchBusy(true);
    try{
      const res = await setProvisioningCertFetchEnabled(next);
      if (res?.ok){ setCertFetchEnabled(res.enabled); }
      else { setError(res?.error || 'Failed to update setting'); }
    } finally { setCertFetchBusy(false); }
  }

  async function renewClaim(){
    const warning = claim?.exists
      ? 'Renew the claim certificate? The old one will be revoked immediately - any device that has not completed its first claim yet and is still holding only the old certificate will be unable to provision until it has the new one. Devices that already finished provisioning are unaffected.'
      : 'Generate the claim certificate?';
    if (!confirm(warning)) return;
    try{
      setRenewing(true);
      const res = await fetch('/api/settings/certs/provisioning/renew', { method:'POST' });
      const d = await res.json().catch(()=>({}));
      if (res.ok){
        await loadClaim();
      } else {
        setError(d?.error || 'Failed to renew claim certificate');
      }
    } finally { setRenewing(false); }
  }

  return (
    <Modal show={props.show} onHide={props.onClose} size='lg' scrollable contentClassName="eb-modal-content">
      <Modal.Header closeButton closeVariant="white">
        <Modal.Title><FontAwesomeIcon icon={faCloudArrowDown} />Provisioning</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant='danger'>{error}</Alert>}

        {/* Claim-certificate HTTP fetch switch */}
        <section style={{marginBottom:16}}>
          <Form.Check
            type='switch'
            id='cert-fetch-switch'
            label='Allow devices to fetch the claim certificate over HTTP'
            checked={certFetchEnabled ?? true}
            disabled={certFetchBusy || certFetchEnabled === undefined}
            onChange={(e)=>toggleCertFetch(e.target.checked)}
          />
          <div className='text-muted' style={{fontSize:13, marginTop:4}}>
            {certFetchEnabled === false ? (
              <>Off: the public download endpoints for the claim certificate are disabled. New devices must have it installed some other way (e.g. flashed at manufacture time) before they can provision.</>
            ) : (
              <>On: any device that can reach this Hub can download the claim certificate and provision itself. Turn this off once you provision devices out-of-band, to close that endpoint.</>
            )}
          </div>
        </section>

        {/* Root CA - background PKI plumbing, not an admin action. Read-only:
            status and a download link for the cert, nothing to configure. */}
        <section style={{marginBottom:16}}>
          <h5>Root CA</h5>
          {loading && !root ? (<Spinner animation='border' size='sm'/>) : (
            <div>
              <div><b>Status:</b> {root?.exists ? 'Present' : 'Not yet generated'}</div>
              {root?.exists ? (
                <div style={{opacity:.85, fontSize:13, marginTop:4}}>
                  <div>Subject: {root?.subject}</div>
                  <div>Valid until: {root?.notAfter}</div>
                  <div style={{marginTop:8}}>
                    <a className='btn btn-outline-primary btn-sm' href='/api/settings/certs/root/download'>Download CA certificate</a>
                  </div>
                </div>
              ) : (
                <div className='text-muted' style={{fontSize:13, marginTop:4}}>
                  Generated automatically the next time core-service starts.
                </div>
              )}
            </div>
          )}
        </section>

        {/* Claim certificate */}
        <section>
          <h5>Claim Certificate</h5>
          <div className='text-muted' style={{fontSize:13, marginBottom:8}}>
            The fleet-wide credential a new device presents to prove it's allowed to bootstrap.
            Install it on devices directly, or leave the HTTP switch above on so devices fetch it themselves.
            It has no fixed expiry that matters day to day - it stays valid until you renew it.
          </div>
          {loading && !claim ? (<Spinner animation='border' size='sm'/>) : (
            <div>
              <div><b>Status:</b> {claim?.exists ? 'Present' : 'Not generated'}</div>
              {claim?.exists && (
                <div style={{opacity:.85, fontSize:13, marginTop:4}}>
                  <div>Subject: {claim?.subject}</div>
                  <div>Valid until: {claim?.notAfter}</div>
                </div>
              )}
            </div>
          )}
          <div className='mt-2 d-flex gap-2'>
            {claim?.exists && (
              <a className='btn btn-outline-primary btn-sm' href='/api/settings/certs/provisioning/provisioning/download'>Download</a>
            )}
            <Button size='sm' variant={claim?.exists ? 'outline-danger' : 'primary'} disabled={renewing} onClick={renewClaim}>
              {renewing ? <Spinner animation='border' size='sm'/> : (claim?.exists ? 'Renew' : 'Generate')}
            </Button>
          </div>
        </section>
      </Modal.Body>
      <Modal.Footer>
        <Button variant='secondary' onClick={props.onClose}>Close</Button>
      </Modal.Footer>
    </Modal>
  );
}
