# Version and release identity policy

MotionPrep uses four related but non-interchangeable identities:

1. The root `package.json` SemVer is the application version returned by health,
   metrics, and OpenAPI. Every workspace package stays synchronized to it.
2. A Git tag is `v<application-version>` and identifies the reviewed release
   event. A tag is created only after the exact source passes protected gates.
3. `RELEASE_GIT_SHA` is the immutable 40-character source identity. It is the
   authoritative answer to “which code is running?” even when two builds share
   the same application version during candidate testing.
4. Digest-qualified OCI references are the deployable artifacts. Production
   must use `image@sha256:...`, never a mutable tag.

## Change procedure

- Change the root and every workspace version together; update the lockfile in
  the same commit. Do not hand-edit only one manifest.
- Use SemVer: patch for compatible fixes, minor for compatible functionality,
  and major for breaking public contracts. Candidate builds may use a SemVer
  prerelease suffix.
- Run `npm run verify:contracts`, `npm run verify:deployment`, and the complete
  `npm run quality` gate before tagging.
- Publish images from the exact tag SHA once, retain SBOM/provenance/signature
  evidence, and promote the resulting digests without rebuilding.
- Configure staging with both the explicit `EXPECTED_APPLICATION_VERSION` and
  exact `RELEASE_GIT_SHA`. A missing expected version is a failed preflight,
  not permission to assume a historical default.
- Rollback by selecting previously signed image digests. Additive migrations
  are not reversed by an application rollback.

The current package line is `0.1.8`. This does not make untagged working-tree
changes equivalent to future hosted `v0.1.8` artifacts: the source SHA and image
digests remain different and must be reported separately.
