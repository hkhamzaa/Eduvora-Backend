# Viva Defense Guide — Neo4j & Frontend-Backend Integration

---

## PART 1 — NEO4J: ALL FILES EXPLAINED

There are exactly **4 dedicated Neo4j files** in the server. Then Neo4j is also called from inside **3 existing controllers** and **1 existing service**. Here is every single one explained simply.

---

### FILE 1 — `server/utils/neo4j.ts`
**What this file is:** The "starter cable" for Neo4j. It sets up the actual connection to the Neo4j database.

**Think of it like this:** Before you can use a database, you need to plug in and connect. This file does that plug-in.

**What the code does, line by line:**

```ts
let driver: Driver;
```
`driver` is the Neo4j connection object. It is declared at the top so the whole file can use it.

```ts
export const connectNeo4j = async () => {
  driver = neo4j.driver(
    process.env.NEO4J_URI,          // the address of your Neo4j database
    neo4j.auth.basic(
      process.env.NEO4J_USERNAME,   // username (usually "neo4j")
      process.env.NEO4J_PASSWORD    // password you set
    )
  );
  await driver.verifyConnectivity(); // actually tests the connection
  console.log("Neo4j connected successfully");
```
This function is called once when the server starts. It uses environment variables (from `.env`) to find and log in to the Neo4j database.

**Key design decision — graceful degradation:**
```ts
} catch (error) {
  console.error("Neo4j connection failed:", error);
  // We do NOT crash the server
}
```
If Neo4j is down, the server keeps running. Neo4j is "additive" — it adds features (recommendations, learning paths) but the core app (login, courses, payments) works fine without it.

```ts
export const getNeo4jSession = () => {
  if (!driver) throw new Error("Neo4j driver not initialized");
  return driver.session();
};
```
Every time you want to run a query, you need a "session" — like opening a new tab in a browser. This function creates one. Every service function calls this to get a session before running Cypher queries.

```ts
export const closeNeo4j = async () => {
  if (driver) await driver.close();
};
```
Cleanly closes the connection when the server shuts down.

**In one sentence for viva:** "This file initializes the Neo4j driver using credentials from the environment, exports a function to get sessions for queries, and connects to Neo4j on server startup with graceful error handling so the app doesn't crash if Neo4j is unavailable."

---

### FILE 2 — `server/services/neo4j.service.ts`
**What this file is:** All the actual Neo4j business logic. Every function here talks to the Neo4j graph database. This is the heart of the Neo4j implementation.

**Think of it like this:** If `neo4j.ts` is the plug, this file is all the actual electrical work — everything that uses the electricity.

There are **8 functions** in this file. Here is each one:

---

#### Function 1: `createUserNode(userId, email)`
**When is it called?** When a user activates their account (completes email verification).

**What does it do in the graph?**
Creates a `User` node in Neo4j.

```cypher
MERGE (u:User {id: $userId})
SET u.email = $email
```
`MERGE` means "create if it doesn't already exist." So if this runs twice for the same user, it just updates — no duplicate nodes.

**Why do we need a User node in Neo4j?**
Because later, when we want to find recommendations, we need to traverse: "which courses did this user enroll in?" You cannot traverse relationships without nodes.

---

#### Function 2: `createCourseNode(courseId, courseName, category, level)`
**When is it called?** When an admin creates a new course.

**What does it do in the graph?**
Creates two nodes and one relationship:

```cypher
MERGE (c:Course {id: $courseId})
SET c.name = $courseName, c.category = $category, c.level = $level
MERGE (cat:Category {name: $category})
MERGE (c)-[:BELONGS_TO]->(cat)
```

- Creates a `Course` node
- Creates a `Category` node (e.g., "Web Development")
- Links them: `(Course)-[:BELONGS_TO]->(Category)`

**Why store category as a separate node?**
Because in a graph, Category becomes a hub. All courses in "Web Development" point to the same Category node. This allows queries like "find all courses in the same category as this one" to be extremely fast.

---

#### Function 3: `updateCourseNode(courseId, courseName, category, level)`
**When is it called?** When an admin edits an existing course.

