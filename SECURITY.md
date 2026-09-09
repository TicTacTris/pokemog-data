# Security Policy

Report vulnerabilities using GitHub's private vulnerability reporting for this
repository when available. Do not include credentials in public issues.

## Trust Model

SHA-256 and byte lengths prove consistency with the downloaded manifest, not
independent authenticity. There is no independent signing key or signature yet.
Clients trust this repository, its maintainers, GitHub HTTPS and release hosting,
and the reviewed publisher workflow. A compromised authorized publisher can
publish a malicious but internally consistent new release. Immutable releases
prevent replacement of an already published release, not malicious new releases.
Upstream data is untrusted input: it is downloaded at one source commit and
validated, never executed. The upstream MIT license and provenance are preserved.

## Controls

- Exact data/manifest fields, strict JSON and UTF-8, safe integers, hashes and sizes.
- Four positive-size data assets total at most 8 MiB; manifest at most 64 KiB.
- Catalog at most 20,000 rows; automatic updates retain at least 98% of both the
  baseline and previous catalog, with a 1,000-row publishing minimum.
- Reciprocal normal/shadow links with equal base stats; same-category evolutions;
  explicit metadata partition including omitted-edge sources.
- Iterative cycle and complexity checks: outdegree 32, depth 16 with root depth 1,
  and 32 unique reachable nodes including the root.
- HTTPS host allowlist and initial repository-path restrictions; at most four
  redirects, no cross-host authorization forwarding, and a 120-second deadline
  covering each request's redirects and streamed body.
- Download limits: gamemaster 32 MiB, Pokemon.js 2 MiB, license 64 KiB, GitHub API
  2 MiB, data 8 MiB (or the smaller manifest size), manifest 64 KiB.
- Regression tests run before staging writes. Draft assets are re-downloaded and
  verified before publication. Existing releases must be immutable; publication
  succeeds only after the API reports the new release immutable.
- Only main-branch schedule/manual runs publish. Tests have no publishing token;
  contents-write permission and token exposure are limited to the publishing job
  and publishing step respectively. Checkout does not persist credentials.
- Jobs time out after ten minutes. Actions are SHA-pinned and Dependabot proposes
  reviewed updates; no automatic merge is configured.

Direct maintainer pushes remain allowed. Branch protection is not installed by
this hardening change, avoiding sole-maintainer lockout. Workflow source review
and account security remain part of the trust boundary.
