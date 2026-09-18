// Stands in for the `.pylo/index.ts` that `pylo generate` writes, so the
// fixture exercises the real generic surface rather than `any`.
export interface CreateContactInput {
  email?: string | null;
  name?: string | null;
}

export interface UpdateContactInput {
  id: string;
  email?: string | null;
  name?: string | null;
}

export interface PyloSchema {
  contact: {
    fields: {
      id: string;
      email: string | null;
      name: string | null;
    };
    relations: Record<never, never>;
    createInput: CreateContactInput;
    updateInput: UpdateContactInput;
    capabilities: "list" | "byId" | "create" | "update" | "bulkUpsert" | "delete";
  };
}
