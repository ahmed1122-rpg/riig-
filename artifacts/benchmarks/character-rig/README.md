# Character-rig reference benchmark

This directory stores repository-safe metadata for the private PSD supplied by
the user. The PSD binary is deliberately excluded from the repository. Its role
is a semantic-structure reference, not a release Golden: it contains only two of
the five target canonical views and is RGB/16-bit while the supported exporter is
RGB/8-bit.

CI validates the manifest and the versioned quality thresholds without requiring
private data:

```powershell
npm run verify:character-rig:benchmark
```

An authorized developer who has the original file can verify its fingerprint and
structure locally. Do not place the private path in source, logs, or CI secrets:

```powershell
$env:CHARACTER_RIG_REFERENCE_PSD = '<authorized-local-path>'
npm run benchmark:character-rig
Remove-Item Env:CHARACTER_RIG_REFERENCE_PSD
```

The command reads layer metadata only; composite, thumbnail, linked, and layer
pixel data are skipped. A separate synthetic or explicitly licensed fixture with
all five views is required before the Character Animator release gate can pass.
