import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  GetBucketVersioningCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  type HeadObjectCommandOutput,
  S3Client,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import type {
  ObjectStorage,
  StoredObject,
  StoredObjectMetadata,
} from "./object-storage.js";

export interface S3ObjectStorageOptions {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  forcePathStyle: boolean;
  encryptionMode: "none" | "bucket-default" | "sse-s3";
  requireVersioning: boolean;
}

export class S3ObjectStorage implements ObjectStorage {
  readonly #client: S3Client;

  constructor(
    private readonly options: S3ObjectStorageOptions,
    client?: S3Client,
  ) {
    const hasAccessKey = Boolean(options.accessKeyId);
    const hasSecretKey = Boolean(options.secretAccessKey);
    if (
      hasAccessKey !== hasSecretKey ||
      (options.sessionToken && !(hasAccessKey && hasSecretKey))
    ) {
      throw new Error(
        "S3 credentials must provide access key and secret key together; a session token also requires both.",
      );
    }
    this.#client =
      client ??
      new S3Client({
        ...(options.endpoint ? { endpoint: options.endpoint } : {}),
        region: options.region,
        forcePathStyle: options.forcePathStyle,
        ...(options.accessKeyId && options.secretAccessKey
          ? {
              credentials: {
                accessKeyId: options.accessKeyId,
                secretAccessKey: options.secretAccessKey,
                ...(options.sessionToken
                  ? { sessionToken: options.sessionToken }
                  : {}),
              },
            }
          : {}),
      });
  }

  async ready(createIfMissing = false): Promise<void> {
    try {
      await this.#client.send(
        new HeadBucketCommand({ Bucket: this.options.bucket }),
      );
    } catch (error) {
      if (!createIfMissing || !isMissing(error)) throw error;
      await this.#client.send(
        new CreateBucketCommand({ Bucket: this.options.bucket }),
      );
      await this.#client.send(
        new HeadBucketCommand({ Bucket: this.options.bucket }),
      );
    }
    if (this.options.requireVersioning) {
      const versioning = await this.#client.send(
        new GetBucketVersioningCommand({ Bucket: this.options.bucket }),
      );
      if (versioning.Status !== "Enabled") {
        throw new ObjectStorageVersioningError(this.options.bucket);
      }
    }
  }

  async put(object: StoredObject): Promise<StoredObjectMetadata> {
    const sha256 = createHash("sha256").update(object.body).digest("hex");
    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: object.key,
        Body: object.body,
        ContentType: object.contentType,
        ContentLength: object.sizeBytes,
        ChecksumAlgorithm: "SHA256",
        ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
        Metadata: { "motionprep-sha256": sha256 },
        ...(this.options.encryptionMode === "sse-s3"
          ? { ServerSideEncryption: "AES256" as const }
          : {}),
      }),
    );
    const head = await this.#head(object.key);
    const metadata = head ? metadataFromHead(object.key, head) : null;
    if (
      !metadata ||
      metadata.sizeBytes !== object.sizeBytes ||
      metadata.contentType !== object.contentType ||
      metadata.sha256 !== sha256
    ) {
      await this.delete(object.key);
      throw new ObjectStorageIntegrityError(object.key);
    }
    const encrypted =
      this.options.encryptionMode === "none" ||
      (this.options.encryptionMode === "sse-s3"
        ? head?.ServerSideEncryption === "AES256"
        : Boolean(head?.ServerSideEncryption));
    if (!encrypted) {
      await this.delete(object.key);
      throw new ObjectStorageEncryptionError(object.key);
    }
    return metadata;
  }

  async inspect(key: string): Promise<StoredObjectMetadata | null> {
    const head = await this.#head(key);
    return head ? metadataFromHead(key, head) : null;
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      const response = await this.#client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
      );
      if (!response.Body) return null;
      const body = Buffer.from(await response.Body.transformToByteArray());
      return {
        key,
        contentType: response.ContentType ?? "application/octet-stream",
        sizeBytes: body.byteLength,
        body,
      };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.#client.send(
      new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }),
    );
  }

  destroy(): void {
    this.#client.destroy();
  }

  async #head(key: string): Promise<HeadObjectCommandOutput | null> {
    try {
      return await this.#client.send(
        new HeadObjectCommand({
          Bucket: this.options.bucket,
          Key: key,
          ChecksumMode: "ENABLED",
        }),
      );
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }
}

export class ObjectStorageEncryptionError extends Error {
  readonly code = "OBJECT_STORAGE_ENCRYPTION_REQUIRED";

  constructor(key: string) {
    super(`Object storage did not apply the required encryption to ${key}.`);
  }
}

export class ObjectStorageVersioningError extends Error {
  readonly code = "OBJECT_STORAGE_VERSIONING_REQUIRED";

  constructor(bucket: string) {
    super(`Object storage bucket ${bucket} must have versioning enabled.`);
  }
}

export class ObjectStorageIntegrityError extends Error {
  readonly code = "OBJECT_STORAGE_INTEGRITY_FAILED";

  constructor(key: string) {
    super(`Object storage did not preserve the expected metadata for ${key}.`);
  }
}

function metadataFromHead(
  key: string,
  head: HeadObjectCommandOutput,
): StoredObjectMetadata | null {
  const providerChecksum = checksumHex(head.ChecksumSHA256);
  const applicationChecksum = head.Metadata?.["motionprep-sha256"]?.toLowerCase();
  const sha256 = providerChecksum ?? applicationChecksum;
  if (
    head.ContentLength === undefined ||
    !head.ContentType ||
    !sha256 ||
    !/^[a-f0-9]{64}$/u.test(sha256)
  ) {
    return null;
  }
  return {
    key,
    contentType: head.ContentType,
    sizeBytes: head.ContentLength,
    sha256,
  };
}

function checksumHex(value: string | undefined): string | null {
  if (!value) return null;
  const bytes = Buffer.from(value, "base64");
  return bytes.byteLength === 32 ? bytes.toString("hex") : null;
}

function isMissing(error: unknown): boolean {
  if (error instanceof NoSuchKey || error instanceof NotFound) return true;
  if (!error || typeof error !== "object") return false;
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
    ?.httpStatusCode;
  const name = (error as { name?: string }).name;
  return status === 404 || name === "NoSuchBucket" || name === "NotFound";
}
