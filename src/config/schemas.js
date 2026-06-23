export const priceListSchema = {
  type: "array",
  item: {
    required: ["key"],
    fields: {
      key: "string",
      buy_price: "number",
      sell_price: "number",
      datetime: ["string", "number"]
    }
  }
};

export const articleSchema = {
  type: "object",
  required: ["title", "content_text"],
  fields: {
    url: "string",
    title: "string",
    content_text: "string",
    images: "array",
    links: "array"
  }
};

export const productSchema = {
  type: "object",
  required: ["title"],
  fields: {
    url: "string",
    title: "string",
    images: "array",
    content_text: "string"
  }
};
