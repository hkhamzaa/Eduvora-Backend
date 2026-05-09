"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const polar_1 = require("./utils/polar");
require("dotenv").config();
async function run() {
    try {
        const checkout = await polar_1.polar.checkouts.create({
            products: [process.env.POLAR_PRODUCT_ID],
            amount: 1000,
            successUrl: "http://localhost:3000",
        });
        console.log("Success:", checkout.url);
    }
    catch (error) {
        console.error("Error creating checkout:");
        if (error.response) {
            console.error(error.response.data);
        }
        else {
            console.error(error);
        }
    }
}
run();
