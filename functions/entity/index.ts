/** /entity?id=<id> — the entity dossier shell (a Pokémon, a film, a set, a sub-market name), with
 *  that dossier's own head for link-preview bots (functions/_lib/dossier-share). */
import { dossierPreview, type PagesCtx } from '../_lib/dossier-share';

export const onRequestGet = (ctx: PagesCtx) => dossierPreview(ctx, id => id);
