import assert from "node:assert/strict";
import test from "node:test";
import { validateReleaseLegalDocument } from "./verify-release-legal.mjs";

const approved = [
  "<!doctype html>",
  '<meta name="motionprep:legal-status" content="approved">',
  '<meta name="motionprep:legal-reviewed-at" content="2026-08-20">',
  "<h1>Approved policy</h1>",
].join("\n");

test("accepts explicit approval metadata without draft markers", () => {
  assert.deepEqual(
    validateReleaseLegalDocument(approved, { label: "Terms of use" }),
    [],
  );
});

test("rejects draft and placeholder legal text", () => {
  const violations = validateReleaseLegalDocument(
    `${approved}\n<p>مسودة تشغيلية قبل الإطلاق العام</p>`,
    { label: "Terms of use" },
  );
  assert.match(violations.join("\n"), /draft or placeholder/u);
});

test("requires controller identity and a visible privacy contact", () => {
  const missing = validateReleaseLegalDocument(approved, {
    label: "Privacy policy",
    requireControllerAndContact: true,
  });
  assert.match(missing.join("\n"), /data controller/u);
  assert.match(missing.join("\n"), /contact email/u);

  const complete = `${approved}\n` +
    '<meta name="motionprep:data-controller" content="Example Company">\n' +
    '<a href="mailto:privacy@example.test">Privacy contact</a>';
  assert.deepEqual(
    validateReleaseLegalDocument(complete, {
      label: "Privacy policy",
      requireControllerAndContact: true,
    }),
    [],
  );
});
