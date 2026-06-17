import express from "express";

import { findSite, getSiteSummaries } from "./services/site-service.js";

const PORT = Number(process.env.PORT || 3000);
const app = express();

function createHttpError(statusCode, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

app.use(express.json());

app.get("/health", (_request, response) => {
  response.status(200).json({
    ok: true,
    service: "high-crawler"
  });
});

app.get("/sites", (_request, response) => {
  response.status(200).json({
    items: getSiteSummaries()
  });
});

app.post("/api/crawl", async (request, response, next) => {
  try {
    const body = request.body ?? {};
    const siteKey = body.site;

    if (!siteKey || typeof siteKey !== "string") {
      throw createHttpError(400, "Field 'site' is required and must be a string.");
    }

    const site = findSite(siteKey);
    if (!site) {
      throw createHttpError(404, `Site '${siteKey}' is not registered.`, {
        availableSites: getSiteSummaries().map((item) => item.key)
      });
    }

    const data = await site.crawl(body);

    response.status(200).json({
      ok: true,
      site: site.key,
      data
    });
  } catch (error) {
    next(error);
  }
});

app.use((request, response) => {
  response.status(404).json({
    ok: false,
    error: "Route not found."
  });
});

app.use((error, _request, response, _next) => {
  const statusCode = error.statusCode || 500;

  response.status(statusCode).json({
    ok: false,
    error: error.message || "Unexpected server error.",
    details: error.details || null
  });
});

app.listen(PORT, () => {
  console.log(`High Crawler API listening on http://localhost:${PORT}`);
});
