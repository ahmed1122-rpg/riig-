import { createHash } from "node:crypto";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  GetBucketVersioningCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import {
  ObjectStorageEncryptionError,
  ObjectStorageIntegrityError,
  ObjectStorageVersioningError,
  S3ObjectStorage,
} from "./s3-object-storage.js";

function storedHead(
  source: Buffer,
  contentType: string,
  serverSideEncryption?: string,
) {
  const sha256 = createHash("sha256").update(source).digest("hex");
  return {
    ContentLength: source.byteLength,
    ContentType: contentType,
    ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
    Metadata: { "motionprep-sha256": sha256 },
    ...(serverSideEncryption
      ? { ServerSideEncryption: serverSideEncryption }
      : {}),
  };
}

function storageWith(
  send: (command: object) => Promise<unknown>,
  encryptionMode: "none" | "bucket-default" | "sse-s3" = "sse-s3",
): S3ObjectStorage {
  const client = {
    send,
    destroy() {},
  } as unknown as S3Client;
  return new S3ObjectStorage(
    {
      region: "us-east-1",
      bucket: "motionprep-test",
      accessKeyId: "test-access",
      secretAccessKey: "test-secret",
      forcePathStyle: true,
      encryptionMode,
      requireVersioning: false,
    },
    client,
  );
}

