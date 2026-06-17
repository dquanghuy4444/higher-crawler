import axios from "axios";

export default function createAxiosInstance(baseURL, config = {}) {
  return axios.create({
    baseURL,
    timeout: 15000,
    headers: {
      "User-Agent": "high-crawler/1.0",
      ...config.headers
    },
    ...config
  });
}
