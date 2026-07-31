import { describe, it, expect, vi, afterEach } from "vitest";
import {
  splitEntityRelationPath,
  normalizeEntityRelationPath,
  buildCreateUploadInput,
  buildAttachMutation,
  toUploadPart,
  uploadToUrl,
} from "../src/upload.js";
import { createPyloClient, PyloError } from "../src/client.js";
import type { UploadProgress } from "../src/upload.js";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("splitEntityRelationPath", () => {
  it("splits on the first dot", () => {
    expect(splitEntityRelationPath("contact.avatar")).toEqual({
      entity: "contact",
      relation: "avatar",
    });
  });

  it("rejects paths without a relation part", () => {
    expect(() => splitEntityRelationPath("contact")).toThrow(PyloError);
    expect(() => splitEntityRelationPath("contact.")).toThrow(PyloError);
    expect(() => splitEntityRelationPath(".avatar")).toThrow(PyloError);
  });
});

describe("normalizeEntityRelationPath", () => {
  it("pascal-cases the entity part and accepts both forms", () => {
    expect(normalizeEntityRelationPath("contact.avatar")).toBe("Contact.avatar");
    expect(normalizeEntityRelationPath("Contact.avatar")).toBe("Contact.avatar");
  });
});

describe("buildCreateUploadInput", () => {
  it("returns null for an unrestricted upload", () => {
    expect(buildCreateUploadInput()).toBeNull();
    expect(buildCreateUploadInput({ fileName: "x.bin" })).toBeNull();
  });

  it("normalizes the relation path and passes is_public through", () => {
    expect(buildCreateUploadInput({ entityRelationPath: "contact.avatar" })).toEqual({
      entity_relation_path: "Contact.avatar",
    });
    expect(
      buildCreateUploadInput({ entityRelationPath: "contact.avatar", isPublic: true }),
    ).toEqual({ entity_relation_path: "Contact.avatar", is_public: true });
  });

  it("rejects attachTo/isPublic without entityRelationPath", () => {
    expect(() => buildCreateUploadInput({ attachTo: { id: "1" } })).toThrow(
      "attachTo requires entityRelationPath",
    );
    expect(() => buildCreateUploadInput({ isPublic: true })).toThrow(
      "isPublic requires entityRelationPath",
    );
  });

  it("rejects a multi-file batch aimed at a set relation", () => {
    const options = {
      entityRelationPath: "contact.avatar",
      attachTo: { id: "contact-1" },
    };
    expect(buildCreateUploadInput(options, 1)).toEqual({
      entity_relation_path: "Contact.avatar",
    });
    expect(() => buildCreateUploadInput(options, 3)).toThrow(PyloError);
    expect(() => buildCreateUploadInput(options, 3)).toThrow(/3 files were given/);
  });

  it("allows a multi-file batch in add mode", () => {
    expect(
      buildCreateUploadInput(
        {
          entityRelationPath: "project.attachments",
          attachTo: { id: "project-1", mode: "add" },
        },
        3,
      ),
    ).toEqual({ entity_relation_path: "Project.attachments" });
  });
});

describe("buildAttachMutation", () => {
  it("builds a <relation>_set upsert by default", () => {
    const { query, variables, entityKey, mutationKey } = buildAttachMutation(
      "contact.avatar",
      "media-1",
      { id: "contact-1" },
    );
    expect(entityKey).toBe("contact");
    expect(mutationKey).toBe("updateContact");
    expect(norm(query)).toContain("updateContact(input: $input)");
    expect(variables).toEqual({
      input: { id: "contact-1", avatar_set: { id: "media-1" } },
    });
  });

  it("builds a <relation>_add list append when mode is add", () => {
    const { variables } = buildAttachMutation("Project.attachments", "media-1", {
      id: "project-1",
      mode: "add",
    });
    expect(variables).toEqual({
      input: { id: "project-1", attachments_add: [{ id: "media-1" }] },
    });
  });

  it("attaches a whole batch in one mutation", () => {
    const { variables } = buildAttachMutation(
      "Project.attachments",
      ["media-1", "media-2", "media-3"],
      { id: "project-1", mode: "add" },
    );
    expect(variables).toEqual({
      input: {
        id: "project-1",
        attachments_add: [{ id: "media-1" }, { id: "media-2" }, { id: "media-3" }],
      },
    });
  });

  it("refuses to set a single relation from several media ids", () => {
    expect(() =>
      buildAttachMutation("contact.avatar", ["media-1", "media-2"], {
        id: "contact-1",
      }),
    ).toThrow(PyloError);
  });
});

describe("toUploadPart", () => {
  it("takes name and type from a File", () => {
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    const part = toUploadPart(file);
    expect(part.fileName).toBe("hello.txt");
    expect(part.mimeType).toBe("text/plain");
    expect(part.blob.size).toBe(5);
  });

  it("requires a fileName for Blobs and raw bytes", () => {
    expect(() => toUploadPart(new Blob(["x"]))).toThrow(PyloError);
    expect(() => toUploadPart(new Uint8Array([1, 2, 3]))).toThrow(PyloError);
  });

  it("wraps raw bytes into a Blob with the given name and type", () => {
    const part = toUploadPart(new Uint8Array([1, 2, 3]), {
      fileName: "raw.bin",
      mimeType: "application/octet-stream",
    });
    expect(part.fileName).toBe("raw.bin");
    expect(part.mimeType).toBe("application/octet-stream");
    expect(part.blob.size).toBe(3);
    expect(part.blob.type).toBe("application/octet-stream");
  });
});

