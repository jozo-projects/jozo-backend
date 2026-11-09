# Local control/video approval browser integration

This opt-in Jest test runs the actual control and video Vite applications in headless Chromium against a loopback-only Express/Socket.IO server and disposable MongoDB. It never uses the production server. It creates random ephemeral JWT signing material and an admin fixture; no tokens or device proofs should be logged. The Vite servers use an empty temporary env directory and a minimal inherited environment; browser HTTP traffic outside the three loopback origins is aborted. Test ports 17431 and 17432 must be free. The temporary Vite config, browser contexts, Mongo process and servers are removed/stopped after the run.

Prerequisites: sibling checkouts `be-ezinn`, `jozo-music-control`, `jozo-music-video` with their dependencies installed (e.g. `npm ci` in each), Node compatible with their packages, and an available MongoDB binary. From `be-ezinn`:

```sh
npx playwright install chromium --only-shell
JOZO_BROWSER_E2E=1 MONGOMS_SYSTEM_BINARY=/absolute/path/to/mongod npx jest --runInBand --runTestsByPath src/routes/roomDeviceAuthorization.browser.test.ts --silent
```

Alternatively omit `MONGOMS_SYSTEM_BINARY` to let mongodb-memory-server obtain/cache its compatible binary; that first run downloads MongoDB. Installing Chromium also requires network. Neither download contacts Jozo services. The normal Jest run skips this opt-in suite.

The test covers pending UI, actual JWT/role-protected approval API, socket join, fresh socket after refresh, distinct browser contexts and a second room, replacement causing the former browser to show revocation, explicit revocation and expiry UI/approval conflict for both types. It verifies the unaffected room remains connected. The admin action is through the actual API, not admin UI. Mongo expiry is accelerated by changing the disposable record. Music state, presence, Redis, and unrelated services are mocked; the music HTTP probe uses the real authorization middleware. Playback, admin UI, and legacy PIN interaction are not tested. No claim is made about cross-process deployment or production configuration. Vite uses a temporary minimal config with each app's React plugin and alias rather than the repositories' production Vite config.
