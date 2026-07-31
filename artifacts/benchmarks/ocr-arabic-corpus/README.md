# Rights-cleared Arabic OCR corpus

This corpus contains 91 real scanned pages from 20 independently published Arabic books. Wikimedia Commons reports every source scan as public domain. The pinned Arabic Wikisource transcriptions are licensed under CC BY-SA 4.0 and are tied to exact page revisions and ProofreadPage quality levels.

The corpus covers 136 documented dimensions, including historical letterpress, manuscripts, poetry, tables, footnotes, diacritics, mixed Arabic/Latin text, low-resolution scans, headings, and technical glossaries. Sources—not pages from the same book—are isolated across the 74-page development, 7-page validation, and 10-page holdout splits.

## Integrity and holdout protocol

`sources.json` pins Commons page IDs and SHA-1 values, Wikisource page and revision IDs, timestamps, proofread levels, licenses, splits, and acceptance limits. `manifest.json` pins downloaded image and reference SHA-256 values.

Holdout generation 6 was opened once on 2026-07-31 after the implementation, corpus, quality gate, and browser E2E were frozen. The verifier checks:

- the protected OCR, benchmark, materializer, verifier, and Wikitext-conversion boundary;
- active holdout source isolation and the retired-source list;
- a canonical digest of every active holdout sample, image, reference, dimension, license field, and acceptance threshold;
- local image/reference hashes, dimensions, proofread levels, and rights metadata;
- minimum validation and holdout sizes without weakened CER limits.

The opened values are:

- implementation SHA-256: `5255fe821215181b7bb75144fa1c9a194835a5519db9bd1d4e525a0c138db3a7`
- holdout-content SHA-256: `c53efecd26164b3e5f4b4df301e7180b626ae2f000780924e4d23da22aca71e0`

## Commands

Verify checked-in files without network access:

```bash
npm run verify:ocr-corpus
```

Reproduce them from pinned upstream revisions and recheck Wikimedia rights:

```bash
npm run fixture:ocr:corpus:fetch
```

`--refresh` is deliberately not exposed as a package script. Use it only while preparing a sealed generation and after reviewing source revisions, rights, images, and complete visible reference text.

Run development/validation without reading a sealed holdout:

```bash
npm run benchmark:ocr:development
```

Open a newly sealed holdout exactly once after freezing implementation:

```bash
npm run benchmark:ocr:holdout:open
```

Run the official opened benchmark:

```bash
npm run benchmark:ocr:corpus
```

The official result is recorded in `latest-report.json`; the human-readable decision and limitations are in `report.md`.
