'use client';
import { useEffect } from 'react';

// The Terminal is now the site's main lander at /. This legacy preview path
// redirects there client-side so old links keep working without prerendering
// the heavy component a second time.
export default function TerminalPreviewRedirect() {
  useEffect(() => { window.location.replace('/'); }, []);
  return null;
}
