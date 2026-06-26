import * as cheerio from "cheerio";

/**
 * Selector engine với đa tầng fallback:
 * 1. CSS selector list (priority)
 * 2. Text/attribute pattern
 * 3. Structural heuristic (sibling/parent)
 * 4. Default value
 */
export class SelectorEngine {
  constructor(options = {}) {
    this.schemas = options.schemas || {};
    this.defaultSchema = options.defaultSchema || null;
  }

  registerSchema(domain, schema) {
    this.schemas[domain] = schema;
  }

  async parse(response, domain) {
    const schema = this.schemas[domain] || this.defaultSchema;
    if (!schema) {
      return { raw: response.body?.slice(0, 5000) };
    }

    const $ = cheerio.load(response.body || "");
    const result = {
      url: response.url,
      domain
    };

    for (const [fieldName, fieldConfig] of Object.entries(schema.fields)) {
      result[fieldName] = this._extractField($, fieldConfig);
    }

    return result;
  }

  _extractField($, fieldConfig) {
    const config = typeof fieldConfig === "string"
      ? { selectors: [fieldConfig] }
      : fieldConfig;

    const selectors = Array.isArray(config.selectors)
      ? config.selectors
      : [config.selectors].filter(Boolean);

    // 1. CSS selector fallback
    for (const selector of selectors) {
      const value = this._resolveSelector($, selector, config.extract);
      if (this._isValid(value, config.validate)) {
        return { value, matchedSelector: selector };
      }
    }

    // 2. Text/attribute pattern
    if (config.pattern) {
      const value = this._resolvePattern($, config.pattern);
      if (this._isValid(value, config.validate)) {
        return { value, matchedPattern: config.pattern };
      }
    }

    // 3. Structural heuristic
    if (config.heuristic) {
      const value = this._resolveHeuristic($, config.heuristic);
      if (this._isValid(value, config.validate)) {
        return { value, heuristic: true };
      }
    }

    // 4. Default
    return { value: config.default ?? null, fallback: true };
  }

  _resolveSelector($, selector, extract = "text") {
    const el = $(selector).first();
    if (!el.length) return null;

    if (extract === "text") return this._normalize(el.text());
    if (extract.startsWith("attr(")) {
      const attr = extract.match(/attr\(([^)]+)\)/)?.[1];
      return el.attr(attr) || null;
    }
    if (extract === "html") return el.html();
    return this._normalize(el.text());
  }

  _resolvePattern($, pattern) {
    const regex = new RegExp(pattern.regex, pattern.flags || "i");
    const text = $("body").text();
    const match = text.match(regex);
    return match ? match[pattern.group || 0] : null;
  }

  _resolveHeuristic($, heuristic) {
    // Tìm element có text chứa keyword, sau đó lấy sibling/parent/child
    const { keyword, target } = heuristic;
    const els = $("*").filter((_, el) => $(el).text().toLowerCase().includes(keyword.toLowerCase()));
    if (!els.length) return null;

    const node = $(els[0]);
    let targetNode;
    if (target === "parent") targetNode = node.parent();
    else if (target === "next") targetNode = node.next();
    else if (target === "prev") targetNode = node.prev();
    else if (target === "self") targetNode = node;
    else targetNode = node.find(target);

    return targetNode?.first().text().trim() || null;
  }

  _isValid(value, validate) {
    if (value === null || value === undefined || value === "") return false;
    if (!validate) return true;

    if (validate === "required") return true;
    if (validate?.min_length && String(value).length < validate.min_length) return false;
    if (validate?.regex && !new RegExp(validate.regex).test(String(value))) return false;
    return true;
  }

  _normalize(text) {
    return text?.replace(/\s+/g, " ").trim() || null;
  }
}
