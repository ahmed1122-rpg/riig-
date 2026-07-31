# Arabic OCR corpus — official generation-6 report

Generated from the independently opened generation-6 holdout on 2026-07-31. Machine-readable evidence is in `latest-report.json`.

## Integrity

- Samples: 91 pages from 20 public-domain books.
- Documented dimensions: 136.
- Holdout sources: `taha-hussein-jahili-literature-1927`, `jurjani-definitions-manuscript`.
- Opened at: `2026-07-31T11:59:59.287Z`.
- Implementation SHA-256: `5255fe821215181b7bb75144fa1c9a194835a5519db9bd1d4e525a0c138db3a7`.
- Holdout-content SHA-256: `c53efecd26164b3e5f4b4df301e7180b626ae2f000780924e4d23da22aca71e0`.

## Result

| Split | Pages | CER | Decision |
|---|---:|---:|---|
| Development | 74 | 18.90% | diagnostic |
| Validation | 7 | 15.13% | stable |
| Holdout v6 | 10 | 27.02% | fail: target ≤25% |
| Full corpus | 91 | 19.39% | aggregate target passes |

Official failures:

- `tuhfa-052-table`: development page exceeds the 50% page target at 69.02%.
- `jurjani-008-manuscript`: holdout page exceeds the 50% page target at 53.76%.
- Aggregate holdout CER exceeds 25% at 27.02%.

The holdout separates the supported and unsupported classes clearly:

- Five 1927 printed pages: weighted CER 16.26%.
- Five historical manuscript pages: weighted CER 43.81%.
- Every manuscript page had final average confidence below 0.35 and is marked for human review by the production policy.

The v5 low-contrast printed pages are now development evidence and improved to 17.94% and 13.41%. Validation remained 15.13%.

The release gate is intentionally red. The engine and thresholds were not changed after opening generation 6. Further protected OCR development requires a newly sealed generation 7; alternatively, the product owner may formally restrict automatic-transcription claims to printed documents while preserving the complete historical benchmark.
