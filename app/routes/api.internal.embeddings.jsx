import { handleEmbeddingRelay } from "../services/embeddingRelay.server.js";

export const loader = () => Response.json({ error: "Method not allowed" }, { status: 405 });
export const action = ({ request }) => handleEmbeddingRelay(request);
