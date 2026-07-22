import { handleAccommodationMapSession } from "../../api/admin-accommodation-map-session.js";
import { createNetlifyFunction } from "../adapter.mjs";

export default createNetlifyFunction(handleAccommodationMapSession);
