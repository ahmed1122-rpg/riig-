# Browser support policy

## Automated release-qualified engines

MotionPrep qualifies its critical browser journeys against the pinned
Playwright Chromium, Firefox, and WebKit engines in six profiles:

- desktop Chromium at 1440 × 900;
- mobile Chromium using the Pixel 7 device profile.
- desktop Firefox at 1440 × 900;
- Firefox at a 412 × 915 mobile-sized viewport with touch input;
- desktop WebKit at 1440 × 900;
- mobile WebKit using the iPhone 15 device profile.

The release gate covers authentication, upload, PDF page/layer navigation,
review and export journeys, keyboard/focus behavior, RTL layout, and automated
accessibility checks. CI installs all three engines explicitly and a repository
contract fails if any engine or mobile-sized profile is removed. Current stable
Chrome, Edge, and Chrome on Android remain compatibility targets because they
share the Chromium engine family, but they are not installed as separate release
projects and an engine run is not branded-browser evidence.

## Branded-browser evidence boundary

Playwright Firefox and WebKit qualify the rendering engines and application
journeys above. They do not independently qualify a specific branded Firefox
release, macOS Safari, or iOS Safari. The application does not intentionally
block those browsers, but a production compatibility promise for them requires
manual evidence on the actual browser and operating-system combination.

Before making a branded Safari/iOS support claim:

1. verify PDF upload, layer-tree interactions, dialogs/focus, downloads, and RTL
   rendering manually on real Safari/iOS hardware;
2. record the browser/OS versions, screenshots, failures, and review cadence in
   release evidence;
3. assign an owner and regression test to every engine-specific defect.

This policy is an evidence boundary, not a user-agent policy. Unsupported means
that no production compatibility promise is made; it does not authorize silent
feature degradation or browser sniffing.
