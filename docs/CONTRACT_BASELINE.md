# Contract baseline

`config/contract-baseline.json` is the checked-in compatibility contract for
public API operations, package exports, npm tool names, worker entrypoints,
Docker targets, Compose services and profiles, feature-flag defaults, dynamic
Knip entry patterns, and immutable migration checksums.

Run:

```bash
npm run verify:contracts
```

The verifier is intentionally exact. A drift failure is not an instruction to
replace the baseline automatically. Review the change first:

1. Preserve an existing API route, package export, script name, worker entry,
   or Compose service unless a versioned compatibility plan authorizes its
   removal.
2. Never edit a previously applied migration. Add a new forward-only migration.
3. Keep `CHARACTER_RIG_ENABLED` and `PDF_REGION_OCR_ENABLED` defaulted to
   `false` until their readiness gates pass.
4. For an intentional additive contract change, inspect the measured snapshot
   with `node --import tsx scripts/verify-contract-baseline.mjs --measure`, then
   update only the reviewed baseline entries.
5. Record removals and default changes in release evidence with rollback and
   consumer-migration instructions.

The current quality measurements associated with the initial snapshot are in
`artifacts/baselines/code-quality-baseline-c168e5c.json`. Those measurements
are evidence, not permission to reduce coverage or increase bundle and
maintainability debt; the dedicated ratchets remain authoritative.

