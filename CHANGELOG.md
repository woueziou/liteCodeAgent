## [1.1.1](https://github.com/woueziou/liteCodeAgent/compare/v1.1.0...v1.1.1) (2026-09-23)


### Bug Fixes

* **cli:** `upgrade` no longer drops angles that simply have no skills ([cffc95c](https://github.com/woueziou/liteCodeAgent/commit/cffc95c532678ac6cb96c692ebc30714b27fe786))
* **cli:** close upgrade's symlink escape; keep config formatting ([fd10a2d](https://github.com/woueziou/liteCodeAgent/commit/fd10a2db15bab66f3a6ab2e58817ca01a401665c))
* untrack the node_modules symlink; harden upgrade after bug-hunter ([cc2af74](https://github.com/woueziou/liteCodeAgent/commit/cc2af74e0e1f13612104e80d4a33fb1053877600)), closes [#73](https://github.com/woueziou/liteCodeAgent/issues/73)

# [1.1.0](https://github.com/woueziou/liteCodeAgent/compare/v1.0.0...v1.1.0) (2026-09-23)


### Bug Fixes

* **cli:** make `upgrade` safe to run unattended, per bug-hunter's pass ([93cf5d0](https://github.com/woueziou/liteCodeAgent/commit/93cf5d0dd54e47d8c716dd04e63e70d360fce118))


### Features

* **cli:** `litecode upgrade` brings a project up to date in one command ([b6b1fbd](https://github.com/woueziou/liteCodeAgent/commit/b6b1fbd2365645020ca439fb9a5410523906a97f))

# [1.0.0](https://github.com/woueziou/liteCodeAgent/compare/v0.14.0...v1.0.0) (2026-09-23)


* feat(packs)!: target-neutral delegation in pack prompts, runner as fallback ([8d7d549](https://github.com/woueziou/liteCodeAgent/commit/8d7d5493a3333dbf47bbac0c7d8eb06a0602c4fa)), closes [#49](https://github.com/woueziou/liteCodeAgent/issues/49)
* feat(tickets)!: supprimer src/board/ et couper le chemin d'hydratation ([f8941d9](https://github.com/woueziou/liteCodeAgent/commit/f8941d97962887af6248036a62745df9193a3c7f))
* refactor(tickets)!: drop GitHub issue sync, tickets are purely local ([0bda902](https://github.com/woueziou/liteCodeAgent/commit/0bda902b6927b1340a5b6398d2e32dac581188df))


### Bug Fixes

* --auto must imply --apply for hydration too, and fail loud on a stale status mapping ([a839d68](https://github.com/woueziou/liteCodeAgent/commit/a839d6872bd522a83a0e0f2b39778dd8531671f1)), closes [#27](https://github.com/woueziou/liteCodeAgent/issues/27)
* **agents:** close the remaining gaps from bug-hunter's second pass ([26e5bdf](https://github.com/woueziou/liteCodeAgent/commit/26e5bdf4aaa787167aa2dc825df2806ad92de6ed)), closes [#48](https://github.com/woueziou/liteCodeAgent/issues/48)
* **agents:** give review passes the worktree, close flow gaps bug-hunter found ([f57bc17](https://github.com/woueziou/liteCodeAgent/commit/f57bc17a38a113d84a4f17bcccbf275996ef184c)), closes [#48](https://github.com/woueziou/liteCodeAgent/issues/48)
* **agents:** post reviewer verdict on the PR on every path, not just Review ([7adfa02](https://github.com/woueziou/liteCodeAgent/commit/7adfa0228de4dbb0102dcc0446cc3d20194b0b92)), closes [#34](https://github.com/woueziou/liteCodeAgent/issues/34) [#36](https://github.com/woueziou/liteCodeAgent/issues/36) [#39](https://github.com/woueziou/liteCodeAgent/issues/39) [#41](https://github.com/woueziou/liteCodeAgent/issues/41) [#42](https://github.com/woueziou/liteCodeAgent/issues/42) [#43](https://github.com/woueziou/liteCodeAgent/issues/43)
* **agents:** require --body-file for PR verdict comments, verify they land ([47d41a5](https://github.com/woueziou/liteCodeAgent/commit/47d41a53db3a39d896b8e3920ece1c8ae94284d3)), closes [#43](https://github.com/woueziou/liteCodeAgent/issues/43) [#43](https://github.com/woueziou/liteCodeAgent/issues/43)
* **agents:** update lockfiles for implementer.md drift, replace fabricated verdict ([e351b1e](https://github.com/woueziou/liteCodeAgent/commit/e351b1e6d53dc4ef0b150c0374edff1e5a625bad)), closes [#43](https://github.com/woueziou/liteCodeAgent/issues/43)
* close remaining gaps from reviewer's code-review pass ([8cad278](https://github.com/woueziou/liteCodeAgent/commit/8cad27851f684b7a3015a5f2ad3807a34ed9e9f2)), closes [#27](https://github.com/woueziou/liteCodeAgent/issues/27)
* **docs:** correct ADR 0012's epic directory names to match main, not the pending PR [#59](https://github.com/woueziou/liteCodeAgent/issues/59) rename ([768ab52](https://github.com/woueziou/liteCodeAgent/commit/768ab527858e6ff8ba8f4c39d645d044ac4cd60d))
* **docs:** correct GitHub surface list and version-bump claim in ADR 0012 ([d86cebf](https://github.com/woueziou/liteCodeAgent/commit/d86cebff504623aa71d06162b7b3c05a76bf4caf))
* **docs:** correct project.board schema behavior and board data-file status in ADR 0012 ([a4e56fb](https://github.com/woueziou/liteCodeAgent/commit/a4e56fbba849818d945aea6c79eff248e35b73e3))
* **docs:** correct release status of board removal, unstale supersession pointers ([62737d3](https://github.com/woueziou/liteCodeAgent/commit/62737d30b5fed7fd8526d9ffcc51a9703dc23ebb))
* **docs:** finish purging board language from triage.md ([75eaaf3](https://github.com/woueziou/liteCodeAgent/commit/75eaaf37d854c28fb994285ed36a9ba06b07b222))
* **docs:** fix gh issue list attribution and sync context intro in ADR 0012 ([623394a](https://github.com/woueziou/liteCodeAgent/commit/623394a67efc2357de4a6e749b7952ba9787d10e))
* never mark a ticket synced when its Status push was unresolved ([46d53f8](https://github.com/woueziou/liteCodeAgent/commit/46d53f8a491f24c9ee315b88fe0d153e40ab4e22)), closes [#27](https://github.com/woueziou/liteCodeAgent/issues/27)
* **packs:** frame planner.md's PLAN/ADR_DECISIONS with project.language ([07e569d](https://github.com/woueziou/liteCodeAgent/commit/07e569d361bd8c18697374e961d1cf8192570f3f)), closes [#if](https://github.com/woueziou/liteCodeAgent/issues/if) [#42](https://github.com/woueziou/liteCodeAgent/issues/42) [#16](https://github.com/woueziou/liteCodeAgent/issues/16)
* **packs:** harden delegation helpers after bug-hunter's pass ([1d110ee](https://github.com/woueziou/liteCodeAgent/commit/1d110ee5cac7c684c95b4bcb531670865b0e5d10)), closes [#each](https://github.com/woueziou/liteCodeAgent/issues/each) [#if](https://github.com/woueziou/liteCodeAgent/issues/if) [#49](https://github.com/woueziou/liteCodeAgent/issues/49)
* **report:** address code-review findings on verify-report ([54614c2](https://github.com/woueziou/liteCodeAgent/commit/54614c2e6dde89feaf1deab78f7d3d1ae4b17efa)), closes [#45](https://github.com/woueziou/liteCodeAgent/issues/45)
* **report:** read ticket status from the main checkout only; CRLF fences ([9a0d38e](https://github.com/woueziou/liteCodeAgent/commit/9a0d38e8476f92f40ea7cd35f200c43886919655))
* **report:** tighten verify-report after review ([ca0c30a](https://github.com/woueziou/liteCodeAgent/commit/ca0c30a73a0534e65243e61c441466a07d7d9639)), closes [#45](https://github.com/woueziou/liteCodeAgent/issues/45)
* ticket sync's exit code must reflect a per-ticket 'blocked' outcome ([2ce4b7f](https://github.com/woueziou/liteCodeAgent/commit/2ce4b7faa2a01b95f0685b0bcca9dbd212e29315)), closes [#27](https://github.com/woueziou/liteCodeAgent/issues/27)
* **tickets:** address bug-hunter's findings on local-only tickets ([0d0974f](https://github.com/woueziou/liteCodeAgent/commit/0d0974f95e807cac427e98d226e18d054d9e614b))
* **tickets:** address reviewer notes on ticket doctor ([116dc44](https://github.com/woueziou/liteCodeAgent/commit/116dc44ed35876a615a9b5b3a01e65e80342269a))
* **tickets:** correct stale board/spec.ts reference in doc comment ([26f33f5](https://github.com/woueziou/liteCodeAgent/commit/26f33f5588d83112cd3f0c427d5dcb35ea92763e))
* **tickets:** finish removing dead board onboarding from init/config ([2e54e6f](https://github.com/woueziou/liteCodeAgent/commit/2e54e6f2b50621c2fdda279d5eb65d4f85d2a9e2))
* **tickets:** keep ticket state in the main checkout, fix fenced comments ([9e4882e](https://github.com/woueziou/liteCodeAgent/commit/9e4882ee81a968e850d36a7035209e12bbf31117))
* **tickets:** sort ticketFiles by filename, not full joined path ([6c35fc2](https://github.com/woueziou/liteCodeAgent/commit/6c35fc28508cc5b7dfa1cd06dc0024578c49f71c))
* **tickets:** ticketFiles walks nested epic directories recursively ([6458211](https://github.com/woueziou/liteCodeAgent/commit/64582115c5aa5607c2b3b20a9d8faeafe369eff5))


### Features

* **agents:** local-first dispatcher ranking, board hydration, and a sync-only-gh regression test ([34f6fca](https://github.com/woueziou/liteCodeAgent/commit/34f6fca5b719d3fd5730372ed6c8b5d97289a53a)), closes [#27](https://github.com/woueziou/liteCodeAgent/issues/27)
* **agents:** move the correctness pass to a dedicated bug-hunter agent ([201d775](https://github.com/woueziou/liteCodeAgent/commit/201d775ab5cf73e9c945ab8dd3a79f28796ae5c5)), closes [#48](https://github.com/woueziou/liteCodeAgent/issues/48)
* **agents:** widen ADR 0010, extend Status push-on-update, and enforce sync-only gh project access ([0930f8a](https://github.com/woueziou/liteCodeAgent/commit/0930f8af4ad775f360393fd9914f40354ae4e74a)), closes [#27](https://github.com/woueziou/liteCodeAgent/issues/27)
* **dashboard:** commit the generated dashboard snapshot per owner decision ([42350ff](https://github.com/woueziou/liteCodeAgent/commit/42350ffa971be86b033b2f10e17efe538c48714e)), closes [#57](https://github.com/woueziou/liteCodeAgent/issues/57)
* **dashboard:** generate a standalone HTML dashboard from the ticket buffer ([d581e9e](https://github.com/woueziou/liteCodeAgent/commit/d581e9eaecaf378d99f457b082b20fadbe1f48bb))
* **packs:** optional project.language for agent prose ([934130e](https://github.com/woueziou/liteCodeAgent/commit/934130e085261b0a47e8c0978f38dac91cf5d7c5)), closes [#if](https://github.com/woueziou/liteCodeAgent/issues/if) [#16](https://github.com/woueziou/liteCodeAgent/issues/16) [#16](https://github.com/woueziou/liteCodeAgent/issues/16)
* **packs:** update status to inProgress and adjust synced flag for language configuration ([b25de23](https://github.com/woueziou/liteCodeAgent/commit/b25de2391f3bc1c0fb1a96074aa16eed03b667ca))
* **report:** verify an implementer's final report against git, gh and the ticket buffer ([d43162f](https://github.com/woueziou/liteCodeAgent/commit/d43162f945d70269ffda0ffe8030a23f85ca3d37)), closes [#45](https://github.com/woueziou/liteCodeAgent/issues/45)
* **tickets:** add documentation for reviewer verdict issue in PRs ([ae7a15d](https://github.com/woueziou/liteCodeAgent/commit/ae7a15d8d6294ac9f0755f7ad49bd703ab28b4c1))
* **tickets:** add multiple ticket documents for agent synchronization and status management ([86a98ef](https://github.com/woueziou/liteCodeAgent/commit/86a98ef295f0f23e977887ba5d1f02f2620c06fc))
* **tickets:** litecode ticket doctor, local buffer diagnostic ([868b698](https://github.com/woueziou/liteCodeAgent/commit/868b6984c86789c6c5e758b19c1950ff01e80b20))
* update project item IDs and mark tickets as done ([d2c1a9c](https://github.com/woueziou/liteCodeAgent/commit/d2c1a9c52642c475500638b170509200882953f7))
* update project item IDs in GitHub data file ([020c1c5](https://github.com/woueziou/liteCodeAgent/commit/020c1c5cadeed5ae6b6ee34acf6634411aedc5b2)), closes [#27](https://github.com/woueziou/liteCodeAgent/issues/27)


### BREAKING CHANGES

* `litecode ticket sync` and the `sync` agent are
removed; ticket files move to schema v2 (`litecode ticket migrate`).

Agent: claude
Task: 0030
* installed prompts on codex, opencode and kilo-code
change wording; custom pack files that relied on the automatic
Agent rewrite must use `{{> delegate X}}` instead.

Agent: claude
* **docs:** footer) is confirmed not an ancestor of the v0.14.0 tag and
  is still unreleased on top of it. Corrected to state it is unreleased and
  will drive a major bump under this project's semantic-release convention
  once it ships.
- ADR 0001/0002/0009/0010 all still said "superseded by ADR 0012 ... not yet
  written" — false the moment this PR lands ADR 0012. Dropped "not yet
  written" from all four Status lines.

Agent: implementer
Task: docs/decisions ADR 0012 (local-first tickets, lot 7/9)
* `bunx litecodeagent board init` et `bunx litecodeagent
board doctor` disparaissent sans fenêtre de dépréciation.

Lot 6/9 de l'épopée local-first-tickets (0026-feat-tickets-supprimer-src-board-et-couper-le-ch).

Agent: implementer
Task: 0026-feat-tickets-supprimer-src-board-et-couper-le-ch

# [0.14.0](https://github.com/woueziou/liteCodeAgent/compare/v0.13.1...v0.14.0) (2026-09-21)


### Bug Fixes

* **agents:** clarify ADR-approval status when the comment was staged, not posted ([7594d75](https://github.com/woueziou/liteCodeAgent/commit/7594d75c2535cbeee9806e4757f0bf45a9bb7799)), closes [#24](https://github.com/woueziou/liteCodeAgent/issues/24)
* **agents:** document resume-manifest fallback for missing/ambiguous state ([3e59238](https://github.com/woueziou/liteCodeAgent/commit/3e59238788afcef631595b74f5c62771b7ba94c1)), closes [#28](https://github.com/woueziou/liteCodeAgent/issues/28)
* **agents:** fix resume-manifest fence nesting and commit:none escalation bug ([77fa799](https://github.com/woueziou/liteCodeAgent/commit/77fa7992b123cc7d0083e263ac70d2a52ef89b58)), closes [#28](https://github.com/woueziou/liteCodeAgent/issues/28)
* **agents:** make a degraded debate panel a structural stop condition ([5a0107f](https://github.com/woueziou/liteCodeAgent/commit/5a0107f3d3cb9076846cdbf95783d6624314348c)), closes [#29](https://github.com/woueziou/liteCodeAgent/issues/29)
* **agents:** make the ADR draft approval gate resumable from a durable comment manifest ([9f0d150](https://github.com/woueziou/liteCodeAgent/commit/9f0d150fb555f972dd089969abc58b7a62dd10f4)), closes [#10](https://github.com/woueziou/liteCodeAgent/issues/10) [#17](https://github.com/woueziou/liteCodeAgent/issues/17) [#29](https://github.com/woueziou/liteCodeAgent/issues/29) [#28](https://github.com/woueziou/liteCodeAgent/issues/28)
* **install:** pre-flight validate agentSkills config paths, plus opt-in config doctor --fix ([9dbefb8](https://github.com/woueziou/liteCodeAgent/commit/9dbefb8b07dd48a791671d4fe7fe5bebabd633d0)), closes [#17](https://github.com/woueziou/liteCodeAgent/issues/17)
* **install:** pre-flight validate project.web config paths required by packs/web ([8f8767f](https://github.com/woueziou/liteCodeAgent/commit/8f8767feb7d33699fe3d09dcc0549484b7d20327)), closes [#23](https://github.com/woueziou/liteCodeAgent/issues/23) [#32](https://github.com/woueziou/liteCodeAgent/issues/32)
* **sync:** auto-sync state resilience and reviewer follow-up fixes ([11ad5c5](https://github.com/woueziou/liteCodeAgent/commit/11ad5c5f813bf5d7b3afb65bd40dddce08999b11)), closes [#31](https://github.com/woueziou/liteCodeAgent/issues/31)
* **sync:** fail closed on corrupted auto-sync state, not open ([1b401ce](https://github.com/woueziou/liteCodeAgent/commit/1b401ce9b6ba001be044ff0fef6e91744dcefc35)), closes [#31](https://github.com/woueziou/liteCodeAgent/issues/31)
* **sync:** implement documented LITECODE_TICKET_AUTO_SYNC_MIN_INTERVAL_MS override ([a0113de](https://github.com/woueziou/liteCodeAgent/commit/a0113def83bedcfefee3d7b73f0cb30396f7ca04)), closes [#40](https://github.com/woueziou/liteCodeAgent/issues/40) [#31](https://github.com/woueziou/liteCodeAgent/issues/31)
* **tickets:** record actual commit sha in staged ADR resume manifest ([43a2883](https://github.com/woueziou/liteCodeAgent/commit/43a28834c0b72e736d47f83cc04650defcc14943)), closes [#28](https://github.com/woueziou/liteCodeAgent/issues/28)


### Features

* **agents:** stage implementer and reviewer comments in the local ticket buffer ([b94f7fc](https://github.com/woueziou/liteCodeAgent/commit/b94f7fcbf0423855dcba10d8c8f669eaf3326fe3)), closes [#24](https://github.com/woueziou/liteCodeAgent/issues/24)
* **security-expert:** add security review guidelines for application changes ([be98e08](https://github.com/woueziou/liteCodeAgent/commit/be98e085900ee723179eccbbada9a8437912af73))
* **sync:** add ticket sync --auto with cooldown and blocker trace ([990f028](https://github.com/woueziou/liteCodeAgent/commit/990f02804f67e8c84e24f01c8c65636ae5cdcde6)), closes [#31](https://github.com/woueziou/liteCodeAgent/issues/31) [#31](https://github.com/woueziou/liteCodeAgent/issues/31)
* **tickets:** block `ticket new` on a likely duplicate title ([43ef203](https://github.com/woueziou/liteCodeAgent/commit/43ef2034ff73e7d5db1e50b2cbecd8316c8d9e5d)), closes [18/#19](https://github.com/woueziou/liteCodeAgent/issues/19) [#30](https://github.com/woueziou/liteCodeAgent/issues/30)

## [0.13.1](https://github.com/woueziou/liteCodeAgent/compare/v0.13.0...v0.13.1) (2026-09-18)


### Bug Fixes

* **board:** detect non-editable derived project fields at plan time ([e4a8e00](https://github.com/woueziou/liteCodeAgent/commit/e4a8e00d106277b04b567f825b23aa1a697bcb7e)), closes [#13](https://github.com/woueziou/liteCodeAgent/issues/13)
* detect isIssueField as the real Priority-field blocker ([f476005](https://github.com/woueziou/liteCodeAgent/commit/f47600594b23350bd6c22100ad3d536e9dd41921)), closes [#13](https://github.com/woueziou/liteCodeAgent/issues/13)
* **implementer:** make the ADR draft readable before it is approved ([d9c0e7e](https://github.com/woueziou/liteCodeAgent/commit/d9c0e7eaa0951e6a18c0f70932de261b52da8fe6))

# [0.13.0](https://github.com/woueziou/liteCodeAgent/compare/v0.12.0...v0.13.0) (2026-09-18)


### Features

* update litecode version to 0.11.0 and enhance agent functionalities ([508e454](https://github.com/woueziou/liteCodeAgent/commit/508e454cfd4eb797b1b72f17acbf891582f711b4))

# [0.12.0](https://github.com/woueziou/liteCodeAgent/compare/v0.11.0...v0.12.0) (2026-09-18)


### Bug Fixes

* **tickets:** harden throttle parsing, board.number check, enabled gate ([cb4fb67](https://github.com/woueziou/liteCodeAgent/commit/cb4fb676f11b6766ae90bb42587f81ec82047ad4)), closes [#10](https://github.com/woueziou/liteCodeAgent/issues/10)


### Features

* **tickets:** local ticket buffer, litecode ticket CLI, sync agent ([e3b72e9](https://github.com/woueziou/liteCodeAgent/commit/e3b72e9cf080600e350c2119813f262b29f8ae5b)), closes [#10](https://github.com/woueziou/liteCodeAgent/issues/10)

# [0.11.0](https://github.com/woueziou/liteCodeAgent/compare/v0.10.0...v0.11.0) (2026-09-18)


### Bug Fixes

* **board:** close the race and widen the integrity check ([4f96752](https://github.com/woueziou/liteCodeAgent/commit/4f967520abd3806e619d5897a4ae45e18ad49316))
* **board:** post GraphQL variables as JSON, not as strings ([300967f](https://github.com/woueziou/liteCodeAgent/commit/300967f5c20af29f70829d37e7e28d16e8d682b6))
* **board:** survive GitHub's rate limits instead of dying on them ([4294a26](https://github.com/woueziou/liteCodeAgent/commit/4294a26e8be25fe3a86769f9e1caaa2489f3b276))


### Features

* **board:** add missing single-select options instead of blocking ([6c2d23b](https://github.com/woueziou/liteCodeAgent/commit/6c2d23b1da1d055ab214a95ef57dcdd7e6346d98))
* **board:** drop an unrecognised option when no item holds it ([bbc8191](https://github.com/woueziou/liteCodeAgent/commit/bbc8191fa0cd8b3531e38f954879b89a2a3c0431))

# [0.10.0](https://github.com/woueziou/liteCodeAgent/compare/v0.9.0...v0.10.0) (2026-09-17)


### Features

* add new skills for critique, security, and project management ([0622681](https://github.com/woueziou/liteCodeAgent/commit/06226812205c55430b07638bbfac68e6daa5f2ee))

# [0.9.0](https://github.com/woueziou/liteCodeAgent/compare/v0.8.1...v0.9.0) (2026-09-17)


### Features

* **cli:** list the supported coding tools and pick them from a menu ([82c2b18](https://github.com/woueziou/liteCodeAgent/commit/82c2b183c6646db1550fd5cac01dcb6a08e90e46))

## [0.8.1](https://github.com/woueziou/liteCodeAgent/compare/v0.8.0...v0.8.1) (2026-09-17)


### Bug Fixes

* **ci:** keep the plugin manifest in lockstep with the released version ([fa4e20a](https://github.com/woueziou/liteCodeAgent/commit/fa4e20a0a01d865d8b564afa4b45b1270a58b298))
* **ci:** publish to npm via OIDC trusted publishing ([8a3aa48](https://github.com/woueziou/liteCodeAgent/commit/8a3aa48e75bf878290cd052acd45179546916a3b))

# [0.8.0](https://github.com/woueziou/liteCodeAgent/compare/v0.7.2...v0.8.0) (2026-09-17)


### Features

* add config CLI for targets, packs, and project settings ([eb1e422](https://github.com/woueziou/liteCodeAgent/commit/eb1e4227409bd7fbe8417d91acd469da7ac4fbb9))

## [0.7.2](https://github.com/woueziou/liteCodeAgent/compare/v0.7.1...v0.7.2) (2026-09-15)


### Bug Fixes

* repair semantic-release pipeline and decouple CI from npm token ([6757fe5](https://github.com/woueziou/liteCodeAgent/commit/6757fe5d1966caf3ada22435e7182b428e42c281))

## [0.7.1](https://github.com/woueziou/liteCodeAgent/compare/v0.7.0...v0.7.1) (2026-09-15)


### Bug Fixes

* gate CI on npm token preflight ([86283bc](https://github.com/woueziou/liteCodeAgent/commit/86283bce8c968a982fd4023b660c24d5ec600555))
* skip release when npm publishing is not configured ([66e20de](https://github.com/woueziou/liteCodeAgent/commit/66e20de99f3b6c01b109918d83980f29f60df852))

# Changelog

## 0.1.0 — unreleased

First extraction of the pipeline out of a single repo into installable packs.

- `core` pack: 11 pipeline agents + 6 shared skills, fully decoupled from any one project.
- `web` pack: 7 expert skills for TypeScript/React work.
- Template engine with `{{ }}` interpolation, `#if`/`#each` blocks, and `join`/`codelist`
  filters. An unresolved placeholder is a hard error, never a silent blank.
- `install` renders packs into a target repo, tracked by `.claude/.litecode-lock.json`.
  Dry run by default; hand-edited files are reported as drift and need `--force`.
- `board init` / `board doctor` provision and verify the GitHub Project board, resolving
  every field/option id into a generated `board.json` instead of hand-written ids.
  Adding an option to an existing single-select field is refused by design — the API
  cannot do it without regenerating every option id and nulling every item's Status.
- Agents declare a capability `tier` rather than a model id, so the same pack can be
  rendered for a different provider later.

## 0.2.0 — unreleased

- `litecode init` is now a wizard. It detects the repo (git remote, scripts and lockfile,
  dependencies across `apps/*`/`packages/*`, ADR directory, skills you already own, the
  convention bullets in your `CLAUDE.md`, your GitHub Projects) and proposes real answers.
  `domains` and `agentSkills` are derived rather than asked. `--yes` skips the questions.
- `install.sh`: one-command bootstrap, clones via `gh` so it works on a private repo.
  Re-running it updates.
- `litecode upgrade`: self-update the kit, refusing to pull over local edits.
- `install` now fails on a skill reference that resolves to neither an installed pack nor
  a local overlay, naming where each dangling reference came from.
- Fixed: directory detection used `Bun.file().exists()`, which is false for directories,
  so ADR/skill/workspace discovery silently found nothing.

## 0.3.0 — unreleased

- Native Claude Code plugin and marketplace manifests. Add the repository as a marketplace,
  install `litecode-agent@litecode`, then run `/litecode-agent:setup` in a target project.
- The plugin exposes the existing CLI to Claude Code while keeping packs behind the config-aware
  renderer; raw `{{ project.* }}` templates are never loaded as plugin components.
- Fixed the interactive init wizard losing stdin after its first answer and looping forever on
  the next required prompt.
- Fixed core rendering for projects that explicitly opt out of ADRs.

## 0.4.0 — unreleased

- Provider-neutral agent runtime with adapters for OpenAI Responses, Anthropic Messages, and
  DeepSeek Chat Completions. Provider model ids live only in `runner.models` in project config.
- `litecode run <agent> --prompt <text>` executes pack agents outside Claude Code.
- Local tool layer implements `Read`, `Write`, `Edit`, `Grep`, `Glob`, `Bash`, and `Skill`, with
  frontmatter tool restrictions enforced by the runtime and file access constrained to the project
  and configured worktree roots.
- `Agent` runs child agents synchronously, executes sibling `Agent` calls in parallel, selects each
  child's model from its capability tier, and enforces depth, turn, and total-agent budgets.
- DeepSeek thinking continuations preserve `reasoning_content` across tool turns.

## 0.5.0 — unreleased

- Every run can return a structured report containing request and token totals, elapsed time,
  agent-call count, and a per-agent/model usage breakdown.
- Optional model pricing in project config calculates cost without baking volatile provider prices
  into LiteCodeAgent. `maxCostUsd` acts as a circuit breaker and fails closed when usage is missing.
- `litecode run --usage` prints a concise stderr summary, `--json` emits the full report, and
  `--record <path>` persists the same report without storing the input prompt.

## 0.6.0 — unreleased

- Provider requests retry bounded transient HTTP responses with exponential backoff and honor
  `Retry-After`; permanent client errors, transport failures, and ambiguous timed-out POSTs are not
  replayed.
- Global run and per-request timeouts are configurable. `SIGINT`/`SIGTERM` cancellation propagates
  across provider calls, retry waits, child agents, searches, and active Bash subprocesses.
- Failed runs expose structured partial reports with status, completed usage, retry count, provider
  request ids, and typed error diagnostics. `--json` and `--record` preserve this report on exit 1.

## 0.7.0 — unreleased

- The npm package is now named `litecodeagent` and exposes matching `litecodeagent` plus compatible
  `litecode` executables, enabling `bunx litecodeagent <command>` without a global installation.
- `bunx litecodeagent setup` initializes a missing config and renders the packs in one flow. It
  preserves the existing dry-run default; `--apply` is still explicit and all drift guards remain.
- Interactive init now asks for the web-pack values that previously remained as `TODO`, so a fully
  answered wizard can proceed directly to rendering.
- The published file set is explicit and tested from the generated package archive; source tests and
  development dependencies are excluded. Package-cache installs explain that `@latest` replaces the
  legacy git-only `upgrade` operation.
