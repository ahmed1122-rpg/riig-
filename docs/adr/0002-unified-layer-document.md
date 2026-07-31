# ADR 0002: Unified LayerDocument as the export boundary

## Context

Images and books produce different source information but both need ordered, named, positioned layers and multiple export formats.

## Decision

Both pipelines emit the same versioned `LayerDocument`. Export adapters consume that document and never depend on AI/OCR internals.

## Consequences

- PSD and fallback exports behave consistently.
- Export correctness can be tested without loading AI models.
- Text layers may initially be rasterized where editable text cannot be represented reliably; that limitation must be explicit in export metadata.

