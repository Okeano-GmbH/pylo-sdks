// File upload machinery shared by the server client and the Next.js hooks.
//
// Pylo uploads are a two-step flow (not a direct-to-S3 presigned flow):
//   1. The `createUpload` mutation returns an upload URL `{ id, url }` — `id` is the
//      future pyloMedia id, `url` is a Pylo fileservice endpoint with an
//      embedded, expiring JWT (valid ~1h).
//   2. The file bytes are POSTed to that url as multipart/form-data. The JWT
//      in the url is the credential — no auth headers are needed, so browsers
//      can upload directly without proxying bytes through the app server.
// The pyloMedia row (file_name, file_size_bytes, …) only materializes after
// step 2 completes; don't query it between the steps.

import { PyloError } from "./client.js";
import { capitalize } from "./query-builder.js";
import { buildUpsertMutation } from "./mutation-builder.js";
import type { EntityName, EntityRelations } from "./types.js";

export const CREATE_UPLOAD_MUTATION = `mutation CreateUpload($input: UploadFileInput) {
  createUpload(input: $input) {
    id
    url
  }
}`;

export const CREATE_DOWNLOAD_MUTATION = `mutation CreateDownload($id: ID!) {
  createDownload(id: $id) {
    id
    url
  }
}`;

export interface UploadUrl {
  /** The id of the pyloMedia row the upload will create. */
  id: string;
  /** Expiring upload endpoint — POST the bytes here as multipart/form-data. */
  url: string;
}

export interface UploadProgress {
  /** Bytes sent so far. */
  loaded: number;
  /** Total bytes to send. */
  total: number;
  /** 0–100, rounded. */
  percent: number;
}

export type UploadSource = File | Blob | ArrayBuffer | ArrayBufferView;

/**
 * `"<entity>.<relation>"` path to a pyloMedia relation, e.g. `"contact.avatar"`.
 * Autocompletes entity/relation names from the schema but accepts any string
 * (the backend's Pascal-case form `"Contact.avatar"` works too).
 */
export type EntityRelationPath<S> =
  | {
      [E in EntityName<S>]: `${E}.${Extract<keyof EntityRelations<S, E>, string>}`;
    }[EntityName<S>]
  | (string & {});

export interface CreateUploadUrlOptions<S = any> {
  /**
   * The pyloMedia relation the file is destined for, e.g. `"contact.avatar"`.
   * The relation's mime-type/extension allowlists are enforced on upload.
   * Omit to upload unrestricted, unattached media.
   */
  entityRelationPath?: EntityRelationPath<S>;
  /** Create a persistent public download URL (no JWT). Requires `entityRelationPath`. */
  isPublic?: boolean;
}

export interface UploadAttachTarget {
  /** Id of the record the file should be attached to. */
  id: string;
  /** `"set"` for single relations (default), `"add"` to append to a list relation. */
  mode?: "set" | "add";
}

export interface UploadOptions<S = any> extends CreateUploadUrlOptions<S> {
  /** Required when the source is not a `File` (raw bytes / Blob have no name). */
  fileName?: string;
  /** Overrides the source's mime type. */
  mimeType?: string;
  /** Attach the uploaded file to this record via the `entityRelationPath` relation. */
  attachTo?: UploadAttachTarget;
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}

export interface PyloUploadedFile {
  /** The pyloMedia id — connect it to records via `<relation>_set` / `<relation>_add`. */
  id: string;
  fileName: string;
  mimeType: string | undefined;
  size: number;
}

/** The `UploadFileInput` payload of the `createUpload` mutation. */
export interface CreateUploadInput {
  entity_relation_path: string;
  is_public?: boolean;
}

export function lowercaseFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

export function splitEntityRelationPath(path: string): {
  entity: string;
  relation: string;
} {
  const separator = path.indexOf(".");
  if (separator <= 0 || separator === path.length - 1) {
    throw new PyloError(
      `Invalid entity relation path "${path}" — expected "<entity>.<relation>", e.g. "contact.avatar"`,
    );
  }
  return { entity: path.slice(0, separator), relation: path.slice(separator + 1) };
}

