import { handleAccommodationMapPublish } from "../../api/admin-accommodation-map-publish.js";
import { createNetlifyFunction } from "../adapter.mjs";

export default createNetlifyFunction(handleAccommodationMapPublish);
