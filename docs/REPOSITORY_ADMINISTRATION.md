# Repository administration baseline

This document records the intended GitHub controls for `ahmed1122-rpg/riig-`.
Review the baseline quarterly and after ownership, CI, release, or visibility
changes. Repository settings remain authoritative when they differ from this
document; reconcile the difference deliberately.

## Visibility and licensing

The repository is publicly readable and the code remains proprietary under
`LICENSE`. Public visibility does not make the project open source or grant
copying, distribution, hosting, or derivative-work rights.

If the source is intended to remain confidential, public visibility is the
wrong control: make the repository private, review every fork and clone that may
already exist, and rotate any credential that was ever committed. Do not rely on
license wording to preserve secrecy after public disclosure.

Changing repository visibility or license terms requires an explicit owner and
legal decision; it must not be bundled into an ordinary engineering change.

## Protected default branch

Protect `main` with:

- pull requests required before merge;
- required CI and security checks bound to GitHub Actions as their expected app;
- branches required to be current before merge;
- review conversations required to be resolved;
- administrator bypass disabled;
- force pushes and branch deletion disabled.

Require approvals and Code Owner review when at least two independent reviewers
are available. Do not enable a rule that makes the sole maintainer unable to
merge emergency fixes. Use an organization and independent maintainers before
claiming separation of duties.

The required checks must match jobs that actually run on every pull request.
Remove renamed or retired checks promptly so the branch cannot become
permanently blocked.

## Security features

Enable and retain:

- secret scanning and push protection;
- private vulnerability reporting;
- dependency graph;
- Dependabot alerts and security updates;
- grouped security updates when grouping does not hide an urgent fix;
- CodeQL through the pinned repository workflow;
- weekly dependency, GitHub Actions, and Docker update checks from
  `.github/dependabot.yml`.

GitHub Actions must use least-privilege permissions, immutable action pins, and
environment-scoped deployment credentials. Production environments should
require an explicit reviewer and should not expose secrets to untrusted pull
request workflows.

## Repository workflow

- Keep Issues and pull requests restricted to collaborators while the project is
  proprietary and external contributions are closed.
- Use the issue forms and pull request template; do not accept blank reports.
- Enable automatic deletion of merged head branches only after confirming that
  release and rollback processes do not depend on them.
- Keep releases immutable once the release process and emergency correction
  procedure are documented and tested.
- Store durable production evidence outside ephemeral Actions artifacts and
  verify its provenance before promotion.

## Metadata

Keep the repository description concise and accurate. Recommended topics are
`arabic`, `motion-design`, `image-processing`, `pdf`, `typescript`, `react`, and
`nodejs`. Add a website only when it is an owned, HTTPS production or product
documentation domain.

## Quarterly review

1. Confirm owners, collaborators, deploy keys, apps, webhooks, and environment
   reviewers still require access.
2. Confirm `main` protection and required check names match current workflows.
3. Review security alerts, Dependabot queues, CodeQL results, and exceptions.
4. Rotate long-lived credentials and prefer OIDC or workload identity.
5. Confirm repository visibility still matches the confidentiality model.
6. Verify release rollback and recovery evidence is recent and reproducible.
7. Remove stale branches, Actions artifacts, packages, and environments through
   a reviewed retention process.
