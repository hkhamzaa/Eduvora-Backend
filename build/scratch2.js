"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const polar_1 = require("./utils/polar");
require("dotenv").config();
async function run() {
    try {
        const orders = await polar_1.polar.orders.list({ limit: 1 });
        console.log(JSON.stringify(orders.result.items[0], null, 2));
    }
    catch (error) {
        console.error("Error:", error);
    }
}
run();
