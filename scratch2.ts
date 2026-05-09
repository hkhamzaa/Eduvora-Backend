import { polar } from "./utils/polar";
require("dotenv").config();

async function run() {
  try {
    const orders = await polar.orders.list({ limit: 1 });
    console.log(JSON.stringify(orders.result.items[0], null, 2));
  } catch (error: any) {
    console.error("Error:", error);
  }
}

run();
