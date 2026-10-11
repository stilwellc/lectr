/**
 * entity-aliases.ts — prints the static entity alias set (app/lib/seo-entities
 * staticEntities, encoded by app/lib/entity/aliases encodeAliases) to stdout.
 * next.config.js runs it once per build / dev server and inlines the result
 * as NEXT_PUBLIC_ENTITY_ALIASES, so every in-app entity link lands on the
 * /p, /e page this same deploy prerenders. Prints '[]' with no entity files.
 */
import { encodedEntityAliases } from '../app/lib/seo-entities';

process.stdout.write(encodedEntityAliases());
