import { SelectorEngine } from "./SelectorEngine.js";
import * as cheerio from "cheerio";

/**
 * Auto-healing selector engine.
 * Khi selector fail, lưu snapshot và tìm selector mới dựa trên:
 * 1. Text/attribute pattern
 * 2. Structural similarity (parent/sibling/depth)
 * 3. Fuzzy class/id match
 */
export class AutoHealingSelectorEngine extends SelectorEngine {
  constructor(options = {}) {
    super(options);
    this.snapshots = options.snapshots || new Map(); // url -> { html, selectors }
    this.store = options.store || null;
    this.onHeal = options.onHeal || null;
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
      const extracted = this._extractField($, fieldConfig);

      if (!this._isValid(extracted.value, fieldConfig.validate)) {
        // Try heal
        const healed = await this._healField($, response.url, fieldName, fieldConfig);
        if (healed) {
          result[fieldName] = healed;
          this.onHeal?.({
            url: response.url,
            domain,
            field: fieldName,
            oldSelector: fieldConfig.selectors?.[0],
            newSelector: healed.healedSelector
          });
          continue;
        }
      }

      result[fieldName] = extracted;
    }

    // Save snapshot for future healing
    await this._saveSnapshot(response.url, response.body);

    return result;
  }

  async _healField($, url, fieldName, fieldConfig) {
    const snapshot = await this._getSnapshot(url);
    if (!snapshot?.html) return null;

    const old$ = cheerio.load(snapshot.html);
    const oldElement = this._findOldElement(old$, fieldConfig);
    if (!oldElement) return null;

    const newSelector = this._findNewSelector($, oldElement, fieldConfig);
    if (!newSelector) return null;

    const value = this._resolveSelector($, newSelector, fieldConfig.extract);
    if (!this._isValid(value, fieldConfig.validate)) return null;

    return {
      value,
      healedSelector: newSelector,
      healed: true
    };
  }

  _findOldElement($, fieldConfig) {
    const selectors = Array.isArray(fieldConfig.selectors)
      ? fieldConfig.selectors
      : [fieldConfig.selectors].filter(Boolean);

    for (const selector of selectors) {
      const el = $(selector).first();
      if (el.length) return el;
    }
    return null;
  }

  _findNewSelector($, oldElement, fieldConfig) {
    // Strategy 1: match by text content
    const text = oldElement.text().trim().replace(/\s+/g, " ");
    if (text && text.length > 3) {
      const byText = this._findByText($, text, oldElement);
      if (byText) return byText;
    }

    // Strategy 2: match by stable attributes
    const attr = oldElement.attr("id") || oldElement.attr("name") || oldElement.attr("itemprop");
    if (attr) {
      const byAttr = this._findByAttribute($, oldElement, attr);
      if (byAttr) return byAttr;
    }

    // Strategy 3: match by class partial
    const classes = (oldElement.attr("class") || "").split(/\s+/).filter(Boolean);
    for (const cls of classes) {
      if (cls.length > 4 && !cls.includes("-")) continue; // skip generic classes
      const byClass = this._findByClass($, cls, oldElement);
      if (byClass) return byClass;
    }

    // Strategy 4: structural similarity
    return this._findByStructure($, oldElement, fieldConfig);
  }

  _findByText($, text, oldElement) {
    const tagName = oldElement.prop("tagName")?.toLowerCase() || "*";
    const candidates = $(`${tagName}`).filter((_, el) => {
      return $(el).text().trim().replace(/\s+/g, " ") === text;
    });
    if (candidates.length === 1) {
      return this._buildSelector($(candidates[0]));
    }
    return null;
  }

  _findByAttribute($, oldElement, attrValue) {
    const tagName = oldElement.prop("tagName")?.toLowerCase() || "*";
    const candidates = [
      `${tagName}#${attrValue}`,
      `${tagName}[name="${attrValue}"]`,
      `${tagName}[itemprop="${attrValue}"]`
    ];
    for (const sel of candidates) {
      if ($(sel).length === 1) return sel;
    }
    return null;
  }

  _findByClass($, className, oldElement) {
    const tagName = oldElement.prop("tagName")?.toLowerCase() || "*";
    const selector = `${tagName}.${className.replace(/[^a-zA-Z0-9_-]/g, "\\$&")}`;
    if ($(selector).length === 1) return selector;
    return null;
  }

  _findByStructure($, oldElement, fieldConfig) {
    // Try to find by relative position to parent with identifiable class
    const parent = oldElement.parent();
    const parentClass = parent.attr("class");
    const parentId = parent.attr("id");
    const tagName = oldElement.prop("tagName")?.toLowerCase() || "*";

    if (parentId) {
      const selector = `#${parentId} > ${tagName}`;
      if ($(selector).length === 1) return selector;
    }

    if (parentClass) {
      const classes = parentClass.split(/\s+/).filter((c) => c.length > 3);
      for (const cls of classes) {
        const selector = `.${cls.replace(/[^a-zA-Z0-9_-]/g, "\\$&")} > ${tagName}`;
        if ($(selector).length === 1) return selector;
      }
    }

    return null;
  }

  _buildSelector(el) {
    const tagName = el.prop("tagName")?.toLowerCase() || "*";
    const id = el.attr("id");
    if (id) return `${tagName}#${id}`;

    const className = (el.attr("class") || "").split(/\s+/).filter((c) => c.length > 3)[0];
    if (className) return `${tagName}.${className.replace(/[^a-zA-Z0-9_-]/g, "\\$&")}`;

    return tagName;
  }

  async _getSnapshot(url) {
    if (this.snapshots.has(url)) return this.snapshots.get(url);
    if (this.store?.getLatestSnapshot) {
      return await this.store.getLatestSnapshot(url);
    }
    return null;
  }

  async _saveSnapshot(url, html) {
    this.snapshots.set(url, { html, createdAt: Date.now() });
    // Optionally persist to store
    if (this.store?.saveJobSnapshot) {
      // called externally with job context
    }
  }
}