**What does it do?**
Same Cypher as `createCourseNode`. `MERGE` handles the "update if exists" logic — no need for a separate UPDATE statement. It also re-links the Category relationship in case the category changed.

---

#### Function 4: `deleteCourseNode(courseId)`
**When is it called?** When an admin deletes a course from MongoDB.

**What does it do?**
```cypher
MATCH (c:Course {id: $courseId})
DETACH DELETE c
```
`DETACH DELETE` is Neo4j's cascade delete. It deletes the Course node AND automatically removes every relationship attached to it (enrollments, prerequisite links, category links). Without `DETACH DELETE`, Neo4j would refuse to delete a node that still has relationships.

**Why is this important?**
Without this, when you delete a course from MongoDB, orphaned `Course` nodes would pile up in Neo4j forever, poisoning the recommendation queries.

---

#### Function 5: `createEnrollmentRelation(userId, courseId, courseName, userEmail)`
**When is it called?** When a user successfully purchases/enrolls in a course (called from `order.controller.ts`).

**What does it do in the graph?**
```cypher
MERGE (u:User {id: $userId, email: $userEmail})
MERGE (c:Course {id: $courseId, name: $courseName})
MERGE (u)-[r:ENROLLED_IN]->(c)
SET r.enrolledAt = datetime()
```

This is the most important relationship in the whole graph. It creates:
`(User)-[:ENROLLED_IN {enrolledAt: timestamp}]->(Course)`

**Why MERGE instead of CREATE?**
`MERGE` ensures no duplicate enrollments. If the webhook fires twice for the same payment, only one `ENROLLED_IN` relationship is created.

**Why is this relationship the core of the whole Neo4j system?**
Because ALL recommendations are based on this relationship. The recommendation query traverses `ENROLLED_IN` edges to find similar users and their courses.

---

#### Function 6: `markCourseCompleted(userId, courseId)`
**When is it called?** When a user completes a course.

**What does it do?**
```cypher
MATCH (u:User {id: $userId})-[r:ENROLLED_IN]->(c:Course {id: $courseId})
SET r.completed = true, r.completedAt = datetime()
```
It does NOT create a new relationship. It updates the existing `ENROLLED_IN` relationship by setting properties on it: `completed = true` and `completedAt = now`. This is a key feature of graph databases — relationships can have their own properties, just like nodes.

---

#### Function 7: `getRecommendedCourses(userId)` — THE MOST IMPORTANT FUNCTION
**When is it called?** When a logged-in user hits the recommendations endpoint.

**What does it return?** A list of course IDs ranked by how many "similar users" also took them.

**The Cypher query (memorize this):**
```cypher
MATCH (u:User {id: $userId})-[:ENROLLED_IN]->(c:Course)
      <-[:ENROLLED_IN]-(similar:User)-[:ENROLLED_IN]->(rec:Course)
WHERE NOT (u)-[:ENROLLED_IN]->(rec)
  AND u.id <> similar.id
RETURN rec.id AS courseId, rec.name AS courseName, COUNT(*) AS score
ORDER BY score DESC
LIMIT 6
```

**Explain this in plain English step by step:**
1. "Start with ME (the current user)"
2. "Find all courses I am enrolled in" — that's the first `[:ENROLLED_IN]->(c:Course)`
3. "Find OTHER users who are also enrolled in those same courses" — that's `<-[:ENROLLED_IN]-(similar:User)`
4. "Find what OTHER courses those similar users are enrolled in" — that's `-[:ENROLLED_IN]->(rec:Course)`
5. "Filter out: don't recommend courses I already took" — that's `WHERE NOT (u)-[:ENROLLED_IN]->(rec)`
6. "Count how many similar users took each recommended course" — `COUNT(*) AS score`
7. "Return the top 6, most popular among similar users first" — `ORDER BY score DESC LIMIT 6`

**This is collaborative filtering** — the same algorithm Netflix uses for "Because you watched X" and Amazon uses for "Customers also bought."

