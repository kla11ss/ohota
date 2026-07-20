import { processTripRequest } from "../server/trip-request.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const result = await processTripRequest(request.body, process.env);
  response.status(result.status).json(result.body);
}
