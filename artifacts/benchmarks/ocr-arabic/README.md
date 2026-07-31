# Arabic OCR smoke benchmark

This directory contains a deterministic, synthetic Arabic scan used to prove
that the production build can load the bundled `ara` model, recognize words,
return positioned right-to-left text, and close its worker without calling an
external OCR service.

Run the local benchmark:

```bash
npm run benchmark:ocr
```

The command fails when no words are returned, a required token is missing, or
the normalized character error rate exceeds the threshold in `expected.json`.
Timing is reported for observation only because it varies by CPU.

`page.png` is generated from the three ground-truth lines in `expected.json`.
To regenerate it, run:

```bash
npm run fixture:ocr:generate
```

Generation is the only networked step. It downloads an exact, commit-pinned
Noto Naskh Arabic font, verifies its SHA-256 digest, renders the fixture, and
removes the temporary font. The font is licensed under the SIL Open Font
License 1.1; the source and digest are recorded in `expected.json`. The checked
in PNG and the benchmark itself are fully offline.

This fixture remains the fast runtime smoke baseline, not an accuracy claim for
customer books. The complementary rights-cleared real-scan corpus is in
`../ocr-arabic-corpus`; run it with `npm run benchmark:ocr:corpus`.