**Why is Neo4j better than MongoDB for this?**
In MongoDB, you would have to: load ALL users, compare their course arrays to yours, find matching users, then look at their other courses. This is O(n²) — it gets slower as users grow. In Neo4j, this is a single pattern match that traverses only the relevant connected nodes.

---

#### Function 8: `getLearningPath(courseId)`
**When is it called?** When someone views a course and wants to know "what should I learn before this?"

**The Cypher query:**
```cypher
MATCH path = (start:Course)-[:IS_PREREQUISITE_OF*]->(target:Course {id: $courseId})
RETURN [node IN nodes(path) | {id: node.id, name: node.name}] AS learningPath
ORDER BY length(path) ASC
LIMIT 1
```

**Explain in plain English:**
- `[:IS_PREREQUISITE_OF*]` — the `*` means "any number of hops." It traverses the entire prerequisite chain, however deep it is.
- This finds: "Course A → Course B → Course C → Target Course" and returns the whole ordered chain.
- Without Neo4j, doing this in SQL would require a recursive CTE (Common Table Expression) — extremely complex. In Neo4j, it's one pattern.

---

#### Function 9: `setPrerequisite(courseId, prerequisiteCourseId)`
**When is it called?** When an admin defines that Course A must be taken before Course B.

**What does it do?**
```cypher
MATCH (c:Course {id: $courseId})
MATCH (pre:Course {id: $prerequisiteCourseId})
MERGE (pre)-[:IS_PREREQUISITE_OF]->(c)
```
Creates a directed relationship: `(Prerequisite Course)-[:IS_PREREQUISITE_OF]->(Target Course)`

---

#### Function 10: `getGraphStats()`
**When is it called?** By the admin analytics endpoint.

**What does it return?** Total number of users, courses, and enrollments in the graph.

```cypher
MATCH (u:User) WITH COUNT(u) AS totalUsers
MATCH (c:Course) WITH totalUsers, COUNT(c) AS totalCourses
OPTIONAL MATCH ()-[r:ENROLLED_IN]->()
RETURN totalUsers, totalCourses, COUNT(r) AS totalEnrollments
```
One query counts three things. The `.toNumber()` call is needed because Neo4j returns integers as its own `Integer` type, not JavaScript numbers.

---

### FILE 3 — `server/controllers/neo4j.controller.ts`
**What this file is:** The HTTP layer for Neo4j. It receives HTTP requests, calls service functions, and sends back HTTP responses.

**Think of it like this:** The service file has the intelligence; the controller is the reception desk that takes your request and hands it to the right specialist.

There are **4 controller functions:**

---

#### Controller 1: `getCourseRecommendations` — GET `/api/v1/neo4j/recommendations`
```ts
const userId = req.user?._id?.toString();
const recommendedIds = await getRecommendedCourses(userId);  // Neo4j → returns IDs
const courses = await CourseModel.find({ _id: { $in: recommendedIds } })
  .select("name thumbnail description ratings purchased price");  // MongoDB → returns full docs
```

**Key design point — two databases working together:**
1. Neo4j gives us the **ranked list of course IDs** (it knows the relationships)
2. MongoDB gives us the **full course details** (it has the actual data like thumbnails, descriptions, prices)

Neither database alone can answer this request. Neo4j doesn't store course details. MongoDB doesn't know about user similarity. They cooperate.

The response includes `source: "neo4j-graph"` so the frontend knows these came from graph intelligence, not a simple query.

---

#### Controller 2: `getCourseLearningPath` — GET `/api/v1/neo4j/learning-path/:courseId`
```ts
const { courseId } = req.params;
const path = await getLearningPath(courseId);
res.status(200).json({ success: true, learningPath: path });
```
Simple: takes a course ID from the URL, asks Neo4j for the prerequisite chain, returns it. No authentication required — anyone browsing can see the learning path.

---

#### Controller 3: `getGraphAnalytics` — GET `/api/v1/neo4j/graph-stats`
```ts
const stats = await getGraphStats();
res.status(200).json({ success: true, graphStats: stats });
```
Returns `{ totalUsers, totalCourses, totalEnrollments }` for the admin dashboard.

---

