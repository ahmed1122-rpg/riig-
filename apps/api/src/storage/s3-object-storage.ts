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
  S3Client,
} from "@aws-sdk/client-s3";
import type { ObjectStorage, StoredObject } from "./object-storage.js";

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

  async put(object: StoredObject): Promise<void> {
    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: object.key,
        Body: object.body,
        ContentType: object.contentType,
        ContentLength: object.sizeBytes,
        ChecksumAlgorithm: "SHA256",
        ...(this.options.encryptionMode === "sse-s3"
          ? { ServerSideEncryption: "AES256" as const }
          : {}),
      }),
    );
    if (this.options.encryptionMode !== "none") {
      const metadata = await this.#client.send(
        new HeadObjectCommand({
          Bucket: this.options.bucket,
          Key: object.key,
        }),
      );
      const encrypted =
        this.options.encryptionMode === "sse-s3"
          ? metadata.ServerSideEncryption === "AES256"
          : Boolean(metadata.ServerSideEncryption);
      if (!encrypted) {
        await this.#client.send(
          new DeleteObjectCommand({
            Bucket: this.options.bucket,
            Key: object.key,
          }),
        );
        throw new ObjectStorageEncryptionError(object.key);
      }
    }
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

function isMissing(error: unknown): boolean {
  if (error instanceof NoSuchKey || error instanceof NotFound) return true;
  if (!error || typeof error !== "object") return false;
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
    ?.httpStatusCode;
  const name = (error as { name?: string }).name;
  return status === 404 || name === "NoSuchBucket" || name === "NotFound";
}
