// seed.ts
require("dotenv").config(); // ← MUST be the very first line
import mongoose from "mongoose";
import { connectNeo4j, getNeo4jSession } from "./utils/neo4j";
import UserModel from "./models/user.model";
import CourseModel from "./models/course.model";

const seed = async () => {
  try {
    await mongoose.connect(process.env.DB_URL as string);
    console.log("MongoDB connected");

    await connectNeo4j();
    console.log("Neo4j connected");

    const session = getNeo4jSession();

    try {
      // ── Step 1: Seed all courses ─────────────────────────────────────
      const courses = await CourseModel.find({}).lean();
      console.log(`⏳ Seeding ${courses.length} courses...`);

      for (const course of courses) {
        await session.run(
          `
          MERGE (c:Course {id: $id})
          SET c.name     = $name,
              c.category = $category,
              c.level    = $level
          MERGE (cat:Category {name: $category})
          MERGE (c)-[:BELONGS_TO]->(cat)
          `,
          {
            id: course._id.toString(),
            name: course.name,
            category: course.categories ?? "General",
            level: course.level ?? "Beginner",
          },
        );
      }
      console.log(`Seeded ${courses.length} courses`);

      // ── Step 2: Seed all users ────────────────────────────────────────
      const users = await UserModel.find({}).lean();
      console.log(`Seeding ${users.length} users...`);

      for (const user of users) {
        await session.run(
          `
          MERGE (u:User {id: $id})
          SET u.email = $email
          `,
          {
            id: user._id.toString(),
            email: user.email,
          },
        );

        if (user.courses && user.courses.length > 0) {
          for (const enrolled of user.courses) {
            // handle both { courseId: string } and plain ObjectId
            const courseId = enrolled.courseId
              ? enrolled.courseId.toString()
              : enrolled.toString();

            // skip if courseId is still invalid
            if (!courseId || courseId === "[object Object]") continue;

            await session.run(
              `
              MATCH (u:User   {id: $userId})
              MATCH (c:Course {id: $courseId})
              MERGE (u)-[r:ENROLLED_IN]->(c)
              SET r.enrolledAt = datetime()
              `,
              {
                userId: user._id.toString(),
                courseId: courseId,
              },
            );
          }
        }
      }
      console.log(`Seeded ${users.length} users with enrollments`);
      console.log("Seed complete — Neo4j is now in sync with MongoDB");
    } finally {
      await session.close();
    }
  } catch (err) {
    console.error("Seed failed:", err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
};

seed();