#### Controller 4: `addCoursePrerequisite` — POST `/api/v1/neo4j/prerequisite`
```ts
const { courseId, prerequisiteCourseId } = req.body;
await setPrerequisite(courseId, prerequisiteCourseId);
```
Admin-only. Takes two course IDs from the request body and creates the prerequisite relationship in Neo4j.

---

### FILE 4 — `server/routes/neo4j.route.ts`
**What this file is:** The routing table. It maps HTTP method + URL path to controller functions.

```ts
neo4jRouter.get("/recommendations", isAutheticated, getCourseRecommendations);
neo4jRouter.get("/learning-path/:courseId", getCourseLearningPath);
neo4jRouter.get("/graph-stats", getGraphAnalytics);
neo4jRouter.post("/prerequisite", isAutheticated, addCoursePrerequisite);
```

**Notice the middleware pattern:**
- `isAutheticated` comes before the controller function for protected routes
- Routes without `isAutheticated` are public (learning path, graph stats)
- The router itself is imported in `app.ts` and mounted at `/api/v1/neo4j`

So the full URLs are:
- `GET http://localhost:8000/api/v1/neo4j/recommendations`
- `GET http://localhost:8000/api/v1/neo4j/learning-path/:courseId`
- `GET http://localhost:8000/api/v1/neo4j/graph-stats`
- `POST http://localhost:8000/api/v1/neo4j/prerequisite`

---

### WHERE NEO4J IS CALLED FROM EXISTING FILES

These are NOT Neo4j-dedicated files, but Neo4j is integrated into them:

---

#### `server/server.ts` — Server Startup
```ts
import { connectNeo4j } from "./utils/neo4j";

server.listen(process.env.PORT, () => {
  connectDB();       // connects MongoDB
  connectNeo4j();    // connects Neo4j
});
```
**One line.** Neo4j is started alongside MongoDB when the server boots. Both databases are initialized in the same startup callback.

---

#### `server/app.ts` — Route Registration
```ts
import neo4jRouter from "./routes/neo4j.route";
app.use("/api/v1/neo4j", neo4jRouter);
```
The Neo4j router is mounted separately from all other routes. All other routes are mounted at `/api/v1` as a group; Neo4j gets its own explicit mount point at `/api/v1/neo4j`.

---

#### `server/controllers/user.controller.ts` — User Activation
```ts
import { createUserNode } from "../services/neo4j.service";

// Inside activateUser():
const user = await userModel.create({ name, email, password });  // MongoDB
await createUserNode(user._id.toString(), user.email);           // Neo4j
```
**After** the user is created in MongoDB, we immediately mirror the user into Neo4j as a `User` node. Both happen in the same request. The MongoDB `_id` is used as the Neo4j node's `id` property — this is the shared key that ties the two databases together.

---

#### `server/services/course.service.ts` — Course Creation
```ts
import { createCourseNode } from "./neo4j.service";

export const createCourse = CatchAsyncError(async (data, res) => {
  const course = await CourseModel.create(data);  // MongoDB
  await createCourseNode(
    course._id.toString(),
    course.name,
    course.categories ?? "General",
    course.level ?? "Beginner"
  );                                              // Neo4j
  res.status(201).json({ success: true, course });
});
```
Same pattern: MongoDB first, then Neo4j. The course's MongoDB `_id` becomes the `id` of the Neo4j Course node.

---

#### `server/controllers/course.controller.ts` — Course Edit & Delete
```ts
import { createCourseNode, updateCourseNode, deleteCourseNode } from "../services/neo4j.service";

// In editCourse():
await updateCourseNode(course._id.toString(), course.name, categories, level);

// In deleteCourse():
await deleteCourseNode(courseId);  // DETACH DELETE removes node + all relationships
```
When a course is edited, the graph is updated too so metadata stays in sync. When a course is deleted from MongoDB, `DETACH DELETE` removes it cleanly from Neo4j.

---

