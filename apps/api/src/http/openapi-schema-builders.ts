export const text = (format?: string) => ({
  type: "string",
  ...(format ? { format } : {}),
});

export const integer = { type: "integer" };
export const number = { type: "number" };
export const boolean = { type: "boolean" };
export const stringArray = { type: "array", items: text() };

export const objectSchema = (
  required: string[],
  properties: Record<string, unknown>,
) => ({
  type: "object",
  required,
  properties,
  additionalProperties: false,
});
