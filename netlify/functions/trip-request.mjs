import { handleTripRequest } from "../../api/trip-request.js";
import { createNetlifyFunction } from "../adapter.mjs";

export default createNetlifyFunction(handleTripRequest);
