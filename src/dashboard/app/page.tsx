'use client';

import { useState, useEffect } from 'react';
import { LandingPage } from '../landing';
import { App } from '../react-components/App';
import '../landing/styles.css';

/**
 * Detect if running in cloud mode (should show landing page at root)
 * Local mode shows the dashboard directly at root
 */
function detectCloudMode(): boolean {
  if (typeof window === 'undefined') return false;

  const hostname = window.location.hostname;

  // Cloud URL patterns
  if (hostname.includes('agent-relay.com')) return true;
  if (hostname.includes('agentrelay.dev')) return true;

  // Cloud mode flag in meta tags
  const cloudMeta = document.querySelector('meta[name="agent-relay-cloud"]');
  if (cloudMeta?.getAttribute('content') === 'true') return true;

  // Cloud mode in local storage (for development)
  if (localStorage.getItem('agent-relay-cloud-mode') === 'true') return true;

  return false;
}

export default function HomePage() {
  const [isCloud, setIsCloud] = useState<boolean | null>(null);

  useEffect(() => {
    setIsCloud(detectCloudMode());
  }, []);

  // Show nothing while detecting mode to avoid flash
  if (isCloud === null) {
    return null;
  }

  // Cloud mode: show landing page at root
  // Local mode: show dashboard at root
  return isCloud ? <LandingPage /> : <App />;
}
