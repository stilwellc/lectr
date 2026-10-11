/**
 * Pin Date.now / new Date() for a test file whose fixtures are dated (live
 * windows read the wall clock — isOnBlock, liveUntilMs). Without it a dated
 * fixture becomes a time bomb: the Oct 11 2026 nightly's unit-test gate failed
 * because "Oct 10" had passed. Call once at the top of the file.
 */
export function pinClock(iso: string): void {
  const fixed = Date.parse(iso);
  const R = Date;
  class Pinned extends R {
    constructor(...a: ConstructorParameters<typeof Date> | []) {
      // @ts-expect-error spread into the Date constructor
      super(...(a.length ? a : [fixed]));
    }
    static now(): number { return fixed; }
  }
  globalThis.Date = Pinned as unknown as DateConstructor;
}
