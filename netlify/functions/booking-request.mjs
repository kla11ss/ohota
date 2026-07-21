import { handleBookingRequest } from "../../api/booking-request.js";
import { createNetlifyFunction } from "../adapter.mjs";

export default createNetlifyFunction(handleBookingRequest);
