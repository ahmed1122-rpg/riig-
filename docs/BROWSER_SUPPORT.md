# Browser support policy

## Automated release-qualified engine

MotionPrep qualifies its critical browser journeys against the pinned
Playwright Chromium engine in two profiles:

- desktop Chromium at 1440 × 900;
- mobile Chromium using the Pixel 7 device profile.

The release gate covers authentication, upload, PDF page/layer navigation,
review and export journeys, keyboard/focus behavior, RTL layout, and automated
accessibility checks. CI installs Chromium explicitly. Current stable Chrome,
Edge, and Chrome on Android are the compatibility target because they share the
engine family, but they are not installed as separate release projects and a
passing Chromium run is not branded-browser evidence.

## Best-effort browsers

Branded Chrome/Edge, current Firefox, Safari, and iOS browsers are best-effort
where they are not explicitly covered above. The application does not
intentionally block them, but they are not independently release-qualified until
equivalent Playwright Firefox/WebKit projects pass the same critical journeys
in CI and any engine-specific defects have an owner and regression test.

Before widening the production support claim:

1. add pinned Firefox and WebKit projects to `playwright.config.ts`;
2. install those engines in CI and the release-source gate;
3. pass the complete critical-journey and Axe matrix on desktop and mobile-sized
   viewports;
4. verify PDF upload, layer-tree interactions, dialogs/focus, downloads, and RTL
   rendering manually on real Safari/iOS hardware;
5. record the browser/version matrix and review cadence in release evidence.

This policy is an evidence boundary, not a user-agent policy. Unsupported means
that no production compatibility promise is made; it does not authorize silent
feature degradation or browser sniffing.