// The backend expects the Pascal-case entity name in `entity_relation_path`
// ("Contact.avatar") while SDK entity keys are camel-case — accept both.
export function normalizeEntityRelationPath(path: string): string {
  const { entity, relation } = splitEntityRelationPath(path);
  return `${capitalize(entity)}.${relation}`;
}

// The single pre-flight check for every upload entry point (server client and
// browser hook alike): validates the option combination and builds the
// `createUpload` input. `null` means an unrestricted, unattached upload.
//
// `fileCount` lets batch callers reject an unsatisfiable `attachTo` before any
// bytes go over the wire — a `"set"` relation holds one file, so a multi-file
// batch would otherwise upload everything and then keep only the last one.
export function buildCreateUploadInput<S>(
  options?: UploadOptions<S>,
  fileCount = 1,
): CreateUploadInput | null {
  if (options?.entityRelationPath === undefined) {
    if (options?.isPublic !== undefined) {
      throw new PyloError("isPublic requires entityRelationPath");
    }
    if (options?.attachTo !== undefined) {
      throw new PyloError("attachTo requires entityRelationPath");
    }
    return null;
  }

  if (options.attachTo !== undefined) {
    assertAttachableBatch(options.attachTo, fileCount);
  }

  return {
    entity_relation_path: normalizeEntityRelationPath(options.entityRelationPath),
    ...(options.isPublic !== undefined ? { is_public: options.isPublic } : {}),
  };
}

function assertAttachableBatch(attachTo: UploadAttachTarget, fileCount: number): void {
  if (attachTo.mode === "add") return;
  if (fileCount > 1) {
    throw new PyloError(
      `attachTo mode "set" replaces the relation with a single file, but ${fileCount} files were given — use mode: "add" for list relations, or attach the files yourself.`,
    );
  }
}

// The upsert that connects uploaded pyloMedia rows to their parent record.
// One mutation for the whole batch: concurrent per-file upserts against the
// same record overwrite each other.
export function buildAttachMutation(
  entityRelationPath: string,
  mediaIds: string | string[],
  attachTo: UploadAttachTarget,
): {
  query: string;
  variables: Record<string, unknown>;
  entityKey: string;
  mutationKey: string;
} {
  const ids = Array.isArray(mediaIds) ? mediaIds : [mediaIds];
  const { entity, relation } = splitEntityRelationPath(entityRelationPath);
  const entityKey = lowercaseFirst(entity);
  const pascalName = capitalize(entityKey);

  assertAttachableBatch(attachTo, ids.length);

  const input =
    attachTo.mode === "add"
      ? { id: attachTo.id, [`${relation}_add`]: ids.map((id) => ({ id })) }
      : { id: attachTo.id, [`${relation}_set`]: { id: ids[0]! } };

  const { query, variables } = buildUpsertMutation(entityKey, pascalName, input);
  return { query, variables, entityKey, mutationKey: `update${pascalName}` };
}