#### `server/controllers/order.controller.ts` — Payment & Enrollment
```ts
import { createEnrollmentRelation } from "../services/neo4j.service";

// After user successfully purchases:
await createEnrollmentRelation(
  user._id.toString(),
  course._id.toString(),
  course.name,
  user.email,
);
```
This is called in TWO places in this file:
1. `createOrder` — direct order creation
2. `polarWebhook` — when Polar sends a signed payment confirmation webhook

Both paths record the enrollment in Neo4j. The enrollment is the most critical data point for the recommendation engine.

---

## THE NEO4J GRAPH SCHEMA (memorize this)

```
Nodes:
  (:User  { id, email })
  (:Course { id, name, category, level })
  (:Category { name })

Relationships:
  (User)-[:ENROLLED_IN { enrolledAt, completed, completedAt }]->(Course)
  (Course)-[:BELONGS_TO]->(Category)
  (Course)-[:IS_PREREQUISITE_OF]->(Course)
```

**How data flows into the graph:**
- User registers + activates → `User` node created
- Admin creates course → `Course` node + `Category` node + `BELONGS_TO` created
- User purchases course → `ENROLLED_IN` relationship created
- Admin edits course → `Course` node properties updated
- Admin deletes course → `DETACH DELETE` removes node + all its edges
- Admin sets prerequisite → `IS_PREREQUISITE_OF` relationship created

---

---

## PART 2 — FRONTEND-BACKEND INTEGRATION: ALL FILES EXPLAINED

The frontend (Next.js, in `/client`) and backend (Node.js/Express, in `/server`) are completely separate processes. They communicate only through HTTP API calls. Here is every file that handles this connection.

---

### THE BRIDGE: `client/.env`
```
NEXT_PUBLIC_SERVER_URI=http://localhost:8000/api/v1/
```
This single environment variable is the address of the entire backend. Every single API call in the frontend uses this. If the backend moves to a different port or domain, you change this one line and everything updates.

`NEXT_PUBLIC_` prefix is a Next.js convention — it makes the variable available in the browser (client-side code), not just on the server side of Next.js.

---

### HOW THE FRONTEND MAKES API CALLS — RTK Query

Instead of writing `fetch()` or `axios()` calls everywhere, the frontend uses **RTK Query** (Redux Toolkit Query). RTK Query is a system that:
1. Defines API endpoints in one place
2. Generates React hooks for each endpoint automatically
3. Handles caching, loading states, and error states automatically
4. Stores responses in the Redux store so components share data

**The hierarchy:**
```
store.ts
  └── apiSlice.ts  (base configuration — the root)
        ├── authApi.ts  (auth endpoints injected in)
        ├── coursesApi.ts  (course endpoints injected in)
        ├── ordersApi.ts  (order endpoints injected in)
        ├── userApi.ts  (user management endpoints)
        ├── analyticsApi.ts  (analytics endpoints)
        ├── notificationsApi.ts  (notification endpoints)
        └── layoutApi.ts  (CMS content endpoints)
```

---

### FILE 1 — `client/redux/features/store.ts`
**What this file is:** The Redux store — the central memory of the entire frontend application.

```ts
export const store = configureStore({
  reducer: {
    [apiSlice.reducerPath]: apiSlice.reducer,   // all API cache lives here
    auth: authSlice,                             // login state lives here
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(apiSlice.middleware),
});
```

**What the store holds:**
- `api` key: all cached API responses (course lists, user data, orders, etc.)
- `auth` key: whether the user is logged in, their token, their profile

**The auto-initialization:**
```ts
const initializeApp = async () => {
  await store.dispatch(
    apiSlice.endpoints.loadUser.initiate({}, { forceRefetch: true })
  );
};
initializeApp();
```
When the app first loads (even before any component renders), it immediately calls the `GET /me` endpoint to check if the user is already logged in (has a valid cookie). This is how the app "remembers" you across page refreshes. `forceRefetch: true` means it always makes a fresh network call — it never uses a stale cached value for auth.

---

### FILE 2 — `client/redux/features/api/apiSlice.ts`
**What this file is:** The root/base API configuration. Everything else builds on top of this.

