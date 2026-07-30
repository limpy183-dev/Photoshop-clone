# 0005. Capability reporting over silent degradation

- Status: accepted
- Date: 2026-07-30 (documenting an existing decision)

## Context

A browser cannot fully preserve 16/32-bit precision, ICC profiles, CMYK/Lab/spot
colour, PSD private descriptors, or professional codecs. Every browser-based
editor faces this. The common choice is to convert quietly and hope the user
does not notice that their 16-bit CMYK file came back as 8-bit RGB.

## Decision

The app models these limits explicitly and **reports** them: status warnings,
preflight reports, export limitation reports, PSD compatibility manifests, and
colour-pipeline warnings. Unsupported fidelity is named at the point of risk
rather than silently dropped. `BOUNDARIES.md` records what will never be
supported and why.

## Alternatives considered

- **Silent lossy conversion.** Best-looking demo, worst behaviour. Rejected.
- **Refusing unsupported inputs.** Honest but useless; users would rather open
  the file with a warning than not open it.
- **A single generic "results may vary" disclaimer.** Unactionable, so it gets
  ignored.

## Consequences

Good: this is the project's actual differentiator. No other browser editor tells
you precisely what it could not preserve. It also gives a clear home for every
future limitation instead of an argument about whether to ship the feature.

Accepted costs:

- Significant surface area: capability registry, warning plumbing, preflight UI,
  and tests asserting the honesty (`check:capabilities`).
- It creates an obligation on marketing copy. Absolute claims like "every tool"
  or unqualified "PSD round-trip" directly contradict this ADR and are treated
  as defects.
- Reports are only as good as their coverage; a limitation that exists but is
  not reported is worse than one that is loudly reported, because it teaches
  users to trust a report that lies.
