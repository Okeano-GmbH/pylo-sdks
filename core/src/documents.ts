// Rendering documents from the templates a tenant designed in the admin panel.
// The template's `input_schema` is what codegen turns into `PyloDocumentTemplates`,
// so the variables passed here are checked against the template the key names.

/**
 * The fallback template map: used when no generated `PyloDocumentTemplates` is
 * registered, so `documents.generate` still accepts any key and any variables
 * rather than refusing every call.
 */
export type DocumentTemplateMap = Record<string, Record<string, unknown>>;

/** The `key` column of a document template — what the render endpoint takes. */
export type DocumentTemplateName<T> = keyof T & string;

/** The variables one template renders with, as codegen derived them. */
export type DocumentVariables<T, K extends DocumentTemplateName<T>> = T[K];

/**
 * Page setup for one render, overriding what the template stored. Lengths are
 * CSS units — `mm`, `cm`, `in`, `px`, `pt`.
 */
export interface DocumentPageOptions {
  width?: string;
  height?: string;
  margin?: { top?: string; right?: string; bottom?: string; left?: string };
  scale?: number;
  printBackground?: boolean;
  pageNumbers?: boolean;
  locale?: string;
}

export interface DocumentGenerateOptions {
  /** Defaults to `<template key>-<timestamp>.pdf`. `.pdf` is appended if missing. */
  fileName?: string;
  pageOptions?: DocumentPageOptions;
}

export interface PyloRenderedDocument {
  /** The stored `pyloDocument` row. */
  id: string;
  template_key: string;
  /** The PDF as a pyloMedia id — pass it to `files.getDownloadUrl`. */
  media_id: string | null;
  file_name: string | null;
  rendered_at: string | null;
}

interface BuildResult {
  query: string;
  variables: Record<string, unknown>;
}

// `store` is left at its default (true): the SDK's `generate` renders *and* keeps
// the document, which is what the returned `id` and `media_id` refer to. The
// endpoint's `store: false` mode returns the bytes inline instead and is what
// the admin panel's preview uses; it is not exposed here.
export function buildGenerateDocumentMutation(
  templateKey: string,
  variables: unknown,
  options?: DocumentGenerateOptions,
): BuildResult {
  const mutation = `mutation GenerateDocument($input: DocumentInput!) {
  generateDocument(input: $input) {
    id
    template_key
    media_id
    file_name
    rendered_at
  }
}`;

  return {
    query: mutation,
    variables: {
      input: {
        template_key: templateKey,
        // A `JSON` scalar: the object travels as itself, and serializing the
        // request turns a `Date` variable into the ISO string the renderer
        // expects — which is why the generated `date` types accept one.
        variables: variables ?? {},
        ...(options?.fileName !== undefined ? { file_name: options.fileName } : {}),
        ...(options?.pageOptions !== undefined ? { options: options.pageOptions } : {}),
      },
    },
  };
}
