import { handleAccommodationMapDraft } from "../../api/admin-accommodation-map-draft.js";
import { createNetlifyFunction } from "../adapter.mjs";

export default createNetlifyFunction(handleAccommodationMapDraft);
