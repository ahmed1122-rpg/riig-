# Verification traceability matrix

This matrix separates source implementation, automated evidence, external
evidence, and production authorization. A green source test proves only its
listed claim. It does not promote an externally pending row to production.

Status vocabulary:

- `source-verified`: implementation and repository checks exist.
- `release-qualified`: the reproducible release gate exists and must pass for
  the exact candidate.
- `disabled-by-gate`: code exists, but the capability remains off by policy.
- `external-pending`: account-owned infrastructure, hardware, or approval is
  still required.

| Trace ID | Claim | Source of truth | Automated evidence | Required external evidence | Owner | Current status |
|---|---|---|---|---|---|---|
| `workspace-layout` | Desktop rails collapse, layer width persists, and mobile panels replace side rails | `apps/web/src/features/workspace/useWorkspaceStateControllers.ts`, `WorkspaceEditorLayout.tsx` | Web workspace unit tests and browser journeys | Real-device review for any branded mobile promise | Workspace UX | `source-verified` |
| `workspace-tool-availability` | Every displayed tool has a real dispatch; runtime capability gates explain unavailable tools | `workspaceToolRegistry.ts`, `useWorkspaceToolController.ts` | Registry exhaustiveness and controller tests | Provider or OCR gate for capability-disabled tools | Workspace UX | `source-verified` |
| `revision-conflict` | A stale `baseRevision` stops autosave; reload is confirmed rather than forced | `useWorkspaceReviewAutosave.ts`, `useWorkspaceRevisionConflict.ts`, processing routes | Autosave, conflict classification, and API revision tests | Multi-user staging exercise before launch | Workspace UX | `source-verified` |
| `upload-flow` | New projects create a project first; source replacement reuses the existing project | `projects-client.ts`, upload and processing routes | Upload client, API route, cancellation, and reconciliation tests | Managed S3 and interrupted-network staging run | Uploads and source versions | `source-verified` |
| `upload-integrity` | Upload bytes are bounded, staged, hashed, signature-checked, encrypted, and verified before publication | upload body parser, S3 adapter, upload finalization | API upload suite, S3 integration contract, object-integrity tests | Provider IAM, encryption, lifecycle, and TLS evidence | Uploads and source versions | `external-pending` |
| `image-layer-cap` | Images contain no more than 15 content layers and preserve visible component pixels | contracts, media processing, layer validation | Media-processing reconstruction and overflow tests | Representative large-image capacity evidence | Media and document processing | `source-verified` |
| `regional-ocr` | Local OCR code fails explicitly, while regional OCR remains disabled after the failed holdout | document processing, API capabilities, ADR 0006 | OCR smoke, corpus policy, selector, and failure tests | New sealed holdout meeting the approved CER gate | Media and document processing | `disabled-by-gate` |
| `export-capabilities` | Export formats are restricted by project kind and artifacts enforce preflight and integrity | shared contracts, export service, export adapters | Contract, adapter, export service, and artifact-expiry tests | Managed-storage export and download staging run | Export | `source-verified` |
| `adobe-golden` | Generated PSD structure and committed licensed-app evidence match fixed hashes | `artifacts/adobe-golden`, `verify-adobe-golden.mjs` | Deterministic regeneration, hashes, PSD structure, evidence parser | Re-run licensed applications for the approved release candidate when required | Export | `release-qualified` |
| `browser-qualification` | Critical journeys run on five reproducible Chromium, Firefox, and desktop WebKit profiles | Playwright config, browser matrix runner, CI workflow | Browser contract plus engine-isolated CI jobs | None for engine-level claim | Workspace UX | `release-qualified` |
| `branded-safari-ios` | No branded Safari/iOS production promise is made without real hardware evidence | `BROWSER_SUPPORT.md` | Documentation contract | Completed real-device evidence record with owner and versions | Workspace UX | `external-pending` |
| `character-studio` | Character Studio is image-only and remains disabled until provider and product gates pass | capability contract, character worker, ADR 0018 | Character unit/integration, race, benchmark, and PSD tests | Private inference provider, Character Animator Golden, rights/legal approval | Character identity and rigging | `disabled-by-gate` |
| `production-authorization` | Source readiness is not production authorization | `EXTERNAL_GATE_INPUTS.md`, production readiness and release workflows | Quality, security, topology, release-environment, and workflow contracts | Managed staging, signed images, restore, load, fault, rollback, alert and launch approvals | Operations and release | `external-pending` |

## Release use

For an exact release SHA, copy the applicable rows into the release evidence
bundle and attach immutable artifact references. Record `not-applicable` only
with a product-scope reason. Never replace missing external evidence with a
local unit test or a historical report.
