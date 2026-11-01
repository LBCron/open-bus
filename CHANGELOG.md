# Changelog

## [0.61.1](https://github.com/open-artifacts-ai/open-bus/compare/v0.61.0...v0.61.1) (2026-11-01)


### Bug Fixes

* **daemon:** attest Codex code-mode calls (C27) ([#384](https://github.com/open-artifacts-ai/open-bus/issues/384)) ([ec25ffb](https://github.com/open-artifacts-ai/open-bus/commit/ec25ffbb8c01932c15284bd684674e76c011b117))

## [0.61.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.60.0...v0.61.0) (2026-10-29)


### Features

* **dashboard:** Set up with an agent card and --hub install command (AS2) ([#338](https://github.com/open-artifacts-ai/open-bus/issues/338)) ([4d41150](https://github.com/open-artifacts-ai/open-bus/commit/4d4115080da149a8fcf3cfee8c481870ed28b89b))

## [0.60.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.59.0...v0.60.0) (2026-10-29)


### Features

* **server:** per-instance GET /llms.txt; 404 unknown .txt/.md paths ([#336](https://github.com/open-artifacts-ai/open-bus/issues/336)) ([8658c45](https://github.com/open-artifacts-ai/open-bus/commit/8658c45d0adae23fce0f1677d52504a524e9f615))

## [0.59.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.58.1...v0.59.0) (2026-10-29)


### Features

* **link:** /link flow for linking an app to the bus (AC4c) ([#331](https://github.com/open-artifacts-ai/open-bus/issues/331)) ([0d9df7f](https://github.com/open-artifacts-ai/open-bus/commit/0d9df7f4836cfc3ea7ef246c7e8822cd650f07c5))

## [0.58.1](https://github.com/open-artifacts-ai/open-bus/compare/v0.58.0...v0.58.1) (2026-10-29)


### Bug Fixes

* **dashboard:** AC6 final-review fixes ([#328](https://github.com/open-artifacts-ai/open-bus/issues/328)) ([0dd387d](https://github.com/open-artifacts-ai/open-bus/commit/0dd387d255fd6ab71d38d0ba8fc05068f78cf5b7))

## [0.58.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.57.0...v0.58.0) (2026-10-29)


### Features

* **card:** linked apps and card_request signing in the hub (AC4b) ([#320](https://github.com/open-artifacts-ai/open-bus/issues/320)) ([30ed5be](https://github.com/open-artifacts-ai/open-bus/commit/30ed5be407e2220c501a6cd30cc7cc8990c9edab))


### Bug Fixes

* **ci:** clear-conflicts answers wrangler with a here-string, not a pipe ([#324](https://github.com/open-artifacts-ai/open-bus/issues/324)) ([1253548](https://github.com/open-artifacts-ai/open-bus/commit/12535487b2d8e33c88a660984678e2cf8b9e094f))
* **dashboard:** Linked apps reads 'not available yet' on a 404 ([#326](https://github.com/open-artifacts-ai/open-bus/issues/326)) ([5dc944c](https://github.com/open-artifacts-ai/open-bus/commit/5dc944c076849386d985a3411e4ca52cbcbba770))

## [0.57.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.56.0...v0.57.0) (2026-10-29)


### Features

* **adapters:** set_status and card tools (AC5b) ([#316](https://github.com/open-artifacts-ai/open-bus/issues/316)) ([c4c900c](https://github.com/open-artifacts-ai/open-bus/commit/c4c900c6b070dd3889f3d18499c59d048b1c4e77))
* **adapters:** show roles and status to agents (AC5c) ([#319](https://github.com/open-artifacts-ai/open-bus/issues/319)) ([c926f97](https://github.com/open-artifacts-ai/open-bus/commit/c926f975aa6c13158360957a3f99eea7dcf41969))
* **dashboard:** linked apps with unlink (AC6.4) ([#317](https://github.com/open-artifacts-ai/open-bus/issues/317)) ([f7a207a](https://github.com/open-artifacts-ai/open-bus/commit/f7a207ab549253952c018540ede88b5901429648))
* **dashboard:** roles editor (AC6.3) ([#313](https://github.com/open-artifacts-ai/open-bus/issues/313)) ([f94eec5](https://github.com/open-artifacts-ai/open-bus/commit/f94eec59b1bffb5293eeec359e1b90252440207e))
* **server:** /link confirm page renderer (AC6.5) ([#314](https://github.com/open-artifacts-ai/open-bus/issues/314)) ([4452e70](https://github.com/open-artifacts-ai/open-bus/commit/4452e70880db39654fc6e9790f3cbf06247e6fde))
* **server:** refuse the test card key (I11) ([#315](https://github.com/open-artifacts-ai/open-bus/issues/315)) ([ce34964](https://github.com/open-artifacts-ai/open-bus/commit/ce349644e9f6b178b30aed98acb1101b12ca2d7b))

## [0.56.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.55.0...v0.56.0) (2026-10-29)


### Features

* **card:** key loader, JWKS route and test-key guard (AC4a) ([#311](https://github.com/open-artifacts-ai/open-bus/issues/311)) ([7adb54b](https://github.com/open-artifacts-ai/open-bus/commit/7adb54b238830cab5a990b3e07fa9ea65ccdcbd8))
* **daemon:** agent card status and card requests (AC5a) ([#306](https://github.com/open-artifacts-ai/open-bus/issues/306)) ([10f3501](https://github.com/open-artifacts-ai/open-bus/commit/10f3501405a1cadb4bea5148f4374a7654e4438a))
* **dashboard:** agent status column, tagged agent says (AC6.2) ([#310](https://github.com/open-artifacts-ai/open-bus/issues/310)) ([b0814c0](https://github.com/open-artifacts-ai/open-bus/commit/b0814c0682841961cc3d5ba1598cded1c2974a74))
* **dashboard:** roles and linked-apps queries (AC6.1) ([#304](https://github.com/open-artifacts-ai/open-bus/issues/304)) ([6463ca7](https://github.com/open-artifacts-ai/open-bus/commit/6463ca7ddcbe614e0637f90b0e700411303a0281))
* **hub:** self-reported status with the coalescing 5 s limit (AC3) ([#312](https://github.com/open-artifacts-ai/open-bus/issues/312)) ([2435967](https://github.com/open-artifacts-ai/open-bus/commit/24359675e84688634d11b7580ce04363b41e7056))
* **server:** owner-only roles REST and role on the agent DTO (AC2b) ([#305](https://github.com/open-artifacts-ai/open-bus/issues/305)) ([68f05a3](https://github.com/open-artifacts-ai/open-bus/commit/68f05a39eb0b996c95f343db29c68c76eaf3fae6))


### Bug Fixes

* **setup:** a test-key rotation drops CARD_SIGNING_KEY_PREV (I11) ([#308](https://github.com/open-artifacts-ai/open-bus/issues/308)) ([f1a9bad](https://github.com/open-artifacts-ai/open-bus/commit/f1a9bad2ebcb887b7966bcbca500ee36ba131077))

## [0.55.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.54.0...v0.55.0) (2026-10-29)


### Features

* **hub:** roles, vacate on close, send resolution via roles (AC2a) ([#303](https://github.com/open-artifacts-ai/open-bus/issues/303)) ([ffa4dd8](https://github.com/open-artifacts-ai/open-bus/commit/ffa4dd8f37f762b93965a721a850337f3c889dae))
* **shared:** agent card schemas, frames and the 0.54.0 gate (AC1) ([#299](https://github.com/open-artifacts-ai/open-bus/issues/299)) ([cfee8dd](https://github.com/open-artifacts-ai/open-bus/commit/cfee8dd9aae280e3b39cd49682631b11b04b19b1))


### Bug Fixes

* **shared:** re-pin AGENT_CARD_MIN_CLIENT to 0.55.0 ([#302](https://github.com/open-artifacts-ai/open-bus/issues/302)) ([451df13](https://github.com/open-artifacts-ai/open-bus/commit/451df13bd74d2174ec7b01861f2f8782d9c9a81b))

## [0.54.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.53.0...v0.54.0) (2026-10-29)


### Features

* **setup:** generate and rotate the card keys (I11) ([#298](https://github.com/open-artifacts-ai/open-bus/issues/298)) ([7e495f1](https://github.com/open-artifacts-ai/open-bus/commit/7e495f11e214b44a9e2fe2a4462057565ad3cff0))


### Bug Fixes

* **cli:** status and doctor show the hub's test_card_key problem ([#294](https://github.com/open-artifacts-ai/open-bus/issues/294)) ([#297](https://github.com/open-artifacts-ai/open-bus/issues/297)) ([d913c34](https://github.com/open-artifacts-ai/open-bus/commit/d913c342777f6d6b69016faf97077943ffed350c))

## [0.53.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.52.1...v0.53.0) (2026-10-29)


### Features

* **ci:** a release-hold label stops release-cadence from arming ([#289](https://github.com/open-artifacts-ai/open-bus/issues/289)) ([5d2f703](https://github.com/open-artifacts-ai/open-bus/commit/5d2f703e28535426cffe58ee2c08e4f810fabc8f))

## [0.52.1](https://github.com/open-artifacts-ai/open-bus/compare/v0.52.0...v0.52.1) (2026-10-29)


### Bug Fixes

* Codex works under launchd and on woken turns (C26j) ([#285](https://github.com/open-artifacts-ai/open-bus/issues/285)) ([55c8cbe](https://github.com/open-artifacts-ai/open-bus/commit/55c8cbe4ef68031bc12fb346922c5376f7768ea4))

## [0.52.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.51.0...v0.52.0) (2026-10-29)


### Features

* **cli:** install, doctor and uninstall for Codex (C26e) ([#283](https://github.com/open-artifacts-ai/open-bus/issues/283)) ([09cd32e](https://github.com/open-artifacts-ai/open-bus/commit/09cd32ea7a710f4ae86c758117807f03e3b24efb))

## [0.51.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.50.0...v0.51.0) (2026-10-29)


### Features

* **daemon:** deliver to Codex threads with codex queue (C26d) ([#281](https://github.com/open-artifacts-ai/open-bus/issues/281)) ([46880b3](https://github.com/open-artifacts-ai/open-bus/commit/46880b3cf798cc2a626705c755e02886573112de))


### Bug Fixes

* **cli:** status tells a stalled daemon from a stopped one ([#274](https://github.com/open-artifacts-ai/open-bus/issues/274)) ([#279](https://github.com/open-artifacts-ai/open-bus/issues/279)) ([423777d](https://github.com/open-artifacts-ai/open-bus/commit/423777d41cf7de09270a1155a80cfbd17739bb3a))

## [0.50.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.49.1...v0.50.0) (2026-10-29)


### Features

* **daemon:** attest Codex threads by parent, lock and call (C26c) ([#278](https://github.com/open-artifacts-ai/open-bus/issues/278)) ([be77395](https://github.com/open-artifacts-ai/open-bus/commit/be773950d28fc71c8e586b1f1ecae42841edda74))

## [0.49.1](https://github.com/open-artifacts-ai/open-bus/compare/v0.49.0...v0.49.1) (2026-10-29)


### Bug Fixes

* **cli:** update available for daemons without hub_version (C26i) ([#276](https://github.com/open-artifacts-ai/open-bus/issues/276)) ([bd52b20](https://github.com/open-artifacts-ai/open-bus/commit/bd52b2012c64a437ce5f4c32f3caa415b43e719a))

## [0.49.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.48.0...v0.49.0) (2026-10-29)


### Features

* show unknown agent kinds by name; status says when an update is available (C26h) ([#273](https://github.com/open-artifacts-ai/open-bus/issues/273)) ([f8d2439](https://github.com/open-artifacts-ai/open-bus/commit/f8d2439330b561e12b97fd0903f22e924715025f))

## [0.48.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.47.0...v0.48.0) (2026-10-29)


### Features

* **adapters:** Codex MCP adapter with per-call identity (C26b) ([#271](https://github.com/open-artifacts-ai/open-bus/issues/271)) ([53626e7](https://github.com/open-artifacts-ai/open-bus/commit/53626e747aca7a82ca67512603c3698ffef0fae0))

## [0.47.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.46.3...v0.47.0) (2026-10-29)


### Features

* **shared:** add the codex agent kind (C26a) ([#269](https://github.com/open-artifacts-ai/open-bus/issues/269)) ([6ca8829](https://github.com/open-artifacts-ai/open-bus/commit/6ca8829ad6c48f344d427119187f47f0defc5103))

## [0.46.3](https://github.com/open-artifacts-ai/open-bus/compare/v0.46.2...v0.46.3) (2026-10-27)


### Bug Fixes

* **ci:** verify-release checks npm's scoped @open-bus/cli ([#263](https://github.com/open-artifacts-ai/open-bus/issues/263)) ([#264](https://github.com/open-artifacts-ai/open-bus/issues/264)) ([b09a0b9](https://github.com/open-artifacts-ai/open-bus/commit/b09a0b95045b2c3f43ae079d5d38199e92014644))

## [0.46.2](https://github.com/open-artifacts-ai/open-bus/compare/v0.46.1...v0.46.2) (2026-10-27)


### Bug Fixes

* **ci:** preflight lets the version steps be todo, so CI can upgrade prod ([#260](https://github.com/open-artifacts-ai/open-bus/issues/260)) ([#261](https://github.com/open-artifacts-ai/open-bus/issues/261)) ([dcaf136](https://github.com/open-artifacts-ai/open-bus/commit/dcaf136587ba671dc113d718efc65e5331b2b2ca))

## [0.46.1](https://github.com/open-artifacts-ai/open-bus/compare/v0.46.0...v0.46.1) (2026-10-26)


### Bug Fixes

* **cli:** oh-my-pi in install copy, install --no-service, log attestation (C25) ([#258](https://github.com/open-artifacts-ai/open-bus/issues/258)) ([65149a6](https://github.com/open-artifacts-ai/open-bus/commit/65149a6f3e342a99934f8828155e8f5669386d02))

## [0.46.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.45.2...v0.46.0) (2026-10-26)


### Features

* **adapters:** support oh-my-pi as the omp agent (C23b) ([#246](https://github.com/open-artifacts-ai/open-bus/issues/246)) ([167b4da](https://github.com/open-artifacts-ai/open-bus/commit/167b4da9a0f974a1e71e18e5d489d36d14f4f260))

## [0.45.2](https://github.com/open-artifacts-ai/open-bus/compare/v0.45.1...v0.45.2) (2026-10-26)


### Bug Fixes

* **dashboard:** run zod jitless so the strict CSP logs no violation ([#247](https://github.com/open-artifacts-ai/open-bus/issues/247)) ([08eaa83](https://github.com/open-artifacts-ai/open-bus/commit/08eaa83f8d89f568f862ade36987d50840f26706))

## [0.45.1](https://github.com/open-artifacts-ai/open-bus/compare/v0.45.0...v0.45.1) (2026-10-25)


### Bug Fixes

* **daemon:** old adapters see omp as pi (C23c) ([#244](https://github.com/open-artifacts-ai/open-bus/issues/244)) ([444b707](https://github.com/open-artifacts-ai/open-bus/commit/444b707a20de59be20d2b1022e0e6b90492e7c13))

## [0.45.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.44.1...v0.45.0) (2026-10-25)


### Features

* **shared:** add the omp agent kind (C23a) ([#241](https://github.com/open-artifacts-ai/open-bus/issues/241)) ([f19e5a9](https://github.com/open-artifacts-ai/open-bus/commit/f19e5a946179ad475c0c70117de3ed929f13c157))

## [0.44.1](https://github.com/open-artifacts-ai/open-bus/compare/v0.44.0...v0.44.1) (2026-10-25)


### Bug Fixes

* **daemon:** attest Claude sessions on Linux by /proc start ticks (C21) ([#239](https://github.com/open-artifacts-ai/open-bus/issues/239)) ([7f04317](https://github.com/open-artifacts-ai/open-bus/commit/7f0431739d238dbbd41416c08f8026ea09d60db5))

## [0.44.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.43.4...v0.44.0) (2026-10-25)


### Features

* **cli:** status says whether the hub link is up (C20) ([#235](https://github.com/open-artifacts-ai/open-bus/issues/235)) ([4ede2ab](https://github.com/open-artifacts-ai/open-bus/commit/4ede2ab850e7dd2314ec1cf18125950d436420ec))


### Bug Fixes

* **landing:** sign in with the repo's wrangler, not npx wrangler --json (D12) ([#237](https://github.com/open-artifacts-ai/open-bus/issues/237)) ([46aa505](https://github.com/open-artifacts-ai/open-bus/commit/46aa505d9bee9980d321a93653ff09c8e60f6a05))

## [0.43.4](https://github.com/open-artifacts-ai/open-bus/compare/v0.43.3...v0.43.4) (2026-10-24)


### Bug Fixes

* **setup:** first run on a new host resolves via 1.1.1.1; ok lines say what happened (I9) ([#234](https://github.com/open-artifacts-ai/open-bus/issues/234)) ([d673396](https://github.com/open-artifacts-ai/open-bus/commit/d67339672d34d342a66ce5d6aca457ea46668427))
* **shared:** R.dashboard is / (the Machines page), not /machines ([#232](https://github.com/open-artifacts-ai/open-bus/issues/232)) ([c53116a](https://github.com/open-artifacts-ai/open-bus/commit/c53116aeadf0773b078629a37d33096dda546eda))

## [0.43.3](https://github.com/open-artifacts-ai/open-bus/compare/v0.43.2...v0.43.3) (2026-10-24)


### Bug Fixes

* **daemon:** global comes only from the user's allowlist (C19) ([#228](https://github.com/open-artifacts-ai/open-bus/issues/228)) ([07044d8](https://github.com/open-artifacts-ai/open-bus/commit/07044d8cecb733e8b076d8efc2b52b0fafb21ce1))

## [0.43.2](https://github.com/open-artifacts-ai/open-bus/compare/v0.43.1...v0.43.2) (2026-10-24)


### Bug Fixes

* **setup:** destroy deletes a Worker only with proof setup wrote to it (I8-03) ([#223](https://github.com/open-artifacts-ai/open-bus/issues/223)) ([8bf0059](https://github.com/open-artifacts-ai/open-bus/commit/8bf00592f5d2b3c09083e731dd5cc31aa8d962ac))

## [0.43.1](https://github.com/open-artifacts-ai/open-bus/compare/v0.43.0...v0.43.1) (2026-10-24)


### Bug Fixes

* **setup,ci:** close the I8 install findings ([#222](https://github.com/open-artifacts-ai/open-bus/issues/222)) ([f5a47e8](https://github.com/open-artifacts-ai/open-bus/commit/f5a47e8167b77486006dfaf6fa24a657320325b3))

## [0.43.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.42.0...v0.43.0) (2026-10-24)


### Features

* **setup:** give installs their own rate-limit namespaces (I9) ([#219](https://github.com/open-artifacts-ai/open-bus/issues/219)) ([25387d4](https://github.com/open-artifacts-ai/open-bus/commit/25387d49965914cf5c40645318b99fd7c3a126c3))

## [0.42.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.41.2...v0.42.0) (2026-10-24)


### Features

* **server:** enforce the SPA Content-Security-Policy ([#216](https://github.com/open-artifacts-ai/open-bus/issues/216)) ([3b6b8c8](https://github.com/open-artifacts-ai/open-bus/commit/3b6b8c86e1644896139a9d5b3a1f506ac45ecbcf))

## [0.41.2](https://github.com/open-artifacts-ai/open-bus/compare/v0.41.1...v0.41.2) (2026-10-24)


### Bug Fixes

* **cli:** say npx @open-bus/cli in every command we print (C18) ([#211](https://github.com/open-artifacts-ai/open-bus/issues/211)) ([66e5a7d](https://github.com/open-artifacts-ai/open-bus/commit/66e5a7d76a9087692fd7969943e508c170632f2f))
* **dashboard:** install copy says npx @open-bus/cli ([#213](https://github.com/open-artifacts-ai/open-bus/issues/213)) ([472091b](https://github.com/open-artifacts-ai/open-bus/commit/472091b92a421a40f637aa78a561cb0ac4f65a46))
* **server:** approval and expired pages say npx @open-bus/cli ([#209](https://github.com/open-artifacts-ai/open-bus/issues/209)) ([b4e1a1d](https://github.com/open-artifacts-ai/open-bus/commit/b4e1a1dfb336919223aa4a63302991743a16a291))

## [0.41.1](https://github.com/open-artifacts-ai/open-bus/compare/v0.41.0...v0.41.1) (2026-10-24)


### Bug Fixes

* **hub:** final-review hub fixes (purge idle closed agents, indexed revoke drain, deflake b11) ([#207](https://github.com/open-artifacts-ai/open-bus/issues/207)) ([d1f03c0](https://github.com/open-artifacts-ai/open-bus/commit/d1f03c0c7a39c134c38b34e406ea5ebdbe5ebd19))

## [0.41.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.40.1...v0.41.0) (2026-10-24)


### Features

* **ui:** new brand mark, three rings around a hub (D9) ([#204](https://github.com/open-artifacts-ai/open-bus/issues/204)) ([a661ce0](https://github.com/open-artifacts-ai/open-bus/commit/a661ce0f58aa821b32977f6797a99ce82c37646d))

## [0.40.1](https://github.com/open-artifacts-ai/open-bus/compare/v0.40.0...v0.40.1) (2026-10-24)


### Bug Fixes

* **server:** final-review Worker fixes (rate-limit /hub, OIDC state after redeem, HSTS) ([#203](https://github.com/open-artifacts-ai/open-bus/issues/203)) ([04e219f](https://github.com/open-artifacts-ai/open-bus/commit/04e219f8c02217939478a57184e8e236dfcd7db7))

## [0.40.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.39.1...v0.40.0) (2026-10-24)


### Features

* **daemon:** resend a lost send with its original id (C16) ([#201](https://github.com/open-artifacts-ai/open-bus/issues/201)) ([cee0d82](https://github.com/open-artifacts-ai/open-bus/commit/cee0d826a9f499f91e9b6bd1ef96480aefd78c1e))

## [0.39.1](https://github.com/open-artifacts-ai/open-bus/compare/v0.39.0...v0.39.1) (2026-10-24)


### Bug Fixes

* **cli:** recover a revoked machine with install (C14) ([#199](https://github.com/open-artifacts-ai/open-bus/issues/199)) ([4197d7a](https://github.com/open-artifacts-ai/open-bus/commit/4197d7afd61622777c5835e6976d2dbc2a0bbd04))

## [0.39.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.38.0...v0.39.0) (2026-10-24)


### Features

* **daemon:** tell the sender when a message is delivered (C17) ([#191](https://github.com/open-artifacts-ai/open-bus/issues/191)) ([e0931b5](https://github.com/open-artifacts-ai/open-bus/commit/e0931b51132673911be57781de129d74f07ed6f9))


### Bug Fixes

* **setup:** selftest expects 201 from POST /device/code (I3) ([#187](https://github.com/open-artifacts-ai/open-bus/issues/187)) ([77b85f8](https://github.com/open-artifacts-ai/open-bus/commit/77b85f892fd2467ca540a9041a4a81ca2c239a4e))

## [0.38.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.37.0...v0.38.0) (2026-10-24)


### Features

* **server:** machines REST routes; approval-page referrer and CSP fixes ([#194](https://github.com/open-artifacts-ai/open-bus/issues/194)) ([bb7e75b](https://github.com/open-artifacts-ai/open-bus/commit/bb7e75b068a05c58d3aec2565c7fb01455927293))

## [0.37.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.36.0...v0.37.0) (2026-10-24)


### Features

* **hub:** B14 idempotent send by (agent, frame id) ([#192](https://github.com/open-artifacts-ai/open-bus/issues/192)) ([fff9cd1](https://github.com/open-artifacts-ai/open-bus/commit/fff9cd1148cb4920e57ebf1bf89aab5855fb000e))

## [0.36.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.35.0...v0.36.0) (2026-10-24)


### Features

* **server:** B10 Worker routes — /me, /agents, /events WebSocket ([#147](https://github.com/open-artifacts-ai/open-bus/issues/147)) ([db20f9b](https://github.com/open-artifacts-ai/open-bus/commit/db20f9b4b12d4a8dc411d8be49d68018202e19c6))


### Bug Fixes

* **daemon:** never crash-loop on a socket path that's too long (C15) ([#184](https://github.com/open-artifacts-ai/open-bus/issues/184)) ([30be7e9](https://github.com/open-artifacts-ai/open-bus/commit/30be7e937d5f024339fe0f96ead8b8cfb4ccb009))
* **design:** milestone review fixes (D8) ([#185](https://github.com/open-artifacts-ai/open-bus/issues/185)) ([8351f0f](https://github.com/open-artifacts-ai/open-bus/commit/8351f0f87350d815490e9e9d3c3d1c96a8b27b58))

## [0.35.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.34.0...v0.35.0) (2026-10-24)


### Features

* **server:** B4 device flow and approval page ([#183](https://github.com/open-artifacts-ai/open-bus/issues/183)) ([b3984b9](https://github.com/open-artifacts-ai/open-bus/commit/b3984b939b88700577764cb9b733d05e498a317e))

## [0.34.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.33.0...v0.34.0) (2026-10-24)


### Features

* **daemon:** show each roster agent's machine (C13) ([#178](https://github.com/open-artifacts-ai/open-bus/issues/178)) ([0bee326](https://github.com/open-artifacts-ai/open-bus/commit/0bee3266a02fb68c621970aeff3d35d43c9d75e0))
* **landing:** open-bus.ai site, docs and llms.txt (D7) ([#176](https://github.com/open-artifacts-ai/open-bus/issues/176)) ([4c2245a](https://github.com/open-artifacts-ai/open-bus/commit/4c2245a803671e96309feb8dd4aa1ef4a2f4554b))
* **server:** B1b sign-in routes, single-use OIDC state, logout signs out everywhere ([#154](https://github.com/open-artifacts-ai/open-bus/issues/154)) ([4dfba24](https://github.com/open-artifacts-ai/open-bus/commit/4dfba24d1bc3a658d274404c0890ecf6cf69c91c))
* **server:** B2b session gate, CSRF and same-origin middleware ([#160](https://github.com/open-artifacts-ai/open-bus/issues/160)) ([49a8f5f](https://github.com/open-artifacts-ai/open-bus/commit/49a8f5fea761b994c432c2c40f9aeb3453c8cb91))
* **server:** bind RL_AUTH and RL_DEVICE rate limits on staging ([#181](https://github.com/open-artifacts-ai/open-bus/issues/181)) ([379319f](https://github.com/open-artifacts-ai/open-bus/commit/379319fe17c8477a3d3aeb5bd7f38859430bc3fa))


### Bug Fixes

* **daemon:** whole-track review fixes (client milestone) ([#177](https://github.com/open-artifacts-ai/open-bus/issues/177)) ([beff81e](https://github.com/open-artifacts-ai/open-bus/commit/beff81eae809ef2be686367b99685bff67817ae8))

## [0.33.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.32.0...v0.33.0) (2026-10-24)


### Features

* **hub:** machine_label on roster rows ([#173](https://github.com/open-artifacts-ai/open-bus/issues/173)) ([2624261](https://github.com/open-artifacts-ai/open-bus/commit/262426100daf5cb9987c41fbf730aa3e54de4a6d))
* **server:** auth core copied from OA (session, OIDC, keys, crypto) ([#81](https://github.com/open-artifacts-ai/open-bus/issues/81)) ([1bad8d8](https://github.com/open-artifacts-ai/open-bus/commit/1bad8d8fe4cba127a4682029f5f46843c7dbb21d))


### Bug Fixes

* **hub:** close/error events for an unaccepted socket return quietly ([#174](https://github.com/open-artifacts-ai/open-bus/issues/174)) ([d673021](https://github.com/open-artifacts-ai/open-bus/commit/d67302140888b261280ec99e3fd79d5729115724))
* **setup:** accept a 2xx with an empty body from the Cloudflare API (I3) ([#172](https://github.com/open-artifacts-ai/open-bus/issues/172)) ([7307c6f](https://github.com/open-artifacts-ai/open-bus/commit/7307c6f0e610616e2a7d22a2b35491ad9e296d36))

## [0.32.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.31.0...v0.32.0) (2026-10-24)


### Features

* **daemon:** adopt the B11 rate-limit contract (C12b) ([#169](https://github.com/open-artifacts-ai/open-bus/issues/169)) ([68b968c](https://github.com/open-artifacts-ai/open-bus/commit/68b968c1fcbb860d588321ec15c92bb700541563))

## [0.31.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.30.1...v0.31.0) (2026-10-24)


### Features

* **hub:** B11 frame budget, live-agent caps, bounded bulk work, structured logs ([#166](https://github.com/open-artifacts-ai/open-bus/issues/166)) ([6175911](https://github.com/open-artifacts-ai/open-bus/commit/61759119c23503dcae545092d3d8d2c8566bb019))

## [0.30.1](https://github.com/open-artifacts-ai/open-bus/compare/v0.30.0...v0.30.1) (2026-10-24)


### Bug Fixes

* **cli:** keep the service label stable before the home exists (C9b) ([#165](https://github.com/open-artifacts-ai/open-bus/issues/165)) ([16e532a](https://github.com/open-artifacts-ai/open-bus/commit/16e532af4bfe8f3672fd79caa872e2a2759a267a))

## [0.30.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.29.0...v0.30.0) (2026-10-24)


### Features

* **daemon:** pace hub frames and handle rate-limited registrations (C12) ([#162](https://github.com/open-artifacts-ai/open-bus/issues/162)) ([bbfffc5](https://github.com/open-artifacts-ai/open-bus/commit/bbfffc525c8f204cf39e9497b8cf5df6ca54424f))

## [0.29.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.28.0...v0.29.0) (2026-10-24)


### Features

* **cli:** bundle the published open-bus package (C10) ([#158](https://github.com/open-artifacts-ai/open-bus/issues/158)) ([41df1bd](https://github.com/open-artifacts-ai/open-bus/commit/41df1bd2d511679ab858d29ad8ee359ee5fe0294))

## [0.28.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.27.0...v0.28.0) (2026-10-24)


### Features

* **hub:** B10-ws dashboard WebSocket feed replaces SSE ([#152](https://github.com/open-artifacts-ai/open-bus/issues/152)) ([8593972](https://github.com/open-artifacts-ai/open-bus/commit/8593972c4380d544597b728ff7b64a411c6c54d0))

## [0.27.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.26.0...v0.27.0) (2026-10-24)


### Features

* **cli:** run the daemon as a launchd or systemd user service (C9) ([#151](https://github.com/open-artifacts-ai/open-bus/issues/151)) ([28e48ae](https://github.com/open-artifacts-ai/open-bus/commit/28e48ae71806bcd4b29f57200fe1eb364235ddca))
* **dashboard:** live updates over a WebSocket ([#150](https://github.com/open-artifacts-ai/open-bus/issues/150)) ([dadb36b](https://github.com/open-artifacts-ai/open-bus/commit/dadb36b65ceab8614b7e03c0fda0811085fe80d4))

## [0.26.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.25.0...v0.26.0) (2026-10-24)


### Features

* **hub:** B9-hub revoke a machine, close 4403, refuse revoked mail ([#145](https://github.com/open-artifacts-ai/open-bus/issues/145)) ([50ca4e3](https://github.com/open-artifacts-ai/open-bus/commit/50ca4e36bd7c496a4f528b3485cd3f07a7a8c5dd))

## [0.25.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.24.0...v0.25.0) (2026-10-24)


### Features

* **cli:** add install, status, doctor, uninstall and daemon commands (C8b) ([#143](https://github.com/open-artifacts-ai/open-bus/issues/143)) ([291e88e](https://github.com/open-artifacts-ai/open-bus/commit/291e88e00404e96f99a615b976a83aff8622b478))
* **hub:** B10-hub dashboard DTOs, listAgents, /events observer feed ([#144](https://github.com/open-artifacts-ai/open-bus/issues/144)) ([0b9677a](https://github.com/open-artifacts-ai/open-bus/commit/0b9677adeb818f70cd34d897aa384419be4f3926))

## [0.24.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.23.1...v0.24.0) (2026-10-24)


### Features

* **hub:** B8 fetch by id, namespace and global matrix ([#140](https://github.com/open-artifacts-ai/open-bus/issues/140)) ([7a940ca](https://github.com/open-artifacts-ai/open-bus/commit/7a940caeb8ebf55e69f5044605341a56648f5884))

## [0.23.1](https://github.com/open-artifacts-ai/open-bus/compare/v0.23.0...v0.23.1) (2026-10-24)


### Bug Fixes

* **dashboard:** final-review security and behaviour fixes ([#135](https://github.com/open-artifacts-ai/open-bus/issues/135)) ([74a5d92](https://github.com/open-artifacts-ai/open-bus/commit/74a5d921b35266fcc9f20a99dd30bb63922f27ad))

## [0.23.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.22.2...v0.23.0) (2026-10-23)


### Features

* **cli:** install openbus into claude, opencode and pi (C8a) ([#133](https://github.com/open-artifacts-ai/open-bus/issues/133)) ([13df821](https://github.com/open-artifacts-ai/open-bus/commit/13df821e8623413762492c50e07fa8f617bcd27f))
* **daemon:** quote the message in expired and refused notices ([#132](https://github.com/open-artifacts-ai/open-bus/issues/132)) ([c1ca8ba](https://github.com/open-artifacts-ai/open-bus/commit/c1ca8ba78ab814177f0ae833426d4ab6320c8b48))
* **hub:** B7 expiry alarm, ack timeout, reconnect flush ([#131](https://github.com/open-artifacts-ai/open-bus/issues/131)) ([7363335](https://github.com/open-artifacts-ai/open-bus/commit/736333516c43648b338f54f9df22aaa4399dfd66))

## [0.22.2](https://github.com/open-artifacts-ai/open-bus/compare/v0.22.1...v0.22.2) (2026-10-23)


### Bug Fixes

* **ci:** recover a stalled apt, retry from archive.ubuntu.com, cache WebKit's debs ([#129](https://github.com/open-artifacts-ai/open-bus/issues/129)) ([1874571](https://github.com/open-artifacts-ai/open-bus/commit/1874571b6ba75f144bf19b2d6d02c665045f6e98))

## [0.22.1](https://github.com/open-artifacts-ai/open-bus/compare/v0.22.0...v0.22.1) (2026-10-23)


### Bug Fixes

* **ci:** bound the Playwright install so a stalled apt mirror can't hang e2e ([#123](https://github.com/open-artifacts-ai/open-bus/issues/123)) ([cf09f17](https://github.com/open-artifacts-ai/open-bus/commit/cf09f178a90617c2ea0505d71d72c4482df9077a))
* **shared:** reject non-well-formed Unicode in frames; @ob/shared/web subpath ([#121](https://github.com/open-artifacts-ai/open-bus/issues/121)) ([d969637](https://github.com/open-artifacts-ai/open-bus/commit/d969637208b64553c77f70f01dc22d0b1df30f7f))

## [0.22.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.21.1...v0.22.0) (2026-10-23)


### Features

* **adapters:** add the pi extension and its liveness gate (C7) ([#120](https://github.com/open-artifacts-ai/open-bus/issues/120)) ([8b5439b](https://github.com/open-artifacts-ai/open-bus/commit/8b5439b93656e4065c065c0f659f420c8d3bbb11))
* **hub:** send, inline delivery, notice, ack, refuse and receipts ([#118](https://github.com/open-artifacts-ai/open-bus/issues/118)) ([f23286c](https://github.com/open-artifacts-ai/open-bus/commit/f23286cb6f921cdb0ea8aaee9b52c97bc22c853d))


### Bug Fixes

* **daemon:** never prompt an opencode session twice after a timeout (C6b) ([#117](https://github.com/open-artifacts-ai/open-bus/issues/117)) ([d6cbb22](https://github.com/open-artifacts-ai/open-bus/commit/d6cbb221e3328bcb63054317299e52a00d164ad4))

## [0.21.1](https://github.com/open-artifacts-ai/open-bus/compare/v0.21.0...v0.21.1) (2026-10-23)


### Bug Fixes

* **ci:** poll staging /healthz until the deployed version is served ([#112](https://github.com/open-artifacts-ai/open-bus/issues/112)) ([6f9d08f](https://github.com/open-artifacts-ai/open-bus/commit/6f9d08f0a12eb6678c4187d30d0189c4c11db7dd))

## [0.21.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.20.0...v0.21.0) (2026-10-23)


### Features

* **hub:** daemon sockets, hello, agent registration and roster ([#110](https://github.com/open-artifacts-ai/open-bus/issues/110)) ([2384b20](https://github.com/open-artifacts-ai/open-bus/commit/2384b203fc567e144260e8d0c55d05ff4c4807f2))

## [0.20.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.19.1...v0.20.0) (2026-10-23)


### Features

* **adapters:** deliver to opencode sessions only while a tui has them (C6) ([#108](https://github.com/open-artifacts-ai/open-bus/issues/108)) ([8c6a4c8](https://github.com/open-artifacts-ai/open-bus/commit/8c6a4c82771cbaa0335e3b0ec1300971170d6b1b))

## [0.19.1](https://github.com/open-artifacts-ai/open-bus/compare/v0.19.0...v0.19.1) (2026-10-23)


### Bug Fixes

* **daemon:** route every claude reply by the sender's namespace ([#101](https://github.com/open-artifacts-ai/open-bus/issues/101)) ([e45dd78](https://github.com/open-artifacts-ai/open-bus/commit/e45dd78bcd99efb06f93a43449a4c5a05fc0a910))

## [0.19.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.18.0...v0.19.0) (2026-10-23)


### Features

* **dashboard:** match the D5 agents handoff (FE7b) ([#98](https://github.com/open-artifacts-ai/open-bus/issues/98)) ([ae25307](https://github.com/open-artifacts-ai/open-bus/commit/ae25307c2bea9d539eccc4e079944207d81bd7da))

## [0.18.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.17.0...v0.18.0) (2026-10-23)


### Features

* **daemon:** adopt shared F2.4 and tell senders about expired mail (C4c) ([#96](https://github.com/open-artifacts-ai/open-bus/issues/96)) ([3df8eb5](https://github.com/open-artifacts-ai/open-bus/commit/3df8eb56d89ac0c5d39832ecb3a0b4d2fffe8f6f))

## [0.17.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.16.0...v0.17.0) (2026-10-23)


### Features

* **hub:** Durable Object schema, stub and machines ([#93](https://github.com/open-artifacts-ai/open-bus/issues/93)) ([c8dc9e3](https://github.com/open-artifacts-ai/open-bus/commit/c8dc9e3ecd9ae6fb67611a4bf60238e7b8635d06))
* **shared:** reserve the openbus bus name; IPv6 loopback; to_namespace to globals ([#94](https://github.com/open-artifacts-ai/open-bus/issues/94)) ([919d0e4](https://github.com/open-artifacts-ai/open-bus/commit/919d0e44ef42e9eae84e9de721cd83b170163f14))

## [0.16.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.15.0...v0.16.0) (2026-10-23)


### Features

* **dashboard:** show machine Live/Offline from connected (FE6c) ([#91](https://github.com/open-artifacts-ai/open-bus/issues/91)) ([c19b3e1](https://github.com/open-artifacts-ai/open-bus/commit/c19b3e1b8401caed8715568878228ad60468c7ca))

## [0.15.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.14.0...v0.15.0) (2026-10-23)


### Features

* **dashboard:** match the D4 machines handoff (FE6b) ([#89](https://github.com/open-artifacts-ai/open-bus/issues/89)) ([daea151](https://github.com/open-artifacts-ai/open-bus/commit/daea1510a9540944ef458766580e3e510f03778d))

## [0.14.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.13.0...v0.14.0) (2026-10-23)


### Features

* **adapters:** deliver to claude over its own uds socket (C5) ([#87](https://github.com/open-artifacts-ai/open-bus/issues/87)) ([c938bfc](https://github.com/open-artifacts-ai/open-bus/commit/c938bfce44de74ec0b7e5de68bce87732543c167))

## [0.13.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.12.0...v0.13.0) (2026-10-23)


### Features

* **shared:** send.to_namespace, the ambiguous refusal and machine connected ([#85](https://github.com/open-artifacts-ai/open-bus/issues/85)) ([4c956b5](https://github.com/open-artifacts-ai/open-bus/commit/4c956b514731a33212cef12aaf97668a619b49b7))

## [0.12.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.11.0...v0.12.0) (2026-10-23)


### Features

* **shared:** MSW mocks and fixtures for the dashboard ([#76](https://github.com/open-artifacts-ai/open-bus/issues/76)) ([5e94dd6](https://github.com/open-artifacts-ai/open-bus/commit/5e94dd6b23e989aab4fa813cb257a743b8410373))


### Bug Fixes

* **ui:** theme dialog, alert-dialog and sheet overlays with --ob-scrim (D2c) ([#80](https://github.com/open-artifacts-ai/open-bus/issues/80)) ([0e37f8b](https://github.com/open-artifacts-ai/open-bus/commit/0e37f8b9b9f1f5914e163ff3d77d173542cc8028))

## [0.11.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.10.0...v0.11.0) (2026-10-23)


### Features

* **shared:** REST routes, DTOs, device flow and SSE events ([#70](https://github.com/open-artifacts-ai/open-bus/issues/70)) ([138474f](https://github.com/open-artifacts-ai/open-bus/commit/138474f1ea1a6f4ef8b30febb2cab5837f73fb3f))

## [0.10.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.9.2...v0.10.0) (2026-10-23)


### Features

* **dashboard:** live agents and namespaces view (FE7) ([#66](https://github.com/open-artifacts-ai/open-bus/issues/66)) ([2f07e55](https://github.com/open-artifacts-ai/open-bus/commit/2f07e55b6e6c1b7fa9da0d348d8d2fa8a898186b))

## [0.9.2](https://github.com/open-artifacts-ai/open-bus/compare/v0.9.1...v0.9.2) (2026-10-23)


### Bug Fixes

* **setup:** one setup token covers the zone and DNS reads (I3b) ([#65](https://github.com/open-artifacts-ai/open-bus/issues/65)) ([74d68c5](https://github.com/open-artifacts-ai/open-bus/commit/74d68c5e1300058252e6e863cda31f8686d0b624))

## [0.9.1](https://github.com/open-artifacts-ai/open-bus/compare/v0.9.0...v0.9.1) (2026-10-23)


### Bug Fixes

* **setup:** recognise wrangler 4's missing-Worker message ([#62](https://github.com/open-artifacts-ai/open-bus/issues/62)) ([aa091ab](https://github.com/open-artifacts-ai/open-bus/commit/aa091ab798191dcd67530f6ecb36c0377ec7be0b))

## [0.9.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.8.0...v0.9.0) (2026-10-23)


### Features

* **dashboard:** machines page with revoke (FE6) ([#57](https://github.com/open-artifacts-ai/open-bus/issues/57)) ([feb69aa](https://github.com/open-artifacts-ai/open-bus/commit/feb69aadf28af1c09c66924cd4c92385f54bc978))
* **server:** Hono shell, fail-closed route gate and /healthz ([#58](https://github.com/open-artifacts-ai/open-bus/issues/58)) ([f05de32](https://github.com/open-artifacts-ai/open-bus/commit/f05de325f4bbbd5f215c74cc6e7b52403562c7c7))
* **setup:** secrets, deploy, selftest and destroy (I3) ([#60](https://github.com/open-artifacts-ai/open-bus/issues/60)) ([460f9e3](https://github.com/open-artifacts-ai/open-bus/commit/460f9e38086987876a3aa9ed1395118bfa744722))

## [0.8.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.7.1...v0.8.0) (2026-10-23)


### Features

* **daemon:** attest adapter identity and route local frames (C4) ([#52](https://github.com/open-artifacts-ai/open-bus/issues/52)) ([ffe45c7](https://github.com/open-artifacts-ai/open-bus/commit/ffe45c70513c59b22358be6f8bbec3e1082efe31))

## [0.7.1](https://github.com/open-artifacts-ai/open-bus/compare/v0.7.0...v0.7.1) (2026-10-23)


### Bug Fixes

* **shared:** idempotent namespace slugs ([#50](https://github.com/open-artifacts-ai/open-bus/issues/50)) ([faed2d6](https://github.com/open-artifacts-ai/open-bus/commit/faed2d6ecfac64a352ca47c97e062733e37ee93e))

## [0.7.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.6.0...v0.7.0) (2026-10-23)


### Features

* **setup:** Access SaaS app and token flow (I2) ([#47](https://github.com/open-artifacts-ai/open-bus/issues/47)) ([bd883a7](https://github.com/open-artifacts-ai/open-bus/commit/bd883a7abfcad717a4ec28197190360864b7af2a))

## [0.6.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.5.0...v0.6.0) (2026-10-23)


### Features

* **shared:** receipts and the daemon-hub wire frames ([#44](https://github.com/open-artifacts-ai/open-bus/issues/44)) ([48dba89](https://github.com/open-artifacts-ai/open-bus/commit/48dba89f15fec8b0089a62b97e63505208c84340))

## [0.5.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.4.0...v0.5.0) (2026-10-23)


### Features

* **daemon:** add the hub websocket transport with reconnect and dedupe (C3) ([#41](https://github.com/open-artifacts-ai/open-bus/issues/41)) ([6e2a275](https://github.com/open-artifacts-ai/open-bus/commit/6e2a2758d14dd120896344134a77e6cf6c56096e))

## [0.4.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.3.0...v0.4.0) (2026-10-23)


### Features

* **dashboard:** browser mocks for dev and e2e (FE4) ([#39](https://github.com/open-artifacts-ai/open-bus/issues/39)) ([8abd248](https://github.com/open-artifacts-ai/open-bus/commit/8abd2489e7d03da83ad69975eb9db81a3201d030))
* **setup:** step runner and prereqs (I1) ([#34](https://github.com/open-artifacts-ai/open-bus/issues/34)) ([f482fd4](https://github.com/open-artifacts-ai/open-bus/commit/f482fd44789cabe26e08fd63b45aefd3b95a33b1))

## [0.3.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.2.0...v0.3.0) (2026-10-23)


### Features

* **ui:** shadcn components themed with the --ob- tokens (D2b) ([#36](https://github.com/open-artifacts-ai/open-bus/issues/36)) ([d3167fc](https://github.com/open-artifacts-ai/open-bus/commit/d3167fc49761ab3c0f173a2b10ab43dc1a77e06e))

## [0.2.0](https://github.com/open-artifacts-ai/open-bus/compare/v0.1.0...v0.2.0) (2026-10-23)


### Features

* **dashboard:** live bus events stream (FE3) ([#30](https://github.com/open-artifacts-ai/open-bus/issues/30)) ([0f54423](https://github.com/open-artifacts-ai/open-bus/commit/0f5442374f04638d72e73b98167286c11d5ed4c8))

## 0.1.0 (2026-10-23)


### Features

* **daemon:** add the local adapter-daemon socket contract (C1b) ([#26](https://github.com/open-artifacts-ai/open-bus/issues/26)) ([465a0fe](https://github.com/open-artifacts-ai/open-bus/commit/465a0feaecdf54463da984dedfba6a73a805c831))
* **dashboard:** API contract, client and query keys (FE1) ([#19](https://github.com/open-artifacts-ai/open-bus/issues/19)) ([57a2342](https://github.com/open-artifacts-ai/open-bus/commit/57a2342c63101bc878d1db3dec4a604480764e76))
* **dashboard:** queries with optimistic, idempotent revoke (FE2) ([#23](https://github.com/open-artifacts-ai/open-bus/issues/23)) ([5242547](https://github.com/open-artifacts-ai/open-bus/commit/52425474a3c41f2db30af32c720b28bef6a5982c))
* **shared:** bus names, namespace normalization and .openbus.json ([#25](https://github.com/open-artifacts-ai/open-bus/issues/25)) ([f0bb215](https://github.com/open-artifacts-ai/open-bus/commit/f0bb215fb1104f350a608639988d168393d6cbaf))
* **shared:** ids, machine tokens, user codes and pinned limits ([#15](https://github.com/open-artifacts-ai/open-bus/issues/15)) ([72fe8f4](https://github.com/open-artifacts-ai/open-bus/commit/72fe8f4a7d5bd85e9b75ec972d82940e4eebcd15))
* **ui:** design tokens (D2) ([#17](https://github.com/open-artifacts-ai/open-bus/issues/17)) ([b6f2119](https://github.com/open-artifacts-ai/open-bus/commit/b6f2119de0353e8fb1c9db7e4edb1e91f6d2cf8f))


### Bug Fixes

* **ui:** make the D1 files pass biome (D1) ([#12](https://github.com/open-artifacts-ai/open-bus/issues/12)) ([4c0db47](https://github.com/open-artifacts-ai/open-bus/commit/4c0db47d73874b0c5098d0124de9d3bccf50594d))

## 0.0.0 (bootstrap)

The scaffold. release-please prepends the real releases above this heading.
