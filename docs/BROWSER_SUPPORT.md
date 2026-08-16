# Browser support policy

## Automated release-qualified engines

MotionPrep qualifies its critical browser journeys against the pinned
Playwright Chromium, Firefox, and WebKit engines in six profiles:

- desktop Chromium at 1440 × 900;
- mobile Chromium using the Pixel 7 device profile.
- desktop Firefox at 1440 × 900;
- Firefox at a 412 × 915 mobile-sized viewport with touch input;
- desktop WebKit at 1440 × 900;
- WebKit at a 390 × 844 mobile-sized viewport with touch input. The Linux gate
  deliberately avoids Playwright's iOS-only `isMobile` emulation; real iOS
  remains a hardware gate below.

The release gate covers authentication, upload, PDF page/layer navigation,
review and export journeys, keyboard/focus behavior, RTL layout, and automated
accessibility checks. It builds and serves the production web bundle rather than
the Vite development module graph. CI supplies all three engines from the pinned
Playwright image, and a repository contract fails if any engine, mobile-sized
profile, or production-preview boundary is removed. Current stable
Chrome, Edge, and Chrome on Android remain compatibility targets because they
share the Chromium engine family, but they are not installed as separate release
projects and an engine run is not branded-browser evidence.

On Linux, every WebKit test runs in its own Playwright process and shard. Video
capture is disabled, traces begin on the first retry, and the phone-sized gate
uses DPR 1 with touch input; failure screenshots and retry traces remain
available. If a shard still exhausts its two Playwright retries, the WebKit
runner repeats that shard once in a new Playwright process; a second failed
process fails the release gate. This recovery changes no assertion and prevents
an already-crashed WebKitGTK process from poisoning its own final result. The CI
browser job uses the official Playwright image pinned to the package version and
an immutable digest, with a non-root user, an init process, and host IPC. These
limits preserve the complete journey and accessibility coverage while reducing
WebKitGTK renderer pressure.
Real device pixel density remains part of the Safari/iOS hardware gate below.

## Branded-browser evidence boundary

Playwright Firefox and WebKit qualify the rendering engines and application
journeys above. They do not independently qualify a specific branded Firefox
release, macOS Safari, or iOS Safari. The application does not intentionally
block those browsers, but a production compatibility promise for them requires
manual evidence on the actual browser and operating-system combination.

Before making a branded Safari/iOS support claim:

1. verify PDF upload, layer-tree interactions, dialogs/focus, downloads, and RTL
   rendering manually on real Safari/iOS hardware at its native pixel density;
2. record the browser/OS versions, screenshots, failures, and review cadence in
   release evidence;
3. assign an owner and regression test to every engine-specific defect.

This policy is an evidence boundary, not a user-agent policy. Unsupported means
that no production compatibility promise is made; it does not authorize silent
feature degradation or browser sniffing.
