# Browser support policy

## Automated release-qualified engines

MotionPrep qualifies its critical browser journeys against the pinned
Playwright Chromium, Firefox, and WebKit engines in five release profiles:

- desktop Chromium at 1440 × 900;
- mobile Chromium using the Pixel 7 device profile;
- desktop Firefox at 1440 × 900;
- Firefox at a 412 × 915 mobile-sized viewport with touch input;
- desktop WebKit at 1440 × 900.

The Linux release gate deliberately excludes synthetic phone-sized WebKitGTK:
repeated renderer crashes occurred across unrelated authentication, PDF, image,
accessibility, and download steps, including in fresh isolated processes. Such a
profile produces nondeterministic infrastructure evidence rather than a credible
iOS Safari qualification. Chromium and Firefox retain automated phone and touch
coverage; real Safari/iOS remains the hardware gate below.

The release gate covers authentication, upload, PDF page/layer navigation,
review and export journeys, keyboard/focus behavior, RTL layout, and automated
accessibility checks. It builds and serves the production web bundle rather than
the Vite development module graph. CI runs Chromium, Firefox, and WebKit in
separate parallel jobs created from the same pinned Playwright image, so a prior
engine cannot leave renderer state or resource pressure for the next one. A
repository contract fails if any engine job, mobile-sized profile, or
production-preview boundary is removed. Current stable
Chrome, Edge, and Chrome on Android remain compatibility targets because they
share the Chromium engine family, but they are not installed as separate release
projects and an engine run is not branded-browser evidence.

On Linux, every desktop WebKit test runs in its own Playwright process and shard.
Video capture is disabled, traces begin on the first retry, and failure
screenshots and retry traces remain available. If a shard still exhausts its two
Playwright retries, the WebKit runner repeats that shard once in a new Playwright
process; a second failed process fails the release gate. This recovery changes
no assertion and prevents an already-crashed WebKitGTK process from poisoning
its own final result. The CI browser job uses the official Playwright image
pinned to the package version and an immutable digest, with a non-root user, an
init process, and host IPC. These limits preserve the complete journey and
accessibility coverage while reducing WebKitGTK renderer pressure.
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