export function toUploadPart(
  source: UploadSource,
  options?: { fileName?: string; mimeType?: string },
): { blob: Blob; fileName: string; mimeType: string | undefined } {
  if (typeof File !== "undefined" && source instanceof File) {
    const fileName = options?.fileName ?? source.name;
    const mimeType = options?.mimeType ?? (source.type || undefined);
    const blob =
      options?.mimeType !== undefined && options.mimeType !== source.type
        ? source.slice(0, source.size, options.mimeType)
        : source;
    return { blob, fileName, mimeType };
  }

  if (typeof Blob !== "undefined" && source instanceof Blob) {
    const fileName = options?.fileName;
    if (!fileName) {
      throw new PyloError("fileName is required when uploading a Blob");
    }
    const mimeType = options?.mimeType ?? (source.type || undefined);
    const blob =
      options?.mimeType !== undefined && options.mimeType !== source.type
        ? source.slice(0, source.size, options.mimeType)
        : source;
    return { blob, fileName, mimeType };
  }

  const fileName = options?.fileName;
  if (!fileName) {
    throw new PyloError("fileName is required when uploading raw bytes");
  }
  let bytes: Uint8Array<ArrayBuffer>;
  if (source instanceof ArrayBuffer) {
    bytes = new Uint8Array(source);
  } else if (ArrayBuffer.isView(source)) {
    // SharedArrayBuffer-backed views don't occur in practice — assert the type.
    bytes = new Uint8Array(
      source.buffer,
      source.byteOffset,
      source.byteLength,
    ) as Uint8Array<ArrayBuffer>;
  } else {
    throw new PyloError("Unsupported upload source — expected File, Blob, ArrayBuffer, or a typed array");
  }
  const blob = new Blob(
    [bytes],
    options?.mimeType !== undefined ? { type: options.mimeType } : {},
  );
  return { blob, fileName, mimeType: options?.mimeType };
}

// The fileservice responds `{ success, error }` with 2xx on success.
function assertUploadSucceeded(status: number, body: string): void {
  let parsed: { success?: boolean; error?: string | null } | undefined;
  try {
    parsed = JSON.parse(body) as { success?: boolean; error?: string | null };
  } catch {
    // non-JSON body — fall back to the status code
  }
  if (status >= 200 && status < 300 && parsed?.success !== false) return;
  throw new PyloError(parsed?.error ?? `File upload failed with status ${status}`);
}

function createAbortError(): Error {
  const error = new PyloError("File upload aborted");
  error.name = "AbortError";
  return error;
}

// Minimal XMLHttpRequest surface — core compiles without the DOM lib, and XHR
// is only reached in browsers (fetch has no upload progress events there).
interface XhrProgressEvent {
  lengthComputable: boolean;
  loaded: number;
  total: number;
}
interface XhrLike {
  open(method: string, url: string): void;
  send(body: unknown): void;
  abort(): void;
  readonly status: number;
  readonly responseText: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  upload: { onprogress: ((event: XhrProgressEvent) => void) | null };
}

/**
 * POSTs the file bytes to an upload URL. Uses XMLHttpRequest when
 * available (byte-level progress); falls back to fetch elsewhere (Node), where
 * progress is only reported at 0% and 100%.
 */
export function uploadToUrl(
  url: string,
  blob: Blob,
  fileName: string,
  options?: { onProgress?: (progress: UploadProgress) => void; signal?: AbortSignal },
): Promise<void> {
  const form = new FormData();
  form.append("file", blob, fileName);

  const total = blob.size;
  const report = (loaded: number) => {
    options?.onProgress?.({
      loaded,
      total,
      percent: total > 0 ? Math.round((loaded / total) * 100) : 100,
    });
  };

  const XhrCtor = (globalThis as { XMLHttpRequest?: new () => XhrLike })
    .XMLHttpRequest;

  if (XhrCtor) {
    return new Promise<void>((resolve, reject) => {
      if (options?.signal?.aborted) {
        reject(createAbortError());
        return;
      }
      const xhr = new XhrCtor();
      xhr.open("POST", url);
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable || event.total === 0) return;
        // Wire bytes include the multipart framing — map the ratio onto the
        // blob size so `loaded`/`total` stay in file-byte units.
        const ratio = Math.min(event.loaded / event.total, 1);
        report(Math.round(ratio * total));
      };
      xhr.onload = () => {
        try {
          assertUploadSucceeded(xhr.status, xhr.responseText);
          report(total);
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      xhr.onerror = () => reject(new PyloError("File upload failed — network error"));
      xhr.onabort = () => reject(createAbortError());
      options?.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
      xhr.send(form);
    });
  }

  report(0);
  return fetch(url, {
    method: "POST",
    body: form,
    ...(options?.signal !== undefined ? { signal: options.signal } : {}),
  }).then(async (response) => {
    assertUploadSucceeded(response.status, await response.text());
    report(total);
  });
}
