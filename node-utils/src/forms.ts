import type { QueryCondition } from "./filter-conditions";

export interface PyloForm {
  id: string;
  name: string;
  description?: string;
  submit_text: string;
  form_fields?: {
    data?: Array<PyloFormField>;
  };
  instances?: {
    data?: Array<{ id: string }>;
  };
}

export interface PyloFormField {
  id: string;
  index: number;
  hidden: boolean;
  default_value?: string;
  is_search_value: boolean;
  label: string;
  max?: number;
  min: number;
  placeholder: string;
  regex?: string;
  required: boolean;
  tool_tip?: string;
  options?: {
    data: Array<{ label: string; value?: string; index: number }>;
  };
  condition: QueryCondition;
  type: PyloFormFieldType;
}

export const formDataStr = `data {
                name
                submit_text
                form_fields {
                  data {
                    id
                    label
                    type
                    hidden
                    options {
                      data {
                        label
                        value
                        index
                      }
                    }
                    validation_string
                    placeholder
                    default_value
                    index
                    condition
                  }
                }
              }`;

export const PyloFormFieldsTypes = [
  "text",
  "long_text",
  "multiple_choice",
  "single_choice",
  "number",
  "checkbox",
  "date",
  "date_time",
  "email",
  "url",
  "phone",
  "h1",
  "h2",
  "h3",
  "p",
  "page_break",
] as const;

export const PyloFormInputTypes = [
  "text",
  "long_text",
  "multiple_choice",
  "single_choice",
  "number",
  "checkbox",
  "date",
  "date_time",
  "email",
  "url",
  "phone",
] as const;

export type PyloFormFieldType = (typeof PyloFormFieldsTypes)[number];
export type PyloFormInputType = (typeof PyloFormInputTypes)[number];

export function parseFormField(formField: PyloFormField) {
  const additionalProps: Partial<PyloFormField> = {
    required: false,
  };
  if ("validation_string" in formField) {
    const split = String(formField.validation_string).split(";");
    if (split.includes("required")) {
      additionalProps.required = true;
    }
    const minRule = split.find((v) => v.startsWith("min:"));
    const maxRule = split.find((v) => v.startsWith("max:"));
    if (minRule) additionalProps.min = parseInt(minRule.split(":")[1] ?? "0");
    if (maxRule) additionalProps.max = parseInt(maxRule.split(":")[1] ?? "0");
    for (const v of split) {
      if (v.startsWith("regex:")) {
        additionalProps.regex = v.replace(/^regex:/, "");
      }
    }

    //delete it to not trigger parsing again
    delete formField.validation_string;
  }
  if (!!formField.condition && typeof formField.condition === "string") {
    additionalProps.condition = JSON.parse(String(formField.condition));
  }
  return { ...formField, ...additionalProps };
}

export function parseFormFields(formFields: Array<PyloFormField>) {
  return formFields.map((x) => parseFormField(x));
}
export function parseForm(pyloForm: PyloForm): PyloForm {
  return {
    ...pyloForm,
    form_fields: {
      ...(!!pyloForm.form_fields?.data?.length && {
        data: parseFormFields(pyloForm.form_fields.data),
      }),
    },
  };
}
