/** /player?id=<slug> — the player dossier shell, with the player's own head for link-preview bots
 *  (functions/_lib/dossier-share). Player ids are 'pl:<slug>'. */
import { dossierPreview, type PagesCtx } from '../_lib/dossier-share';

export const onRequestGet = (ctx: PagesCtx) => dossierPreview(ctx, id => `pl:${id}`);
