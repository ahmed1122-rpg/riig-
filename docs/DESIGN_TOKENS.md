# Design token adoption contract

MotionPrep uses a base spacing scale without claiming that every existing pixel
value already belongs to that scale.

| Token | Value | Intended use |
|---|---:|---|
| `--vp-space-1` | 4px | compact inline gaps and grouped controls |
| `--vp-space-2` | 8px | default compact gap |
| `--vp-space-3` | 12px | control and card padding |
| `--vp-space-4` | 16px | section spacing |
| `--vp-space-5` | 20px | roomy feature spacing |
| `--vp-space-6` | 24px | major section separation |
| `--vp-space-8` | 32px | page-level separation |

## Adoption rules

1. New ordinary gap, margin, and padding values use the closest semantic token.
2. One-pixel borders, icon geometry, touch targets, canvas coordinates,
   algorithmic dimensions, and density-tuned values may remain literal.
3. Existing literals are migrated feature by feature, preserving the computed
   value first. Token adoption must not be bundled with a visual redesign.
4. A migration must pass CSS architecture/usage checks, the relevant component
   tests, and the release browser journeys. Any intentional visual change also
   requires before/after evidence at desktop and mobile widths.
5. Do not mechanically replace every number: a false uniformity claim is worse
   than a documented exception.

The automated CSS architecture verifier protects the canonical token values.
