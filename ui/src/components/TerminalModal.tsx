/**
 * TerminalModal
 *
 * A shell on the Hub server, in a modal. Talks to /ws/terminal, which spawns a
 * PTY per connection and is gated on the same admin session as the rest of the
 * UI (see src/terminal.ts).
 *
 * This is the deliberate path for the rare occasions the server needs hands-on
 * attention - it replaced the power button in the System header, which put
 * "reboot everything" one click from a dashboard people leave open all day.
 */
import { useEffect, useRef, useState } from 'react';
import { Alert, Modal } from 'react-bootstrap';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTerminal } from '@fortawesome/free-solid-svg-icons';

/**
 * Resolve a theme token to a literal colour.
 *
 * xterm renders to a canvas and cannot resolve `var()`, so the tokens have to
 * be read off the document. The fallback covers the theme stylesheet failing
 * to load - better a readable terminal than an invisible one.
 */
function themeColor(token: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return value || fallback;
}

export default function TerminalModal(props: { show: boolean; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!props.show) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'monospace',
      fontSize: 13,
      theme: {
        background: themeColor('--eb-navbar-bg', '#1e1e1e'),
        foreground: themeColor('--eb-navbar-fg', '#f5f5f5'),
        cursor: themeColor('--eb-navbar-fg', '#f5f5f5'),
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());

    let ws: WebSocket | null = null;
    let closing = false;          // set during intentional teardown
    let opened = false;           // did the handshake ever succeed?
    let observer: ResizeObserver | null = null;

    // The modal animates in; opening xterm against a zero-size element gives a
    // 1x1 grid that never recovers, so mount after the transition has settled.
    const mountTimer = window.setTimeout(() => {
      if (!containerRef.current) return;
      term.open(containerRef.current);
      fit.fit();

      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws/terminal`);

      const sendResize = () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      };

      ws.onopen = () => { opened = true; fit.fit(); sendResize(); };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'data') term.write(msg.data);
          if (msg.type === 'exit') { closing = true; props.onClose(); }
        } catch {
          term.write(evt.data);
        }
      };

      ws.onclose = () => {
        if (closing) return;
        closing = true;
        // Never opened means the upgrade was refused - almost always an
        // expired session, since that is the only thing standing in front of
        // this endpoint. Say so instead of closing a blank window.
        if (!opened) setError('Could not open a terminal session. Your login may have expired - reload the page and sign in again.');
        else props.onClose();
      };

      term.onData((data) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'data', data }));
        }
      });

      observer = new ResizeObserver(() => { fit.fit(); sendResize(); });
      observer.observe(containerRef.current);
    }, 150);

    return () => {
      closing = true;
      window.clearTimeout(mountTimer);
      observer?.disconnect();
      if (ws) { ws.onclose = null; ws.onmessage = null; ws.close(); }
      term.dispose();
      setError('');
    };
  }, [props.show]);

  return (
    <Modal show={props.show} onHide={props.onClose} size="xl" centered contentClassName="eb-modal-content">
      <Modal.Header closeButton closeVariant="white">
        <Modal.Title><FontAwesomeIcon icon={faTerminal} />Terminal</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger">{error}</Alert>}
        <div
          ref={containerRef}
          style={{
            height: '60vh',
            background: 'var(--eb-navbar-bg)',
            padding: 8,
            borderRadius: 4,
          }}
        />
      </Modal.Body>
    </Modal>
  );
}
