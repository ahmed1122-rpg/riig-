# Branded browser validation

Use this runbook only for a release claim naming Safari, iOS Safari, branded
Firefox, Chrome, or Edge. Engine-level Playwright evidence is necessary but is
not a substitute for this record.

## Preconditions

- exact 40-character release Git SHA;
- digest-qualified runtime and web images deployed to staging;
- test account and non-sensitive image/PDF fixtures;
- named reviewer and device owner;
- screenshots stored in the protected release evidence bundle.

## Required journeys

1. Sign in and complete MFA/focus recovery.
2. Upload one image and one PDF, cancel an upload, then retry it.
3. Navigate PDF page folders and a large virtualized layer list.
4. Exercise dialogs, keyboard focus, RTL text, zoom, and mobile sheets.
5. Save a layer review and confirm the revision-conflict recovery dialog.
6. Export PSD and one text/PNG format, then verify the download.
7. Confirm accessibility zoom, reduced motion, touch targets, and native pixel
   density behavior.

## Evidence record

```text
Release SHA:
Runtime image digest:
Web image digest:
Browser brand/version:
Operating system/version:
Device/model and native pixel density:
Reviewer:
Executed at (UTC):
Journeys passed:
Failures and linked defects:
Screenshots/artifact references:
Decision: pass | fail
Review expiry/date:
```

A failure blocks only the branded-browser claim unless it also reproduces in a
release-qualified engine profile or violates a platform-independent contract.
