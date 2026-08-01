import { describe, expect, it } from "vitest";
import { qualifiedUploadColumns } from "./postgres-upload-record.js";

describe("qualifiedUploadColumns", () => {
  it("qualifies both legacy upload URL columns without corrupting COALESCE", () => {
    const columns = qualifiedUploadColumns("upload");

    expect(columns).toContain(
      "COALESCE(upload.upload_url, upload.demo_upload_url) AS upload_url",
    );
    expect(columns).not.toContain("upload.COALESCE");
  });

  it("rejects an unsafe SQL alias", () => {
    expect(() => qualifiedUploadColumns("upload; DROP TABLE users")).toThrow(
      "Invalid PostgreSQL upload column alias.",
    );
  });
});
