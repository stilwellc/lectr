/**
 * subcat-labels.ts — human labels for the sub-category taxonomy slugs
 * (subCat kinds + drill splits). Single source: the build pipeline
 * (scripts/lib/sub-cats.ts) and client surfaces both import from here.
 */
/** Human labels for drill/subCat slugs (UI + board rows). */
export const SUBCAT_LABELS: Record<string, string> = {
  // sports kinds
  'cards': 'Cards', 'game-used': 'Game-used', 'memorabilia': 'Memorabilia',
  'tickets': 'Tickets', 'trophies': 'Trophies & awards',
  // sports
  'basketball': 'Basketball', 'baseball': 'Baseball', 'football': 'Football',
  'soccer': 'Soccer', 'hockey': 'Hockey', 'boxing-mma': 'Boxing & MMA',
  'golf': 'Golf', 'racing': 'Racing', 'tennis': 'Tennis', 'olympics': 'Olympics',
  'wrestling': 'Wrestling',
  // watches
  'wristwatches': 'Wristwatches', 'pocket-watches': 'Pocket watches', 'clocks': 'Clocks',
  'daytona': 'Daytona', 'submariner': 'Submariner', 'gmt-master': 'GMT-Master',
  'day-date': 'Day-Date', 'datejust': 'Datejust', 'explorer': 'Explorer',
  'sea-dweller': 'Sea-Dweller', 'yacht-master': 'Yacht-Master', 'milgauss': 'Milgauss',
  'air-king': 'Air-King', 'cellini': 'Cellini', 'oyster-perpetual': 'Oyster Perpetual',
  'nautilus': 'Nautilus', 'aquanaut': 'Aquanaut', 'calatrava': 'Calatrava',
  'world-time': 'World Time', 'ellipse': 'Ellipse', 'gondolo': 'Gondolo',
  'twenty-4': 'Twenty~4', 'perpetual-calendar': 'Perpetual Calendar',
  'chronograph': 'Chronograph', 'royal-oak': 'Royal Oak', 'millenary': 'Millenary',
  'jules-audemars': 'Jules Audemars', 'tank': 'Tank', 'santos': 'Santos',
  'panthere': 'Panthère', 'crash': 'Crash', 'ballon-bleu': 'Ballon Bleu',
  'pasha': 'Pasha', 'tortue': 'Tortue', 'baignoire': 'Baignoire',
  'speedmaster': 'Speedmaster', 'seamaster': 'Seamaster', 'constellation': 'Constellation',
  'de-ville': 'De Ville',
  // culture kinds + domains
  'photos': 'Signed photos', 'documents': 'Documents & letters', 'autographs': 'Autographs',
  'worn-personal': 'Worn & personal', 'instruments': 'Instruments', 'awards': 'Awards',
  'props': 'Props', 'posters': 'Posters', 'records': 'Records', 'other': 'Other',
  'music': 'Music', 'hollywood': 'Hollywood & film', 'political': 'Presidents & political',
  'historic': 'Historic figures', 'military': 'Military & aviation', 'royalty': 'Royalty & society',
  'literary': 'Arts & letters', 'space-science': 'Space & science figures', 'sports': 'Sports icons',
  // science
  'space': 'Space', 'tech': 'Tech & scientists', 'meteorites': 'Meteorites', 'fossils': 'Fossils',
  'apollo': 'Apollo', 'mercury-gemini': 'Mercury & Gemini', 'shuttle-iss': 'Shuttle & ISS',
  'soviet': 'Soviet program', 'computing': 'Apple & computing', 'physics-figures': 'Scientists & physicists',
  'globes': 'Globes', 'telescopes': 'Telescopes', 'microscopes': 'Microscopes',
  'navigation': 'Navigation', 'medical': 'Medical', 'precision-clocks': 'Precision clocks',
  // art
  'prints': 'Prints & multiples', 'originals': 'Original works', 'sculpture': 'Sculpture & ceramics',
  'photographs': 'Photographs', 'books': 'Books',
  // design
  'seating': 'Seating', 'tables': 'Tables & desks', 'case-storage': 'Case & storage',
  'lighting': 'Lighting', 'objects': 'Objects',
  'walnut': 'Walnut', 'teak': 'Teak', 'oak': 'Oak', 'rosewood': 'Rosewood',
  'plywood': 'Plywood', 'steel': 'Steel', 'aluminum': 'Aluminum',
  'fiberglass': 'Fiberglass', 'bronze': 'Bronze', 'glass': 'Glass', 'upholstery': 'Upholstered',
};
export const subCatLabel = (slug: string): string => SUBCAT_LABELS[slug] ?? slug;