```ts
export const apiSlice = createApi({
  reducerPath: "api",
  baseQuery: fetchBaseQuery({
    baseUrl: process.env.NEXT_PUBLIC_SERVER_URI,   // "http://localhost:8000/api/v1/"
  }),
  endpoints: (builder) => ({
    refreshToken: builder.query({
      query: () => ({ url: "refresh", method: "GET", credentials: "include" }),
    }),
    loadUser: builder.query({
      query: () => ({ url: "me", method: "GET", credentials: "include" }),
      async onQueryStarted(arg, { queryFulfilled, dispatch }) {
        const result = await queryFulfilled;
        dispatch(userLoggedIn({
          accessToken: result.data.accessToken,
          user: result.data.user,
        }));
      },
    }),
  }),
});
```

**Key points:**
- `baseUrl` is set once here — all other API files just add relative paths like `"login"` or `"get-courses"`
- `credentials: "include"` means cookies are sent with every request — this is how JWT tokens in cookies are transmitted to the backend
- `loadUser`'s `onQueryStarted` hook: when the `/me` endpoint succeeds, it automatically dispatches `userLoggedIn` to update the auth state. This is the bridge between the API response and the Redux auth state.

---

### FILE 3 — `client/redux/features/auth/authSlice.ts`
**What this file is:** The auth state manager — knows who is logged in.

Manages three pieces of state: `token`, `user`, and three actions:
- `userRegistration` — stores the activation token during registration flow
- `userLoggedIn` — stores the access token and user object after login
- `userLoggedOut` — clears everything

Components anywhere in the app can read `state.auth.user` to know who is logged in. They never need to call the API again — the store has the data.

---

### FILE 4 — `client/redux/features/auth/authApi.ts`
**What this file is:** All authentication-related API endpoints injected into the base slice.

| Hook | HTTP Call | What it does |
|---|---|---|
| `useRegisterMutation` | POST `/registration` | Sends name/email/password, gets activation token back |
| `useActivationMutation` | POST `/activate-user` | Sends activation token + 6-digit code, creates account |
| `useLoginMutation` | POST `/login` | Sends email/password, gets JWT cookie + user data |
| `useSocialAuthMutation` | POST `/social-auth` | Google/GitHub OAuth login |
| `useLogOutQuery` | GET `/logout` | Clears server-side session, logs out |

**The login flow connects frontend to backend like this:**
1. User fills in login form → component calls `useLoginMutation`
2. RTK Query sends `POST http://localhost:8000/api/v1/login` with credentials
3. Backend sets two HTTP-only cookies: `access_token` and `refresh_token`
4. Backend returns `{ user, accessToken }` in the response body
5. `onQueryStarted` in authApi dispatches `userLoggedIn` → Redux auth state updated
6. Every subsequent API call sends cookies automatically due to `credentials: "include"`

---

### FILE 5 — `client/redux/features/courses/coursesApi.ts`
**What this file is:** All course-related API endpoints.

| Hook | HTTP Call | Used by |
|---|---|---|
| `useCreateCourseMutation` | POST `/create-course` | Admin course creation form |
| `useGetAllCoursesQuery` | GET `/get-admin-courses` | Admin courses list page |
| `useDeleteCourseMutation` | DELETE `/delete-course/:id` | Admin delete button |
| `useEditCourseMutation` | PUT `/edit-course/:id` | Admin edit course form |
| `useGetUsersAllCoursesQuery` | GET `/get-courses` | Public course catalog |
| `useGetCourseDetailsQuery` | GET `/get-course/:id` | Course detail page |
| `useGetCourseContentQuery` | GET `/get-course-content/:id` | Video player (enrolled users only) |
| `useAddNewQuestionMutation` | PUT `/add-question` | Q&A section |
| `useAddAnswerInQuestionMutation` | PUT `/add-answer` | Q&A replies |
| `useAddReviewInCourseMutation` | PUT `/add-review/:id` | Review submission |
| `useAddReplyInReviewMutation` | PUT `/add-reply` | Admin reply to review |

**Important:** `get-course/:id` is the public endpoint (no video URLs in response due to MongoDB projection). `get-course-content/:id` is the private endpoint for enrolled users that returns actual video data.

---

