import { ldJson, type Ld } from '../lib/seo';

/** schema.org structured data for crawlers — renders nothing visible. A data
 *  block (non-JS type) is never executed, so the strict script-src CSP does
 *  not apply to it and scripts/csp-postbuild.ts leaves it inline. */
export default function JsonLd({ data }: { data: Ld | Ld[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(data) }} />;
}
