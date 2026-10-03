import type { MetadataRoute } from 'next';

// Minimal web-app manifest. Its one job: let iPhone/iPad users "Add to Home
// Screen" as a standalone app — the ONLY way iOS Safari delivers web push
// (iOS 16.4+). Next links it from every page (<link rel="manifest">).
export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'lectr — auction intelligence',
    short_name: 'lectr',
    start_url: '/profile',
    scope: '/',
    display: 'standalone',
    background_color: '#FDFCFC',
    theme_color: '#FDFCFC',
    icons: [
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
      { src: '/brand/lectr-icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
