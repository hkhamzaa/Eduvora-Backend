"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.polar = void 0;
const sdk_1 = require("@polar-sh/sdk");
require("dotenv").config();
// Create a new Polar SDK instance
// Make sure to add POLAR_ACCESS_TOKEN to your .env file
exports.polar = new sdk_1.Polar({
    accessToken: process.env.POLAR_ACCESS_TOKEN || "",
    server: "sandbox", // Use "production" for real payments
});
