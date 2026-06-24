import { GoogleGenAI, setDefaultBaseUrls } from "@google/genai";

import { logError, logEvent, logWarn } from "../core/logger.js";

const DEFAULT_MODEL = process.env.AI_ATTRIBUTES_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";
const DEFAULT_ENDPOINT = process.env.GEMINI_API_ENDPOINT || "https://generativelanguage.googleapis.com/v1beta";

if (process.env.GEMINI_API_ENDPOINT) {
  try {
    const cleanedUrl = process.env.GEMINI_API_ENDPOINT.replace(/\/v1beta\/?$/, "").replace(/\/$/, "");
    setDefaultBaseUrls({
      geminiUrl: cleanedUrl
    });
  } catch (err) {
    // Ignore potential errors during initialization
  }
}

function normalizeText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function unique(values) {
  return Array.from(new Set(values.map(normalizeText).filter(Boolean)));
}

function inferCategory(text = "") {
  const lower = text.toLowerCase();
  if (lower.includes("usb") && lower.includes("flash")) {
    return "USB flash drive";
  }
  if (lower.includes("memory") || lower.includes("dram") || lower.includes("ddr")) {
    return "Memory";
  }
  if (lower.includes("keyboard")) {
    return "Keyboard";
  }
  if (lower.includes("mouse")) {
    return "Mouse";
  }
  return null;
}

function parseHeuristicAttributes(content = "", context = {}) {
  const text = normalizeText(content);
  const title = normalizeText(context.title);
  const combined = normalizeText(`${title} ${text}`);
  const partNumbers = unique(combined.match(/\b[A-Z]{2,}[A-Z0-9-]{4,}\b/g) || []);
  const capacities = unique(combined.match(/\b\d+(?:\.\d+)?\s*(?:GB|TB|MB)\b/gi) || []);
  const interfaces = unique(combined.match(/\b(?:USB\s*\d(?:\.\d)?|USB\s*3\.0|USB\s*2\.0|PCIe\s*\d(?:\.\d)?|SATA|HDMI|DisplayPort|Thunderbolt\s*\d)\b/gi) || []);
  const dimensions = unique(combined.match(/\b\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?(?:\s*[x×]\s*\d+(?:\.\d+)?)?\s*(?:mm|cm|in)\b/gi) || []);
  const weights = unique(combined.match(/\b\d+(?:\.\d+)?\s*(?:g|kg|lbs?|oz)\b/gi) || []);
  const speeds = unique(combined.match(/\b\d+(?:\.\d+)?\s*(?:MB\/s|GB\/s|Mbps|Gbps|MHz|GHz)\b/gi) || []);
  const warranty = unique(combined.match(/\b(?:\d+\s*(?:year|years|yr|yrs|Jahre)|limited lifetime|lifetime)\s+warranty\b/gi) || []);
  const colorMatches = unique(combined.match(/\b(?:black|white|red|blue|green|silver|grey|gray|gold|yellow|orange)\b/gi) || []);

  const attributes = [];
  const add = (name, values, confidence = 0.65) => {
    for (const value of values) {
      attributes.push({
        name,
        value,
        unit: null,
        confidence,
        evidence: value
      });
    }
  };

  add("part_number", partNumbers, 0.72);
  add("capacity", capacities, 0.7);
  add("interface", interfaces, 0.72);
  add("dimensions", dimensions, 0.68);
  add("weight", weights, 0.65);
  add("speed", speeds, 0.68);
  add("warranty", warranty, 0.7);
  add("color", colorMatches, 0.5);

  return {
    provider: "heuristic",
    model: null,
    ok: true,
    product: {
      name: title || null,
      brand: null,
      category: inferCategory(combined),
      part_numbers: partNumbers
    },
    attributes,
    notes: attributes.length > 0 ? [] : ["No obvious product attributes were detected by heuristic fallback."]
  };
}

// getGeminiOutputText is replaced by SDK's response.text getter

function parseJsonText(value = "") {
  const trimmed = value.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("Gemini response did not contain a JSON object.");
    }
    return JSON.parse(match[0]);
  }
}

function buildGeminiSchema() {
  return {
    type: "OBJECT",
    properties: {
      product: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          brand: { type: "STRING" },
          category: { type: "STRING" },
          part_numbers: {
            type: "ARRAY",
            items: { type: "STRING" }
          }
        }
      },
      attributes: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING" },
            value: { type: "STRING" },
            unit: { type: "STRING" },
            confidence: { type: "NUMBER" },
            evidence: { type: "STRING" }
          }
        }
      },
      notes: {
        type: "ARRAY",
        items: { type: "STRING" }
      }
    },
    required: ["product", "attributes", "notes"]
  };
}

