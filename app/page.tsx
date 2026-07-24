import TerminalHome from './preview/terminal/TerminalHome';

// The Terminal is the site's main lander. Its full implementation lives in
// app/preview/terminal/TerminalHome.tsx; the legacy /preview/terminal path
// redirects here. The previous homepage is preserved in git (pre-promo d021c3d).
export default function HomePage() {
  return <TerminalHome />;
}
