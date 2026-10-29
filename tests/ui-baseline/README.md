# Seed from prod after shipping: node scripts/ui-shots.mjs --approve (BASE_URL defaults to https://lectr.bid), then commit this directory.

profile-desk-{desktop,mobile}-{light,dark}: /profile on a POPULATED desk — the rig seeds localStorage from the served
payload before navigation (scripts/ui-shots.mjs resolveDeskSeed), so the rooms on DeskRow are in the frame. A re-pin of
the fixture changes which lots are seeded; approve the four frames with the rest.
