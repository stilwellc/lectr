import MakerPage from './MakerPage';
import { entitySeed } from '../../components/entity/seed-server';

/**
 * /makers/<slug> — the maker's entity page (./MakerPage). This server shell
 * only hands it the build's header (W30, components/entity/seed-server): the
 * maker's summary and record, read from the served files this deploy ships.
 */
export default async function MakerRoute(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  return <MakerPage seed={entitySeed(`mk:${slug}`)} />;
}
