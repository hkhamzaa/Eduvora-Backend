import { polar } from "./utils/polar";
require("dotenv").config();

async function run() {
  try {
    const checkout = await polar.checkouts.create({
      products: [process.env.POLAR_PRODUCT_ID as string],
      amount: 1000,
      successUrl: "http://localhost:3000",
    });
    console.log("Success:", checkout.url);
  } catch (error: any) {
    console.error("Error creating checkout:");
    if (error.response) {
      console.error(error.response.data);
    } else {
      console.error(error);
    }
  }
}

run();