describe("uploadToUrl (fetch path)", () => {
  it("POSTs multipart form data and reports start/end progress", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, error: null }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const progress: UploadProgress[] = [];
    await uploadToUrl(
      "http://files.test/api/upload-file/jwt",
      new Blob(["hello"]),
      "hello.txt",
      { onProgress: (p) => progress.push(p) },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("http://files.test/api/upload-file/jwt");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    const filePart = (init.body as FormData).get("file");
    expect(filePart).toBeInstanceOf(File);
    expect((filePart as File).name).toBe("hello.txt");

    expect(progress[0]).toEqual({ loaded: 0, total: 5, percent: 0 });
    expect(progress[progress.length - 1]).toEqual({ loaded: 5, total: 5, percent: 100 });
  });

  it("throws the fileservice error message on success: false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ success: false, error: "Mime type text/plain is not allowed to be uploaded" }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      uploadToUrl("http://files.test/u", new Blob(["x"]), "x.txt"),
    ).rejects.toThrow("Mime type text/plain is not allowed to be uploaded");
  });

  it("throws on a non-2xx response without a JSON body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("gateway timeout", { status: 504 })),
    );

    await expect(
      uploadToUrl("http://files.test/u", new Blob(["x"]), "x.txt"),
    ).rejects.toThrow("File upload failed with status 504");
  });
});

describe("client.files", () => {
  const graphqlEndpoint = "http://api.test/graphql";

  function graphqlResponse(data: unknown) {
    return new Response(JSON.stringify({ data }), { status: 200 });
  }

  it("upload requests an upload URL, POSTs the bytes, and attaches the media", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      if (target === graphqlEndpoint) {
        const body = JSON.parse(init!.body as string) as { query: string };
        calls.push({ url: target, body });
        if (body.query.includes("createUpload")) {
          return graphqlResponse({
            createUpload: { id: "media-1", url: "http://files.test/api/upload-file/jwt" },
          });
        }
        return graphqlResponse({ updateContact: { data: { id: "contact-1" } } });
      }
      calls.push({ url: target, body: init?.body });
      return new Response(JSON.stringify({ success: true, error: null }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createPyloClient<any>({
      endpoint: graphqlEndpoint,
      auth: async () => ({ apiKey: "key" }),
    });

    const result = await client.files.upload(
      new File(["hello"], "hello.txt", { type: "text/plain" }),
      {
        entityRelationPath: "contact.avatar",
        attachTo: { id: "contact-1" },
      },
    );

    expect(result).toEqual({
      id: "media-1",
      fileName: "hello.txt",
      mimeType: "text/plain",
      size: 5,
    });

    // upload URL → bytes → attach, in order
    expect(calls.map((c) => c.url)).toEqual([
      graphqlEndpoint,
      "http://files.test/api/upload-file/jwt",
      graphqlEndpoint,
    ]);

    const uploadUrlCall = calls[0]!.body as { variables: { input: unknown } };
    expect(uploadUrlCall.variables.input).toEqual({
      entity_relation_path: "Contact.avatar",
    });

    const attachCall = calls[2]!.body as { variables: { input: unknown } };
    expect(attachCall.variables.input).toEqual({
      id: "contact-1",
      avatar_set: { id: "media-1" },
    });
  });

  it("upload without a relation path sends a null input", async () => {
    let uploadUrlBody: { variables: { input: unknown } } | undefined;
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url) === graphqlEndpoint) {
        uploadUrlBody ??= JSON.parse(init!.body as string) as {
          variables: { input: unknown };
        };
        return graphqlResponse({
          createUpload: { id: "media-2", url: "http://files.test/u" },
        });
      }
      return new Response(JSON.stringify({ success: true, error: null }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createPyloClient<any>({
      endpoint: graphqlEndpoint,
      auth: async () => ({ apiKey: "key" }),
    });

    const result = await client.files.upload(new File(["x"], "x.bin"));
    expect(result.id).toBe("media-2");
    expect(uploadUrlBody!.variables.input).toBeNull();
  });

  it("rejects attachTo/isPublic without entityRelationPath", async () => {
    const client = createPyloClient<any>({
      endpoint: graphqlEndpoint,
      auth: async () => ({ apiKey: "key" }),
    });

    await expect(
      client.files.upload(new File(["x"], "x.bin"), { attachTo: { id: "1" } }),
    ).rejects.toThrow("attachTo requires entityRelationPath");
    await expect(
      client.files.createUploadUrl({ isPublic: true }),
    ).rejects.toThrow("isPublic requires entityRelationPath");
  });

  it("getDownloadUrl returns the fresh url", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        graphqlResponse({
          createDownload: { id: "dl-1", url: "http://files.test/api/download-file/x?jwt=t" },
        }),
      ),
    );

    const client = createPyloClient<any>({
      endpoint: graphqlEndpoint,
      auth: async () => ({ apiKey: "key" }),
    });

    await expect(client.files.getDownloadUrl("media-1")).resolves.toBe(
      "http://files.test/api/download-file/x?jwt=t",
    );
  });
});
