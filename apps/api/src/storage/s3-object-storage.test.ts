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
import { Readable } from "node:stream";
import {
  ObjectStorageReadAbortedError,
  ObjectStorageReadLimitError,
} from "./object-storage.js";
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
  send: (
    command: object,
    options?: { abortSignal?: AbortSignal },
  ) => Promise<unknown>,
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
  it("rejects an inconsistent write before contacting S3", async () => {
    const commands: object[] = [];
    const storage = storageWith(async (command) => {
      commands.push(command);
      return {};
    });

    await expect(
      storage.put({
        key: "sources/project/inconsistent.bin",
        contentType: "application/octet-stream",
        sizeBytes: 100,
        body: Buffer.from("short"),
      }),
    ).rejects.toBeInstanceOf(ObjectStorageIntegrityError);
    expect(commands).toHaveLength(0);
  });

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

  it("bounds readiness when the provider does not respond", async () => {
    let receivedSignal: AbortSignal | undefined;
    const storage = storageWith(
      (_command, options) =>
        new Promise((_resolve, reject) => {
          receivedSignal = options?.abortSignal;
          receivedSignal?.addEventListener(
            "abort",
            () => reject(receivedSignal?.reason),
            { once: true },
          );
        }),
    );

    await expect(storage.ready(false, 10)).rejects.toMatchObject({
      name: "TimeoutError",
    });
    expect(receivedSignal?.aborted).toBe(true);
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
          ...storedHead(source, "image/png", "AES256"),
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

  it("streams a verified object and preserves chunk boundaries for backpressure", async () => {
    const source = Buffer.from("motionprep-stream");
    const storage = storageWith(async (command) => {
      if (command instanceof GetObjectCommand) {
        return {
          ...storedHead(source, "application/octet-stream", "AES256"),
          Body: Readable.from([source.subarray(0, 5), source.subarray(5)]),
        };
      }
      return {};
    });

    const object = await storage.getStream("artifacts/project/export.bin");
    const chunks: Buffer[] = [];
    for await (const chunk of object!.body) chunks.push(Buffer.from(chunk));

    expect(Buffer.concat(chunks)).toEqual(source);
  });

  it("terminates a stream whose bytes do not match persisted integrity metadata", async () => {
    const expected = Buffer.from("expected");
    const storage = storageWith(async (command) => {
      if (command instanceof GetObjectCommand) {
        return {
          ...storedHead(expected, "application/octet-stream", "AES256"),
          Body: Readable.from([Buffer.from("tampered")]),
        };
      }
      return {};
    });
    const object = await storage.getStream("artifacts/project/corrupt.bin");

    await expect(async () => {
      for await (const _chunk of object!.body) {
        // Consumption is required to complete the streaming integrity check.
      }
    }).rejects.toBeInstanceOf(ObjectStorageIntegrityError);
  });

  it("forwards cancellation to S3 and destroys the response stream", async () => {
    const source = Buffer.from("cancelled-stream");
    const responseBody = new Readable({ read() {} });
    let receivedSignal: AbortSignal | undefined;
    const storage = storageWith(async (command, options) => {
      if (command instanceof GetObjectCommand) {
        receivedSignal = options?.abortSignal;
        return {
          ...storedHead(source, "application/octet-stream", "AES256"),
          Body: responseBody,
        };
      }
      return {};
    });
    const controller = new AbortController();
    const object = await storage.getStream(
      "artifacts/project/cancelled.bin",
      { signal: controller.signal },
    );

    controller.abort();

    expect(receivedSignal).toBe(controller.signal);
    await expect(async () => {
      for await (const _chunk of object!.body) {
        // Cancellation must reject the consumer rather than end successfully.
      }
    }).rejects.toBeInstanceOf(ObjectStorageReadAbortedError);
    expect(responseBody.destroyed).toBe(true);
  });

  it("rejects a buffered read before transfer when metadata exceeds its limit", async () => {
    const source = Buffer.from("too-large");
    const responseBody = Readable.from([source]);
    const storage = storageWith(async (command) => {
      if (command instanceof GetObjectCommand) {
        return {
          ...storedHead(source, "application/octet-stream", "AES256"),
          Body: responseBody,
        };
      }
      return {};
    });

    await expect(
      storage.get("sources/project/large.bin", { maxBytes: 4 }),
    ).rejects.toBeInstanceOf(ObjectStorageReadLimitError);
    expect(responseBody.destroyed).toBe(true);
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
