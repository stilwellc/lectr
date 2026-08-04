import TerminalHome from './preview/terminal/TerminalHome';

// The Terminal is the site's main lander. Its full implementation lives in
// app/preview/terminal/TerminalHome.tsx; the legacy /preview/terminal path
// redirects here. The previous homepage is preserved in git (pre-promo d021c3d).
//
// TerminalHome renders its Colophon OUTSIDE its phase-1 loading gate, so the
// crawlable route map (C4 PRE-GA-5) is in the prerendered HTML without a second
// stand-in footer that has to unmount when data lands — that swap was home's
// worst layout shift. See the note at the Colophon call site.
export default function HomePage() {
  return <TerminalHome />;
}
