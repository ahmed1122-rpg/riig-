import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  GetBucketVersioningCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  type GetObjectCommandOutput,
  type HeadObjectCommandOutput,
  S3Client,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import {
  assertWritableSize,
  collectStoredObject,
  createVerifiedObjectStream,
  ObjectStorageIntegrityError,
  ObjectStorageReadLimitError,
  type ObjectReadOptions,
  type ObjectStorage,
  type StoredObject,
  type StoredObjectMetadata,
  type StoredObjectStream,
  type StoredObjectWriteStream,
} from "./object-storage.js";

export { ObjectStorageIntegrityError } from "./object-storage.js";

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

  async ready(
    createIfMissing = false,
    timeoutMilliseconds = 5_000,
  ): Promise<void> {
    const requestOptions = {
      abortSignal: AbortSignal.timeout(timeoutMilliseconds),
    };
    try {
      await this.#client.send(
        new HeadBucketCommand({ Bucket: this.options.bucket }),
        requestOptions,
      );
    } catch (error) {
      if (!createIfMissing || !isMissing(error)) throw error;
      await this.#client.send(
        new CreateBucketCommand({ Bucket: this.options.bucket }),
        requestOptions,
      );
      await this.#client.send(
        new HeadBucketCommand({ Bucket: this.options.bucket }),
        requestOptions,
      );
    }
    if (this.options.requireVersioning) {
      const versioning = await this.#client.send(
        new GetBucketVersioningCommand({ Bucket: this.options.bucket }),
        requestOptions,
      );
      if (versioning.Status !== "Enabled") {
        throw new ObjectStorageVersioningError(this.options.bucket);
      }
    }
  }

  async put(object: StoredObject): Promise<StoredObjectMetadata> {
    assertWritableSize(object);
    const sha256 = createHash("sha256").update(object.body).digest("hex");
    return this.#putVerified({ ...object, sha256 });
  }

  async putStream(
    object: StoredObjectWriteStream,
  ): Promise<StoredObjectMetadata> {
    if (
      !Number.isSafeInteger(object.sizeBytes) ||
      object.sizeBytes < 0 ||
      !/^[a-f0-9]{64}$/u.test(object.sha256)
    ) {
      throw new ObjectStorageIntegrityError(object.key);
    }
    return this.#putVerified(object);
  }

  async #putVerified(
    object: StoredObject | StoredObjectWriteStream,
  ): Promise<StoredObjectMetadata> {
    const sha256 = "sha256" in object
      ? object.sha256
      : createHash("sha256").update(object.body).digest("hex");
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

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await this.#client.send(
        new ListObjectsV2Command({
          Bucket: this.options.bucket,
          Prefix: prefix,
          ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
        }),
      );
      for (const entry of response.Contents ?? []) {
        if (entry.Key) keys.push(entry.Key);
      }
      continuationToken = response.IsTruncated
        ? response.NextContinuationToken
        : undefined;
      if (response.IsTruncated && !continuationToken) {
        throw new Error("S3 object listing was truncated without a continuation token.");
      }
    } while (continuationToken);
    return keys.sort((left, right) => left.localeCompare(right));
  }

  async purge(
    keys: readonly string[],
    prefixes: readonly string[],
  ): Promise<void> {
    const exact = new Set(keys);
    const searchPrefixes = [...new Set([...prefixes, ...keys])];
    for (const prefix of searchPrefixes) {
      await this.#purgeVersions(prefix, exact, prefixes);
    }
    for (const prefix of searchPrefixes) {
      const remaining = await this.#listVersions(prefix, exact, prefixes);
      if (remaining.length > 0) {
        throw new Error(`S3 retained ${remaining.length} private object versions.`);
      }
    }
  }

  async inspect(key: string): Promise<StoredObjectMetadata | null> {
    const head = await this.#head(key);
    if (!head) return null;
    const metadata = metadataFromHead(key, head);
    if (!metadata) throw new ObjectStorageIntegrityError(key);
    return metadata;
  }

  async getStream(
    key: string,
    options: ObjectReadOptions = {},
  ): Promise<StoredObjectStream | null> {
    try {
      const response = await this.#client.send(
        new GetObjectCommand({
          Bucket: this.options.bucket,
          Key: key,
          ChecksumMode: "ENABLED",
        }),
        options.signal ? { abortSignal: options.signal } : undefined,
      );
      if (!response.Body) return null;
      const metadata = metadataFromResponse(key, response);
      if (!metadata) throw new ObjectStorageIntegrityError(key);
      if (
        options.maxBytes !== undefined &&
        metadata.sizeBytes > options.maxBytes
      ) {
        destroyResponseBody(response.Body);
        throw new ObjectStorageReadLimitError(
          key,
          metadata.sizeBytes,
          options.maxBytes,
        );
      }
      const source = await responseBodyAsReadable(response.Body);
      return {
        ...metadata,
        body: createVerifiedObjectStream(source, metadata, options.signal),
      };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async get(
    key: string,
    options: ObjectReadOptions = {},
  ): Promise<StoredObject | null> {
    return collectStoredObject(await this.getStream(key, options), options);
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

  async #purgeVersions(
    searchPrefix: string,
    exact: ReadonlySet<string>,
    prefixes: readonly string[],
  ): Promise<void> {
    for (;;) {
      const versions = await this.#listVersions(searchPrefix, exact, prefixes);
      if (versions.length === 0) return;
      for (let offset = 0; offset < versions.length; offset += 1_000) {
        const batch = versions.slice(offset, offset + 1_000);
        const response = await this.#client.send(new DeleteObjectsCommand({
          Bucket: this.options.bucket,
          Delete: { Objects: batch, Quiet: true },
        }));
        if (response.Errors?.length) {
          throw new Error(
            `S3 permanent purge failed for ${response.Errors.length} object versions.`,
          );
        }
      }
    }
  }

  async #listVersions(
    searchPrefix: string,
    exact: ReadonlySet<string>,
    prefixes: readonly string[],
  ): Promise<Array<{ Key: string; VersionId?: string }>> {
    const objects: Array<{ Key: string; VersionId?: string }> = [];
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    do {
      const response = await this.#client.send(new ListObjectVersionsCommand({
        Bucket: this.options.bucket,
        Prefix: searchPrefix,
        ...(keyMarker ? { KeyMarker: keyMarker } : {}),
        ...(versionIdMarker ? { VersionIdMarker: versionIdMarker } : {}),
      }));
      for (const item of [...(response.Versions ?? []), ...(response.DeleteMarkers ?? [])]) {
        if (!item.Key || !matchesPrivateTarget(item.Key, exact, prefixes)) continue;
        objects.push({ Key: item.Key, ...(item.VersionId ? { VersionId: item.VersionId } : {}) });
      }
      keyMarker = response.IsTruncated ? response.NextKeyMarker : undefined;
      versionIdMarker = response.IsTruncated
        ? response.NextVersionIdMarker
        : undefined;
      if (response.IsTruncated && !keyMarker) {
        throw new Error("S3 version listing was truncated without a key marker.");
      }
    } while (keyMarker);
    return objects;
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

function metadataFromResponse(
  key: string,
  response: GetObjectCommandOutput,
): StoredObjectMetadata | null {
  return metadataFromHead(key, response);
}

async function responseBodyAsReadable(
  body: GetObjectCommandOutput["Body"],
): Promise<Readable> {
  if (!body) throw new Error("S3 response body is missing.");
  if (body instanceof Readable) return body;
  if (Symbol.asyncIterator in body) {
    return Readable.from(body as AsyncIterable<Uint8Array>);
  }
  if (typeof body.transformToWebStream === "function") {
    return Readable.fromWeb(
      body.transformToWebStream() as Parameters<typeof Readable.fromWeb>[0],
    );
  }
  return Readable.from([
    Buffer.from(await body.transformToByteArray()),
  ]);
}

function destroyResponseBody(body: GetObjectCommandOutput["Body"]): void {
  const destroy = (body as { destroy?: () => void } | undefined)?.destroy;
  if (typeof destroy === "function") destroy.call(body);
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

function matchesPrivateTarget(
  key: string,
  exact: ReadonlySet<string>,
  prefixes: readonly string[],
): boolean {
  return exact.has(key) || prefixes.some((prefix) => key.startsWith(prefix));
}
