// ---------------------------------------------------------------------------
// JSON Schema validation (subset — sufficient for MVP)
// ---------------------------------------------------------------------------

/** Validate a JSON value against a JSON Schema (subset). Returns null on success, error string on failure. */
export function validateAgainstSchema(
  value: unknown,
  schema: Record<string, unknown> | null | undefined,
): string | null {
  if (!schema) return null;
  const properties = schema.properties as Record<string, unknown> | undefined;
  const required: string[] = Array.isArray(schema.required) ? schema.required : [];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "Expected a JSON object";
  }

  const obj = value as Record<string, unknown>;

  for (const key of required) {
    if (!(key in obj)) {
      return `Missing required field: "${key}"`;
    }
  }

  if (properties) {
    for (const [key, val] of Object.entries(obj)) {
      const propSchema = properties[key] as Record<string, unknown> | undefined;
      if (!propSchema) continue;
      const expectedType = propSchema.type as string | undefined;
      if (!expectedType) continue;

      if (expectedType === "string" && typeof val !== "string") {
        return `Field "${key}" must be a string, got ${typeof val}`;
      }
      if (expectedType === "number" && typeof val !== "number") {
        return `Field "${key}" must be a number, got ${typeof val}`;
      }
      if (expectedType === "boolean" && typeof val !== "boolean") {
        return `Field "${key}" must be a boolean, got ${typeof val}`;
      }
      if (expectedType === "integer" && !Number.isInteger(val)) {
        return `Field "${key}" must be an integer, got ${typeof val}`;
      }
      if (expectedType === "array" && !Array.isArray(val)) {
        return `Field "${key}" must be an array, got ${typeof val}`;
      }
    }
  }

  return null;
}

/** Convert JSON Schema properties to a user-friendly description string */
export function schemaToDescription(
  schema: Record<string, unknown> | null | undefined,
  label: string,
): string {
  if (!schema) return "";
  const properties = schema.properties as Record<string, unknown> | undefined;
  if (!properties) return "";

  const lines: string[] = [`--- ${label} ---`];
  const required: string[] = Array.isArray(schema.required) ? schema.required : [];

  for (const [key, prop] of Object.entries(properties)) {
    const p = prop as Record<string, unknown>;
    const requiredMark = required.includes(key) ? " (required)" : "";
    const enumValues = Array.isArray(p.enum) ? ` [${(p.enum as string[]).join(", ")}]` : "";
    const desc = p.description ? ` — ${p.description}` : "";
    lines.push(`  ${key}: ${p.type ?? "string"}${requiredMark}${enumValues}${desc}`);
  }

  return lines.join("\n");
}