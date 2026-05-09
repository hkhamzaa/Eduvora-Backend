"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.polarWebhook = exports.newPayment = exports.sendStripePublishableKey = exports.getAllOrders = exports.createOrder = void 0;
const catchAsyncErrors_1 = require("../middleware/catchAsyncErrors");
const ErrorHandler_1 = __importDefault(require("../utils/ErrorHandler"));
const user_model_1 = __importDefault(require("../models/user.model"));
const course_model_1 = __importDefault(require("../models/course.model"));
const path_1 = __importDefault(require("path"));
const ejs_1 = __importDefault(require("ejs"));
const sendMail_1 = __importDefault(require("../utils/sendMail"));
const notification_Model_1 = __importDefault(require("../models/notification.Model"));
const order_service_1 = require("../services/order.service");
const redis_1 = require("../utils/redis");
require("dotenv").config();
// const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const polar_1 = require("../utils/polar");
const standardwebhooks_1 = require("standardwebhooks");
// create order
exports.createOrder = (0, catchAsyncErrors_1.CatchAsyncError)(async (req, res, next) => {
    try {
        const { courseId, payment_info } = req.body;
        /* Stripe Code Commented Out
        if (payment_info) {
          if ("id" in payment_info) {
            const paymentIntentId = payment_info.id;
            const paymentIntent = await stripe.paymentIntents.retrieve(
              paymentIntentId
            );
  
            if (paymentIntent.status !== "succeeded") {
              return next(new ErrorHandler("Payment not authorized!", 400));
            }
          }
        }
        */
        const user = await user_model_1.default.findById(req.user?._id);
        const courseExistInUser = user?.courses.some((course) => course._id.toString() === courseId);
        if (courseExistInUser) {
            return next(new ErrorHandler_1.default("You have already purchased this course", 400));
        }
        const course = await course_model_1.default.findById(courseId);
        if (!course) {
            return next(new ErrorHandler_1.default("Course not found", 404));
        }
        const data = {
            courseId: course._id,
            userId: user?._id,
            payment_info,
        };
        const mailData = {
            order: {
                _id: course._id.toString().slice(0, 6),
                name: course.name,
                price: course.price,
                date: new Date().toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                }),
            },
        };
        const html = await ejs_1.default.renderFile(path_1.default.join(__dirname, "../mails/order-confirmation.ejs"), { order: mailData });
        try {
            if (user) {
                await (0, sendMail_1.default)({
                    email: user.email,
                    subject: "Order Confirmation",
                    template: "order-confirmation.ejs",
                    data: mailData,
                });
            }
        }
        catch (error) {
            return next(new ErrorHandler_1.default(error.message, 500));
        }
        user?.courses.push(course?._id);
        await redis_1.redis.set(req.user?._id, JSON.stringify(user));
        await user?.save();
        await notification_Model_1.default.create({
            user: user?._id,
            title: "New Order",
            message: `You have a new order from ${course?.name}`,
        });
        course.purchased = course.purchased + 1;
        await course.save();
        (0, order_service_1.newOrder)(data, res, next);
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 500));
    }
});
// get All orders --- only for admin
exports.getAllOrders = (0, catchAsyncErrors_1.CatchAsyncError)(async (req, res, next) => {
    try {
        (0, order_service_1.getAllOrdersService)(res);
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 500));
    }
});
//  send stripe publishble key
exports.sendStripePublishableKey = (0, catchAsyncErrors_1.CatchAsyncError)(async (req, res) => {
    /*
    res.status(200).json({
      publishablekey: process.env.STRIPE_PUBLISHABLE_KEY,
    });
    */
    res.status(200).json({ publishablekey: "" });
});
// new payment (Polar Checkout Session)
exports.newPayment = (0, catchAsyncErrors_1.CatchAsyncError)(async (req, res, next) => {
    try {
        const { amount, courseId } = req.body;
        const userId = req.user?._id;
        if (!process.env.POLAR_PRODUCT_ID) {
            return next(new ErrorHandler_1.default("POLAR_PRODUCT_ID is missing in env", 500));
        }
        const checkout = await polar_1.polar.checkouts.create({
            products: [process.env.POLAR_PRODUCT_ID],
            amount: amount,
            successUrl: `${process.env.CLIENT_URL || "http://localhost:3000"}/course-access/${courseId}`,
            metadata: {
                courseId,
                userId,
            },
        });
        res.status(201).json({
            success: true,
            url: checkout.url,
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 500));
    }
});
// Polar Webhook
exports.polarWebhook = (0, catchAsyncErrors_1.CatchAsyncError)(async (req, res, next) => {
    try {
        const webhookSecret = process.env.POLAR_WEBHOOK_SECRET;
        if (!webhookSecret) {
            return next(new ErrorHandler_1.default("Polar Webhook secret missing", 500));
        }
        const wh = new standardwebhooks_1.Webhook(webhookSecret);
        // Use raw body buffer for verification
        const payload = req.rawBody;
        if (!payload) {
            console.error("Raw body not available");
            return res.status(400).send("Webhook Error: No body");
        }
        console.log("Webhook payload received, length:", payload?.length || 0);
        const headers = {};
        for (const [key, value] of Object.entries(req.headers)) {
            headers[key] = Array.isArray(value) ? value[0] : (value || "");
        }
        let event;
        try {
            event = wh.verify(payload, headers);
            console.log("Webhook verified! Event type:", event.type);
        }
        catch (err) {
            console.error("Webhook signature verification failed:", err.message);
            return res.status(400).send("Webhook Error: Invalid Signature");
        }
        if (event.type === "order.created") {
            const orderData = event.data;
            const metadata = orderData.metadata || orderData.checkout?.metadata;
            if (metadata?.courseId && metadata?.userId) {
                const { courseId, userId } = metadata;
                const user = await user_model_1.default.findById(userId);
                const course = await course_model_1.default.findById(courseId);
                if (user && course) {
                    const courseExistInUser = user.courses.some((c) => c._id.toString() === courseId);
                    if (!courseExistInUser) {
                        const data = {
                            courseId: course._id,
                            userId: user._id,
                            payment_info: orderData.id,
                        };
                        user.courses.push(course._id);
                        await redis_1.redis.set(userId, JSON.stringify(user));
                        await user.save();
                        await notification_Model_1.default.create({
                            user: user._id,
                            title: "New Order",
                            message: `You have a new order from ${course.name}`,
                        });
                        course.purchased = course.purchased + 1;
                        await course.save();
                        console.log(`Successfully enrolled user ${userId} in course ${courseId}`);
                        (0, order_service_1.newOrder)(data, res, next);
                        return; // End execution since newOrder handles response
                    }
                    else {
                        console.log(`User ${userId} is already enrolled in course ${courseId}`);
                    }
                }
                else {
                    console.log("User or Course not found in DB");
                }
            }
            else {
                console.log("Missing metadata in webhook:", metadata);
            }
        }
        res.status(200).send("Success");
    }
    catch (error) {
        console.error("Webhook Error:", error);
        return next(new ErrorHandler_1.default(error.message, 500));
    }
});
