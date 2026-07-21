import { handleAvailabilityCheck } from "../../api/availability/check.js";
import { createNetlifyFunction } from "../adapter.mjs";

export default createNetlifyFunction(handleAvailabilityCheck);
