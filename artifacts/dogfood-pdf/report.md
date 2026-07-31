# Dogfood Report: MotionPrep Studio — PDF Core Flow

| Field | Value |
|-------|-------|
| **Date** | 2026-07-28 |
| **App URL** | http://127.0.0.1:4173 |
| **Session** | motionprep-pdf |
| **Scope** | Register → PDF upload → extracted layers → TXT export |

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| **Total** | **0** |

## Issues

No unresolved issue remained in the scoped flow.

## Resolved during the run

- The upload-details popover stayed expanded after a successful PDF upload and
  covered part of the preview. Evidence:
  [pdf-processed.png](screenshots/pdf-processed.png). The success path now
  closes the popover automatically.

## Passed workflow

1. Registered a new creator account through the real session API.
2. Uploaded a 951-byte text PDF through the binary upload endpoint.
3. Observed three server-extracted sentence layers plus the locked white
   `+page_001_background`.
4. Confirmed the applied segmentation selector is locked after processing.
5. Created and downloaded a real UTF-8 TXT export; API requests returned
   `POST /v1/exports 202` and artifact download `200`.
6. Browser console and page-error logs were empty for the completed flow.
