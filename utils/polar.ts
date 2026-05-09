import { Polar } from "@polar-sh/sdk";
require("dotenv").config();

// Create a new Polar SDK instance
// Make sure to add POLAR_ACCESS_TOKEN to your .env file
export const polar = new Polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN || "",
  server: "sandbox", // Use "production" for real payments
});