describe("S3ObjectStorage", () => {
  it("creates a missing development bucket and verifies it", async () => {
    const commands: object[] = [];
    let headAttempts = 0;
    const storage = storageWith(async (command) => {
      commands.push(command);
      if (command instanceof HeadBucketCommand && headAttempts++ === 0) {
        const error = new Error("missing") as Error & {
          $metadata: { httpStatusCode: number };
        };
        error.$metadata = { httpStatusCode: 404 };
        throw error;
      }
      return {};
    });

    await storage.ready(true);

    expect(commands).toHaveLength(3);
    expect(commands[0]).toBeInstanceOf(HeadBucketCommand);
    expect(commands[1]).toBeInstanceOf(CreateBucketCommand);
    expect(commands[2]).toBeInstanceOf(HeadBucketCommand);
  });

  it("requires an enabled versioning state when configured", async () => {
    const commands: object[] = [];
    const storage = new S3ObjectStorage(
      {
        region: "us-east-1",
        bucket: "motionprep-test",
        accessKeyId: "test-access",
        secretAccessKey: "test-secret",
        forcePathStyle: true,
        encryptionMode: "sse-s3",
        requireVersioning: true,
      },
      {
        async send(command: object) {
          commands.push(command);
          if (command instanceof GetBucketVersioningCommand) {
            return { Status: "Enabled" };
          }
          return {};
        },
        destroy() {},
      } as unknown as S3Client,
    );

    await storage.ready(false);

    expect(commands[1]).toBeInstanceOf(GetBucketVersioningCommand);
  });

  it("rejects a suspended versioning state", async () => {
    const storage = new S3ObjectStorage(
      {
        region: "us-east-1",
        bucket: "motionprep-test",
        accessKeyId: "test-access",
        secretAccessKey: "test-secret",
        forcePathStyle: true,
        encryptionMode: "sse-s3",
        requireVersioning: true,
      },
      {
        async send(command: object) {
          if (command instanceof GetBucketVersioningCommand) {
            return { Status: "Suspended" };
          }
          return {};
        },
        destroy() {},
      } as unknown as S3Client,
    );

    await expect(storage.ready(false)).rejects.toBeInstanceOf(
      ObjectStorageVersioningError,
    );
  });

  it("stores, reads, and deletes an encrypted object", async () => {
    const commands: object[] = [];
    const source = Buffer.from("motionprep");
    const storage = storageWith(async (command) => {
      commands.push(command);
      if (command instanceof GetObjectCommand) {
        return {
          ContentType: "image/png",
          Body: {
            transformToByteArray: async () => new Uint8Array(source),
          },
        };
      }
      if (command instanceof HeadObjectCommand) {
        return storedHead(source, "image/png", "AES256");
      }
      return {};
    });

    await storage.put({
      key: "sources/project/source.png",
      contentType: "image/png",
      sizeBytes: source.byteLength,
      body: source,
    });
    const loaded = await storage.get("sources/project/source.png");
    await storage.delete("sources/project/source.png");

    expect(commands[0]).toBeInstanceOf(PutObjectCommand);
    expect(
      (commands[0] as PutObjectCommand).input.ServerSideEncryption,
    ).toBe("AES256");
    expect(loaded?.body).toEqual(source);
    expect(commands[1]).toBeInstanceOf(HeadObjectCommand);
    expect(commands[3]).toBeInstanceOf(DeleteObjectCommand);
  });

  it("accepts a verified bucket encryption default", async () => {
    const commands: object[] = [];
    const source = Buffer.from("pdf");
    const storage = storageWith(async (command) => {
      commands.push(command);
      if (command instanceof HeadObjectCommand) {
        return storedHead(source, "application/pdf", "aws:kms");
      }
      return {};
    }, "bucket-default");

    await storage.put({
      key: "source/project/book.pdf",
      contentType: "application/pdf",
      sizeBytes: source.byteLength,
      body: source,
    });

    expect(commands[0]).toBeInstanceOf(PutObjectCommand);
    expect(
      (commands[0] as PutObjectCommand).input.ServerSideEncryption,
    ).toBeUndefined();
    expect(commands[1]).toBeInstanceOf(HeadObjectCommand);
  });

  it("deletes an object when the promised bucket encryption is absent", async () => {
    const commands: object[] = [];
    const source = Buffer.from("pdf");
    const storage = storageWith(async (command) => {
      commands.push(command);
      if (command instanceof HeadObjectCommand) {
        return storedHead(source, "application/pdf");
      }
      return {};
    }, "bucket-default");

    await expect(
      storage.put({
        key: "source/project/unsafe.pdf",
        contentType: "application/pdf",
        sizeBytes: source.byteLength,
        body: source,
      }),
    ).rejects.toBeInstanceOf(ObjectStorageEncryptionError);

    expect(commands[1]).toBeInstanceOf(HeadObjectCommand);
    expect(commands[2]).toBeInstanceOf(DeleteObjectCommand);
  });

  it("deletes an object when explicit SSE-S3 is not confirmed", async () => {
    const commands: object[] = [];
    const source = Buffer.from("pdf");
    const storage = storageWith(async (command) => {
      commands.push(command);
      if (command instanceof HeadObjectCommand) {
        return storedHead(source, "application/pdf", "aws:kms");
      }
      return {};
    });

    await expect(
      storage.put({
        key: "source/project/wrong-encryption.pdf",
        contentType: "application/pdf",
        sizeBytes: source.byteLength,
        body: source,
      }),
    ).rejects.toBeInstanceOf(ObjectStorageEncryptionError);

    expect(commands[0]).toBeInstanceOf(PutObjectCommand);
    expect(commands[1]).toBeInstanceOf(HeadObjectCommand);
    expect(commands[2]).toBeInstanceOf(DeleteObjectCommand);
  });

  it("can omit request encryption only for explicit non-production storage", async () => {
    const commands: object[] = [];
    const source = Buffer.from([1]);
    const storage = storageWith(async (command) => {
      commands.push(command);
      if (command instanceof HeadObjectCommand) {
        return storedHead(source, "application/octet-stream");
      }
      return {};
    }, "none");

    await storage.put({
      key: "integration/plain.bin",
      contentType: "application/octet-stream",
      sizeBytes: source.byteLength,
      body: source,
    });

    expect(commands).toHaveLength(2);
    expect(
      (commands[0] as PutObjectCommand).input.ServerSideEncryption,
    ).toBeUndefined();
  });

  it("deletes an object whose persisted metadata does not match the upload", async () => {
    const commands: object[] = [];
    const source = Buffer.from("motionprep");
    const storage = storageWith(async (command) => {
      commands.push(command);
      if (command instanceof HeadObjectCommand) {
        return storedHead(Buffer.from("different"), "image/png", "AES256");
      }
      return {};
    });

    await expect(
      storage.put({
        key: "sources/project/corrupt.png",
        contentType: "image/png",
        sizeBytes: source.byteLength,
        body: source,
      }),
    ).rejects.toBeInstanceOf(ObjectStorageIntegrityError);

    expect(commands[2]).toBeInstanceOf(DeleteObjectCommand);
  });

  it("allows the AWS default credential provider chain", () => {
    const storage = new S3ObjectStorage({
      region: "eu-central-1",
      bucket: "motionprep-production",
      forcePathStyle: false,
      encryptionMode: "bucket-default",
      requireVersioning: true,
    });

    storage.destroy();
  });

  it("rejects partial explicit credentials", () => {
    expect(
      () =>
        new S3ObjectStorage({
          region: "eu-central-1",
          bucket: "motionprep-production",
          accessKeyId: "incomplete",
          forcePathStyle: false,
          encryptionMode: "bucket-default",
          requireVersioning: true,
        }),
    ).toThrow(/access key and secret key together/u);
  });
});