### FILE 6 — `client/redux/features/orders/ordersApi.ts`
**What this file is:** Payment and order endpoints.

| Hook | HTTP Call | What it does |
|---|---|---|
| `useGetAllOrdersQuery` | GET `/get-orders` | Admin order history |
| `useCreateCheckoutSessionMutation` | POST `/payment` | Creates Polar checkout URL |
| `useCreateOrderMutation` | POST `/create-order` | Direct order creation |

**The payment flow:**
1. User clicks "Buy Now" → frontend calls `POST /payment` with courseId
2. Backend creates a Polar checkout session, returns the checkout URL
3. Frontend redirects user to Polar's hosted payment page
4. User pays → Polar sends a signed webhook to the backend
5. Backend verifies signature → creates order in MongoDB → creates enrollment in Neo4j
6. User is redirected to `/course-access/:courseId` (the success URL)

---

### FILE 7 — `client/redux/features/user/userApi.ts`
**What this file is:** User profile management endpoints.

| Hook | HTTP Call | What it does |
|---|---|---|
| `useUpdateAvatarMutation` | PUT `/update-user-avatar` | Profile picture upload |
| `useEditProfileMutation` | PUT `/update-user-info` | Name change |
| `useUpdatePasswordMutation` | PUT `/update-user-password` | Password change |
| `useGetAllUsersQuery` | GET `/get-users` | Admin users list |
| `useUpdateUserRoleMutation` | PUT `/update-user` | Admin promotes user to admin |
| `useDeleteUserMutation` | DELETE `/delete-user/:id` | Admin deletes user |

---

### FILE 8 — `client/redux/features/analytics/analyticsApi.ts`
**What this file is:** Admin dashboard analytics endpoints.

| Hook | HTTP Call | What it returns |
|---|---|---|
| `useGetCoursesAnalyticsQuery` | GET `/get-courses-analytics` | Monthly course creation counts (12 months) |
| `useGetUsersAnalyticsQuery` | GET `/get-users-analytics` | Monthly user registration counts (12 months) |
| `useGetOrdersAnalyticsQuery` | GET `/get-orders-analytics` | Monthly order counts (12 months) |

These power the line charts in the admin dashboard. The backend runs 12 separate `countDocuments()` queries (one per month) and returns the array.

---

### FILE 9 — `client/redux/features/notifications/notificationsApi.ts`
**What this file is:** Real-time notification endpoints.

| Hook | HTTP Call | What it does |
|---|---|---|
| `useGetAllNotificationsQuery` | GET `/get-all-notifications` | Fetches all notifications for admin |
| `useUpdateNotificationStatusMutation` | PUT `/update-notification/:id` | Marks notification as read |

Notifications are also delivered in real-time via Socket.io — the backend broadcasts to connected admin clients when a new order arrives.

---

### FILE 10 — `client/redux/features/layout/layoutApi.ts`
**What this file is:** CMS (Content Management System) endpoints for editable homepage content.

| Hook | HTTP Call | What it does |
|---|---|---|
| `useGetHeroDataQuery` | GET `/get-layout/:type` | Fetches Banner, FAQ, or Categories data |
| `useEditLayoutMutation` | PUT `/edit-layout` | Admin edits homepage content |

The `type` parameter can be `"Banner"`, `"FAQ"`, or `"Categories"`. One collection in MongoDB serves all three types.

---

### HOW A COMPONENT USES ALL OF THIS

Here is a concrete example of how a React component talks to the backend using this system:

**A component showing course recommendations (using Neo4j):**
```tsx
// The component just calls a hook — no fetch(), no axios, no URLs
const { data, isLoading } = useGetCourseRecommendationsQuery();

if (isLoading) return <Spinner />;
return data?.courses.map(course => <CourseCard key={course._id} {...course} />);
```

Behind the scenes:
1. Hook fires `GET http://localhost:8000/api/v1/neo4j/recommendations`
2. Cookie is sent automatically (contains JWT access token)
3. Backend `isAutheticated` middleware reads the cookie, identifies the user
4. `getCourseRecommendations` controller calls Neo4j service
5. Neo4j runs collaborative filtering query → returns course IDs
6. MongoDB fetches full course details for those IDs
7. Response returns to frontend
8. RTK Query caches the result — if the component re-renders, no new API call is made
9. Component renders with the data

