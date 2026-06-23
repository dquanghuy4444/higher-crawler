function typeOf(value) {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}

function validateObject(value, schema, path, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path} must be an object`);
    return;
  }

  for (const field of schema.required || []) {
    if (value[field] === undefined || value[field] === null || value[field] === "") {
      errors.push(`${path}.${field} is required`);
    }
  }

  for (const [field, expected] of Object.entries(schema.fields || {})) {
    if (value[field] === undefined || value[field] === null) {
      continue;
    }

    const expectedTypes = Array.isArray(expected) ? expected : [expected];
    const actual = typeOf(value[field]);
    if (!expectedTypes.includes(actual)) {
      errors.push(`${path}.${field} must be ${expectedTypes.join("|")}, got ${actual}`);
    }
  }
}

export function validateOutput(value, schema) {
  if (!schema) {
    return {
      ok: true,
      errors: []
    };
  }

  const errors = [];

  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      errors.push("data must be an array");
    } else if (schema.item) {
      value.forEach((item, index) => validateObject(item, schema.item, `data[${index}]`, errors));
    }
  } else {
    validateObject(value, schema, "data", errors);
  }

  return {
    ok: errors.length === 0,
    errors
  };
}
