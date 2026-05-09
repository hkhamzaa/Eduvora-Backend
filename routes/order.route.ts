import express from "express";
import { authorizeRoles, isAutheticated } from "../middleware/auth";
import {
  createOrder,
  getAllOrders,
  newPayment,
  sendStripePublishableKey,
  polarWebhook,
} from "../controllers/order.controller";
const orderRouter = express.Router();

orderRouter.post("/create-order", isAutheticated, createOrder);

orderRouter.get(
  "/get-orders",
  isAutheticated,
  authorizeRoles("admin"),
  getAllOrders
);

// orderRouter.get("/payment/stripepublishablekey", sendStripePublishableKey);

orderRouter.post("/order/polar-webhook", polarWebhook);

orderRouter.post("/payment", isAutheticated, newPayment);

export default orderRouter;