---

## COMPLETE FILE MAP — QUICK REFERENCE

### Neo4j Files
| File | Role |
|---|---|
| `server/utils/neo4j.ts` | Driver init, connect, session factory |
| `server/services/neo4j.service.ts` | All Cypher queries (8 functions) |
| `server/controllers/neo4j.controller.ts` | HTTP handler (4 endpoints) |
| `server/routes/neo4j.route.ts` | URL-to-controller mapping |

### Neo4j Integration in Existing Files
| File | What Neo4j does here |
|---|---|
| `server/server.ts` | `connectNeo4j()` called on startup |
| `server/app.ts` | Neo4j router mounted at `/api/v1/neo4j` |
| `server/controllers/user.controller.ts` | `createUserNode()` on account activation |
| `server/services/course.service.ts` | `createCourseNode()` on course creation |
| `server/controllers/course.controller.ts` | `updateCourseNode()` on edit, `deleteCourseNode()` on delete |
| `server/controllers/order.controller.ts` | `createEnrollmentRelation()` on purchase/webhook |

### Frontend Integration Files
| File | Role |
|---|---|
| `client/.env` | Base URL of the backend |
| `client/redux/features/store.ts` | Redux store, auto-loads user on startup |
| `client/redux/features/api/apiSlice.ts` | Base API config, refresh token, load user |
| `client/redux/features/auth/authSlice.ts` | Auth state (token, user object) |
| `client/redux/features/auth/authApi.ts` | Login, register, logout, activation |
| `client/redux/features/courses/coursesApi.ts` | All course CRUD + Q&A + reviews |
| `client/redux/features/orders/ordersApi.ts` | Payment, checkout, order history |
| `client/redux/features/user/userApi.ts` | Profile, admin user management |
| `client/redux/features/analytics/analyticsApi.ts` | Admin charts |
| `client/redux/features/notifications/notificationsApi.ts` | Admin notifications |
| `client/redux/features/layout/layoutApi.ts` | Homepage CMS content |

---

## ONE-LINE ANSWERS FOR VIVA

**"How does Neo4j connect to the server?"**
`connectNeo4j()` in `server/utils/neo4j.ts` is called inside the `server.listen()` callback in `server.ts` — it runs once on startup alongside `connectDB()` for MongoDB.

**"How does the frontend know where the backend is?"**
The `NEXT_PUBLIC_SERVER_URI` environment variable in `client/.env` is set to `http://localhost:8000/api/v1/` and used as the `baseUrl` in `apiSlice.ts`.

**"What happens if Neo4j fails?"**
The `catch` block in `connectNeo4j()` logs the error but does NOT throw. The server keeps running. All Neo4j service functions also have try-catch — they log errors and return empty arrays/null rather than crashing. The app degrades gracefully.

**"How are users authenticated across the frontend and backend?"**
JWT access tokens are stored in HTTP-only cookies set by the backend. All frontend API calls use `credentials: "include"` which sends those cookies automatically. The backend auth middleware reads the cookie and identifies the user.

**"How do you prevent duplicate enrollments in the graph?"**
The Cypher uses `MERGE` instead of `CREATE` for the `ENROLLED_IN` relationship. `MERGE` means "create only if it doesn't already exist" — running it twice produces exactly one relationship.

**"Why are course IDs from Neo4j and MongoDB the same?"**
When a course is created in MongoDB, its `_id` (ObjectId as string) is immediately passed to `createCourseNode()` and stored as the `id` property on the Neo4j Course node. Same for users. The MongoDB `_id` is the shared foreign key between the two databases.

**"How does the recommendation endpoint combine two databases?"**
The controller calls Neo4j first to get a ranked list of course IDs, then calls `CourseModel.find({ _id: { $in: recommendedIds } })` in MongoDB to get the full course documents. Neo4j provides the intelligence; MongoDB provides the data.
