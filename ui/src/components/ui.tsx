/*
 * Shared presentational pieces, in the same spirit as Edgeberry-device-software's
 * webui/src/components/ui.tsx - small building blocks used across pages so the
 * visual language (small-caps section labels, label/value rows, portal dropdowns)
 * stays consistent instead of being reinvented per component.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Small caps heading used inside a panel to introduce a sub-section. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="eb-section-title mb-2">{children}</div>;
}

/**
 * Status indicator: a soft-tinted pill with a coloured dot.
 *
 * Replaces the solid Bootstrap badge everywhere a state is reported. A column
 * of saturated fills makes every row shout at the same volume and leaves no
 * colour in reserve for the one row that is actually in trouble; a tint plus a
 * dot keeps the label in dark, readable text and lets `fault` stand out.
 *
 * `tone` is the semantic state, not a colour - callers map their own
 * vocabulary (online/offline/disabled, active/inactive/failed) onto it, so
 * there is one place to change what "degraded" looks like.
 */
export function StatusPill({ tone, label }: {
  tone:  'ok' | 'warn' | 'fault' | 'idle';
  label: ReactNode;
}) {
  // 'idle' is the base .eb-status styling, so it adds no modifier class.
  const toneClass = tone === 'idle' ? '' : ` eb-status-${tone}`;
  return <span className={`eb-status${toneClass}`}>{label}</span>;
}

/** A user-authored label (a group name, a tag) - deliberately uncoloured, so
 *  it is not mistaken for a state the system is reporting. */
export function Chip({ children }: { children: ReactNode }) {
  return <span className="eb-chip">{children}</span>;
}

/** Label/value row for read-only detail lists (server info, cert metadata, ...). */
export function Field({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="d-flex gap-3 py-1" style={{ fontSize: '0.85rem' }}>
      <span className="eb-muted" style={{ minWidth: 130, flexShrink: 0 }}>{label}</span>
      <span className={mono ? 'eb-mono' : undefined} style={{ wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
}

/** Subtle panel used for inline confirmations, expanded detail, or grouped forms. */
export function InsetPanel({ children }: { children: ReactNode }) {
  return (
    <div className="eb-inset mt-3">{children}</div>
  );
}

/**
 * A dropdown anchored under its trigger and rendered into document.body, so the
 * navbar's stacking context never clips it. Mirrors the pattern used for the
 * device/application menus in Edgeberry-device-software's webui.
 */
export function PortalMenu({ trigger, title, buttonClassName, buttonStyle, children }: {
  trigger:          ReactNode;
  title:            string;
  buttonClassName?: string;
  buttonStyle?:     React.CSSProperties;
  children:         (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  function toggle() {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOpen(v => !v);
  }

  useEffect(() => {
    if (!open) return;
    function closeOnPress(e: PointerEvent) {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', closeOnPress);
    return () => document.removeEventListener('pointerdown', closeOnPress);
  }, [open]);

  const menu = open ? createPortal(
    <ul
      className="eb-menu"
      style={{
        position: 'fixed', top: pos.top, right: pos.right, zIndex: 1060,
        listStyle: 'none', margin: 0, padding: '0.25rem 0',
        backgroundColor: 'var(--eb-navbar-bg)', border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '0.375rem', minWidth: 180,
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
      }}
      onPointerDown={e => e.stopPropagation()}
    >
      {children(() => setOpen(false))}
    </ul>,
    document.body
  ) : null;

  return (
    <>
      <button
        ref={btnRef}
        className={buttonClassName ?? 'btn btn-sm d-flex align-items-center'}
        style={{ lineHeight: 1, background: 'none', border: 'none', padding: '0.25rem 0.5rem', ...buttonStyle }}
        onClick={toggle}
        title={title}
        type="button"
      >
        {trigger}
      </button>
      {menu}
    </>
  );
}
