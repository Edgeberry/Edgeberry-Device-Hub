import React, { useState, useEffect } from 'react';
import { Modal, Button, ProgressBar } from 'react-bootstrap';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';

interface ExpirationWarningModalProps {
  show: boolean;
  secondsRemaining: number;
  onExtendSession: () => void;
}

export default function ExpirationWarningModal({ show, secondsRemaining, onExtendSession }: ExpirationWarningModalProps) {
  const [countdown, setCountdown] = useState(secondsRemaining);

  useEffect(() => {
    setCountdown(secondsRemaining);
  }, [secondsRemaining]);

  useEffect(() => {
    if (!show || countdown <= 0) return;
    
    const timer = setInterval(() => {
      setCountdown(prev => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [show, countdown]);

  const progressPercent = (countdown / 20) * 100;
  const variant = countdown > 10 ? 'warning' : 'danger';

  return (
    <Modal show={show} backdrop="static" keyboard={false} centered size="sm">
      <Modal.Header style={{ borderBottom: 'none', paddingBottom: 0 }}>
        <Modal.Title style={{ fontSize: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
          <FontAwesomeIcon icon={faExclamationTriangle} style={{ color: '#f0ad4e' }} />
          Session Expiring
        </Modal.Title>
      </Modal.Header>
      <Modal.Body style={{ paddingTop: 8 }}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 14, color: '#555', marginBottom: 12 }}>
            Your session will expire in:
          </div>
          <div style={{ fontSize: 32, fontWeight: 'bold', color: variant === 'danger' ? '#d9534f' : '#f0ad4e', marginBottom: 12 }}>
            {countdown}s
          </div>
          <ProgressBar 
            now={progressPercent} 
            variant={variant}
            style={{ height: 8 }}
          />
        </div>
        <div style={{ fontSize: 12, color: '#666', textAlign: 'center' }}>
          You will be automatically logged out when the timer reaches zero.
        </div>
      </Modal.Body>
      <Modal.Footer style={{ borderTop: 'none', paddingTop: 0, justifyContent: 'center' }}>
        <Button variant="primary" onClick={onExtendSession} style={{ minWidth: 120 }}>
          Stay Logged In
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