function normalizeGeminiResult(value = {}) {
  const product = value.product || {};
  const attributes = Array.isArray(value.attributes) ? value.attributes : [];
  const notes = Array.isArray(value.notes) ? value.notes : [];

  return {
    product: {
      name: normalizeText(product.name) || null,
      brand: normalizeText(product.brand) || null,
      category: normalizeText(product.category) || null,
      part_numbers: Array.isArray(product.part_numbers) ? unique(product.part_numbers) : []
    },
    attributes: attributes
      .map((attribute) => ({
        name: normalizeText(attribute.name),
        value: normalizeText(attribute.value),
        unit: normalizeText(attribute.unit) || null,
        confidence: Number(attribute.confidence) || 0,
        evidence: normalizeText(attribute.evidence)
      }))
      .filter((attribute) => attribute.name && attribute.value),
    notes: notes.map(normalizeText).filter(Boolean)
  };
}

async function extractWithGemini(content, context = {}) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.AI_ATTRIBUTES_API_KEY;
  if (!apiKey) {
    return null;
  }

  const clippedContent = normalizeText(content).slice(0, Number(process.env.AI_ATTRIBUTES_MAX_INPUT_CHARS || 16000));
  
  const ai = new GoogleGenAI({ apiKey });
  
  const response = await ai.models.generateContent({
    model: DEFAULT_MODEL,
    contents: [
      "Extract product attributes from PDF text.",
      "Return only factual data visible in the text.",
      "Preserve units.",
      "Use concise snake_case attribute names.",
      "Use empty strings instead of null values.",
      JSON.stringify({
        title: context.title || "",
        source_url: context.sourceUrl || "",
        content: clippedContent
      })
    ].join("\n"),
    config: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: buildGeminiSchema()
    }
  });

  const outputText = response.text;
  if (!outputText) {
    throw new Error("Gemini response returned no text.");
  }
  const parsed = normalizeGeminiResult(parseJsonText(outputText));

  return {
    provider: "gemini",
    model: DEFAULT_MODEL,
    ok: true,
    ...parsed
  };
}

export async function detectProductAttributesFromContent(content, context = {}) {
  const useAi = context.enabled !== false;
  const normalizedContent = normalizeText(content);
  const logDetails = {
    provider_preference: useAi ? "gemini_then_heuristic" : "heuristic_only",
    title: normalizeText(context.title) || null,
    source_url: normalizeText(context.sourceUrl) || null,
    content_length: normalizedContent.length,
    content_preview: normalizedContent.slice(0, 200) || null,
    model: DEFAULT_MODEL,
    endpoint: DEFAULT_ENDPOINT
  };

  logEvent("ai_attribute_detection.start", logDetails);

  if (useAi) {
    try {
      const aiResult = await extractWithGemini(content, context);
      if (aiResult) {
        logEvent("ai_attribute_detection.success", {
          ...logDetails,
          provider: aiResult.provider,
          attribute_count: Array.isArray(aiResult.attributes) ? aiResult.attributes.length : 0,
          note_count: Array.isArray(aiResult.notes) ? aiResult.notes.length : 0,
          product_name: aiResult.product?.name || null,
          product_brand: aiResult.product?.brand || null
        });
        return aiResult;
      }

      logWarn("ai_attribute_detection.ai_unavailable", logDetails);
    } catch (error) {
      logWarn("ai_attribute_detection.ai_failed_fallback", {
        ...logDetails,
        error: error.message
      });

      const heuristicResult = {
        ...parseHeuristicAttributes(content, context),
        provider: "heuristic",
        ai_error: error.message
      };

      logEvent("ai_attribute_detection.fallback_success", {
        ...logDetails,
        provider: heuristicResult.provider,
        attribute_count: Array.isArray(heuristicResult.attributes) ? heuristicResult.attributes.length : 0,
        note_count: Array.isArray(heuristicResult.notes) ? heuristicResult.notes.length : 0,
        ai_error: error.message
      });

      return heuristicResult;
    }
  }

  try {
    const heuristicResult = parseHeuristicAttributes(content, context);

    logEvent("ai_attribute_detection.success", {
      ...logDetails,
      provider: heuristicResult.provider,
      attribute_count: Array.isArray(heuristicResult.attributes) ? heuristicResult.attributes.length : 0,
      note_count: Array.isArray(heuristicResult.notes) ? heuristicResult.notes.length : 0,
      product_name: heuristicResult.product?.name || null,
      product_brand: heuristicResult.product?.brand || null
    });

    return heuristicResult;
  } catch (error) {
    logError("ai_attribute_detection.failed", {
      ...logDetails,
      error: error.message
    });

    throw error;
  }
}
