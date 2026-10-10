/**
 * subcat-labels.ts — human labels for the sub-category taxonomy slugs
 * (subCat kinds + drill splits). Single source: the build pipeline
 * (scripts/lib/sub-cats.ts) and client surfaces both import from here.
 *
 * (Oct 9 labels audit) ONE vocabulary: a raw slug that is the stamp of a clean
 * taxonomy sub (app/lib/taxonomy.ts SUBS) reads EXACTLY that sub's label, so a
 * kind prints the same on a filter chip, a feed row and the lot page ("Singles"
 * on the chip had read "Cards" on the row; "Signed photos" sat on 375 unsigned
 * photos; 430 rows leaked raw slugs — wax, cel-art, programs, pokemon-lots).
 * For a LOT, prefer taxonomy.ts subLabelOf(lot): a slug like 'photos' or
 * 'autographs' is shared by two verticals and only the lot knows which.
 */
import { subLabel } from './taxonomy';

/** Human labels for drill/subCat slugs (UI + board rows). */
export const SUBCAT_LABELS: Record<string, string> = {
  // sports kinds → the Sports Cards / Sports Memorabilia sub labels
  'cards': subLabel('sports-cards', 'singles'), 'card-lots': subLabel('sports-cards', 'lots'),
  'wax': subLabel('sports-cards', 'sealed-wax'),
  'game-used': subLabel('sports-memorabilia', 'game-used'),
  'memorabilia': subLabel('sports-memorabilia', 'equipment'), 'equipment': subLabel('sports-memorabilia', 'equipment'),
  'tickets': subLabel('sports-memorabilia', 'tickets'), 'trophies': subLabel('sports-memorabilia', 'trophies'),
  'programs': subLabel('sports-memorabilia', 'programs'),
  'tcg-other': subLabel('tcg', 'other-tcg'),
  // sports
  'basketball': 'Basketball', 'baseball': 'Baseball', 'football': 'Football',
  'soccer': 'Soccer', 'hockey': 'Hockey', 'boxing-mma': 'Boxing & MMA',
  'golf': 'Golf', 'racing': 'Racing', 'tennis': 'Tennis', 'olympics': 'Olympics',
  'wrestling': 'Wrestling',
  // watches
  'wristwatches': subLabel('watches', 'wristwatches'), 'pocket-watches': subLabel('watches', 'pocket'),
  'clocks': subLabel('watches', 'clocks'), 'watch-accessories': subLabel('watches', 'clocks'),
  'jewelry': 'Jewelry',
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
  // culture kinds — 'photos' / 'autographs' are shared with sports, so they read
  // the vertical-neutral word (subLabelOf(lot) gives the lot's own sub)
  'photos': 'Photos', 'autographs': 'Autographs', 'documents': 'Documents & Letters',
  'worn-personal': 'Wardrobe', 'instruments': 'Instruments', 'awards': 'Awards',
  'props': 'Props', 'posters': 'Posters', 'records': 'Records', 'other': 'Other',
  'cel-art': subLabel('entertainment', 'animation'),
  // culture domains → the Historical / Entertainment labels
  'music': 'Music', 'hollywood': 'Film & TV',
  'political': subLabel('historical', 'political'), 'historic': subLabel('historical', 'historic'),
  'military': subLabel('historical', 'military'), 'royalty': subLabel('historical', 'royalty'),
  'literary': subLabel('historical', 'literary'), 'crime': subLabel('historical', 'crime'),
  'aviation': subLabel('historical', 'aviation'),
  'space-science': 'Space & Science', 'sports': 'Sports Icons',
  // science
  'space': 'Space', 'tech': 'Tech & Scientists', 'meteorites': 'Meteorites', 'fossils': 'Fossils',
  'science': subLabel('space-science', 'science'),
  'apollo': subLabel('space-science', 'apollo'), 'mercury-gemini': subLabel('space-science', 'mercury-gemini'),
  'shuttle-iss': subLabel('space-science', 'shuttle-iss'), 'soviet': subLabel('space-science', 'soviet'),
  'computing': 'Apple & Computing', 'physics-figures': 'Scientists & Physicists',
  'globes': 'Globes', 'telescopes': 'Telescopes', 'microscopes': 'Microscopes',
  'navigation': 'Navigation', 'medical': 'Medical', 'precision-clocks': 'Precision Clocks',
  // card eras — ONE scheme across sports cards and Pokémon: "<Era> (<years>)"
  'era-vintage': 'Vintage (pre-1980)', 'era-classic': 'Classic (1980–1999)', 'era-modern': 'Modern (2000+)',
  'vintage': subLabel('tcg', 'vintage'), 'classic': subLabel('tcg', 'classic'), 'modern': subLabel('tcg', 'modern'),
  'pokemon-cards': 'Singles', 'pokemon-sealed': subLabel('tcg', 'sealed'),
  'pokemon-lots': subLabel('tcg', 'lots'), 'pokemon-memorabilia': subLabel('tcg', 'memorabilia'),
  // art
  'prints': subLabel('fine-art', 'prints'), 'originals': subLabel('fine-art', 'unique'),
  'sculpture': subLabel('fine-art', 'sculpture'), 'photographs': subLabel('fine-art', 'photographs'),
  'books': subLabel('fine-art', 'books'), 'ceramics': subLabel('fine-art', 'ceramics'),
  // design
  'seating': subLabel('design', 'seating'), 'tables': subLabel('design', 'tables'),
  'case-storage': subLabel('design', 'storage'), 'lighting': subLabel('design', 'lighting'),
  'objects': subLabel('design', 'objects'),
  'walnut': 'Walnut', 'teak': 'Teak', 'oak': 'Oak', 'rosewood': 'Rosewood',
  'plywood': 'Plywood', 'steel': 'Steel', 'aluminum': 'Aluminum',
  'fiberglass': 'Fiberglass', 'bronze': 'Bronze', 'glass': 'Glass', 'upholstery': 'Upholstered',
};
export const subCatLabel = (slug: string): string => SUBCAT_LABELS[slug] ?? slug;
