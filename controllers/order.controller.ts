import { NextFunction, Request, Response } from "express";
import { CatchAsyncError } from "../middleware/catchAsyncErrors";
import ErrorHandler from "../utils/ErrorHandler";
import { IOrder } from "../models/order.Model";
import userModel from "../models/user.model";
import CourseModel, { ICourse } from "../models/course.model";
import path from "path";
import ejs from "ejs";
import sendMail from "../utils/sendMail";
import NotificationModel from "../models/notification.Model";
import { getAllOrdersService, newOrder } from "../services/order.service";
import { redis } from "../utils/redis";
import { createEnrollmentRelation } from "../services/neo4j.service";
require("dotenv").config();
// const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
import { polar } from "../utils/polar";
import {
  validateEvent,
  WebhookVerificationError,
} from "@polar-sh/sdk/webhooks";

// create order
export const createOrder = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { courseId, payment_info } = req.body as IOrder;

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

      const user = await userModel.findById(req.user?._id);

      const courseExistInUser = user?.courses.some(
        (course: any) => course.courseId === courseId,
      );

      if (courseExistInUser) {
        return next(
          new ErrorHandler("You have already purchased this course", 400),
        );
      }

      const course: ICourse | null = await CourseModel.findById(courseId);

      if (!course) {
        return next(new ErrorHandler("Course not found", 404));
      }

      const data: any = {
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

      const html = await ejs.renderFile(
        path.join(__dirname, "../mails/order-confirmation.ejs"),
        { order: mailData },
      );

      try {
        if (user) {
          await sendMail({
            email: user.email,
            subject: "Order Confirmation",
            template: "order-confirmation.ejs",
            data: mailData,
          });
        }
      } catch (error: any) {
        return next(new ErrorHandler(error.message, 500));
      }

      user?.courses.push({ courseId: course._id.toString() });

      await redis.set(req.user?._id, JSON.stringify(user));

      await user?.save();

      if (user && course) {
        await createEnrollmentRelation(
          user._id.toString(),
          course._id.toString(),
          course.name,
          user.email,
        );
      }

      await NotificationModel.create({
        user: user?._id,
        title: "New Order",
        message: `You have a new order from ${course?.name}`,
      });

      course.purchased = course.purchased + 1;

      await course.save();

      newOrder(data, res, next);
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
    }
  },
);

// get All orders --- only for admin
export const getAllOrders = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      getAllOrdersService(res);
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
    }
  },
);

//  send stripe publishble key
export const sendStripePublishableKey = CatchAsyncError(
  async (req: Request, res: Response) => {
    /*
    res.status(200).json({
      publishablekey: process.env.STRIPE_PUBLISHABLE_KEY,
    });
    */
    res.status(200).json({ publishablekey: "" });
  },
);

// new payment (Polar Checkout Session)
export const newPayment = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { courseId } = req.body;
      const userId = req.user?._id as string;

      if (!process.env.POLAR_PRODUCT_ID) {
        return next(
          new ErrorHandler("POLAR_PRODUCT_ID is missing in env", 500),
        );
      }

      const checkout = await polar.checkouts.create({
        products: [process.env.POLAR_PRODUCT_ID],
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
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
    }
  },
);

// Polar Webhook
export const polarWebhook = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const webhookSecret = process.env.POLAR_WEBHOOK_SECRET;

      if (!webhookSecret) {
        return next(new ErrorHandler("Polar Webhook secret missing", 500));
      }

      const rawBody = (req as any).rawBody as Buffer;

      if (!rawBody) {
        return res.status(400).send("Webhook Error: No body");
      }

      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        headers[key] = Array.isArray(value) ? value[0] : value || "";
      }

      let event: any;
      try {
        event = validateEvent(rawBody.toString(), headers, webhookSecret);
      } catch (err: any) {
        if (err instanceof WebhookVerificationError) {
          console.error("Webhook verification failed:", err.message);
          return res.status(400).send("Webhook Error: Invalid Signature");
        }
        throw err;
      }

      if (event.type === "order.paid") {
        const orderData = event.data;
        const metadata =
          orderData.metadata ?? orderData.checkout?.metadata ?? {};

        const { courseId, userId } = metadata as {
          courseId?: string;
          userId?: string;
        };

        if (courseId && userId) {
          const user = await userModel.findById(userId);
          const course: ICourse | null = await CourseModel.findById(courseId);
          
          if (user && course) {
            const alreadyEnrolled = user.courses.some(
              (c: any) => c.courseId === courseId, // ← matches your model
            );
            if (!alreadyEnrolled) {
              user.courses.push({ courseId: course._id.toString() });
              await redis.set(userId, JSON.stringify(user));
              await user.save();

              if (user && course) {
                await createEnrollmentRelation(
                  user._id.toString(),
                  course._id.toString(),
                  course.name,
                  user.email,
                );
              }

              await NotificationModel.create({
                user: user._id,
                title: "New Order",
                message: `You have a new order from ${course.name}`,
              });

              course.purchased = course.purchased + 1;
              await course.save();

              const orderRecord: any = {
                courseId: course._id,
                userId: user._id,
                payment_info: orderData.id,
              };

              newOrder(orderRecord, res, next);
              return;
            }
          }
        }
      }

      res.status(200).send("OK");
    } catch (error: any) {
      console.error("Webhook Error:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  },
);
