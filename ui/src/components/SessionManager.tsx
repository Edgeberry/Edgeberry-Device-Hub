import React, { useEffect, useState, useCallback, useRef } from 'react';
import ExpirationWarningModal from './ExpirationWarningModal';

interface SessionManagerProps {
  user: any;
  onSessionExpired: () => void;
}

/**
 * SessionManager Component
 * 
 * Manages JWT session expiration with the following features:
 * - Tracks JWT expiration timestamp
 * - Shows warning modal 20 seconds before expiration with countdown
 * - Automatically logs out when session expires
 * - Checks session validity when page becomes visible (after sleep/inactive)
 * - Allows user to extend session by re-authenticating
 */
export default function SessionManager({ user, onSessionExpired }: SessionManagerProps) {
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [showWarning, setShowWarning] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(20);
  const warningShownRef = useRef(false);
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const warningTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch current session expiration from backend
  const fetchSessionExpiration = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated && data.exp) {
          setExpiresAt(data.exp);
          warningShownRef.current = false;
          setShowWarning(false);
          return data.exp;
        }
      }
      // Session is invalid
      return null;
    } catch (err) {
      console.error('Failed to fetch session expiration:', err);
      return null;
    }
  }, []);

  // Check if session is still valid
  const checkSessionValidity = useCallback(async () => {
    const exp = await fetchSessionExpiration();
    if (!exp) {
      // Session is invalid or expired
      onSessionExpired();
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    if (now >= exp) {
      // Session has expired
      onSessionExpired();
      return false;
    }

    return true;
  }, [fetchSessionExpiration, onSessionExpired]);

  // Handle page visibility change (e.g., after laptop sleep)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && user) {
        // Page became visible, check if session is still valid
        checkSessionValidity();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [user, checkSessionValidity]);

  // Initial session expiration fetch when user logs in
  useEffect(() => {
    if (user) {
      fetchSessionExpiration();
    } else {
      setExpiresAt(null);
      setShowWarning(false);
      warningShownRef.current = false;
    }
  }, [user, fetchSessionExpiration]);

  // Monitor session expiration and show warning
  useEffect(() => {
    if (!expiresAt || !user) {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
        checkIntervalRef.current = null;
      }
      if (warningTimerRef.current) {
        clearTimeout(warningTimerRef.current);
        warningTimerRef.current = null;
      }
      return;
    }

    // Check every second
    const checkExpiration = () => {
      const now = Math.floor(Date.now() / 1000);
      const timeRemaining = expiresAt - now;

      if (timeRemaining <= 0) {
        // Session has expired
        setShowWarning(false);
        onSessionExpired();
        return;
      }

      if (timeRemaining <= 20 && !warningShownRef.current) {
        // Show warning 20 seconds before expiration
        warningShownRef.current = true;
        setSecondsRemaining(timeRemaining);
        setShowWarning(true);
      } else if (showWarning) {
        // Update countdown
        setSecondsRemaining(timeRemaining);
      }
    };

    checkExpiration(); // Initial check
    checkIntervalRef.current = setInterval(checkExpiration, 1000);

    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
        checkIntervalRef.current = null;
      }
    };
  }, [expiresAt, user, onSessionExpired, showWarning]);

  // Handle "Stay Logged In" button - refresh session by re-fetching auth status
  const handleExtendSession = useCallback(async () => {
    const newExp = await fetchSessionExpiration();
    if (newExp) {
      // Session is still valid, close warning
      setShowWarning(false);
      warningShownRef.current = false;
    } else {
      // Session is invalid, log out
      onSessionExpired();
    }
  }, [fetchSessionExpiration, onSessionExpired]);

  if (!user) {
    return null;
  }

  return (
    <ExpirationWarningModal
      show={showWarning}
      secondsRemaining={secondsRemaining}
      onExtendSession={handleExtendSession}
    />
  );
}
