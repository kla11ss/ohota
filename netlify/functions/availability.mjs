import { handleAvailability } from "../../api/availability.js";
import { createNetlifyFunction } from "../adapter.mjs";

export default createNetlifyFunction(handleAvailability);
