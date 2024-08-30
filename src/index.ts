import { Hono } from "hono";
import { PrismaClient } from "@prisma/client/edge";
import { withAccelerate } from "@prisma/extension-accelerate";
import { z } from "zod";
import { decode, sign, verify } from "hono/jwt";
import { createMiddleware } from "hono/factory";

const app = new Hono<{
  Bindings: {
    DATABASE_URL: string;
  };
}>();

const userSchemaSignUp = z.object({
  name: z.string().min(3, { message: "name should have length of atleast 3" }),
  email: z.string().email({ message: "invalid email" }),
  password: z
    .string()
    .min(6, { message: "password should have length of atleast 6" }),
});

const userSchemaSignIn = z.object({
  email: z.string().email({ message: "invalid email" }),
  password: z
    .string()
    .min(6, { message: "password should have length of atleast 6" }),
});

const blogPostSchema = z.object({
  title: z.string().min(3, { message: "length of title should be atleast 3" }),
  userId: z.number(),
  body: z.string().min(3),
  tags: z.array(z.string()),
});

const updateBlogPostSchema = z.object({
  title: z
    .string()
    .min(3, { message: "length of title should be atleast 3" })
    .optional(),
  body: z.string().min(3).optional(),
  tags: z.array(z.string()).optional(),
});

enum Status {
  success = 200,
  fail = 500,
  notfound = 404,
  badrequest = 400,
}
const JWT_SECRET = "1234";

const userMiddleware = createMiddleware(async (c, next) => {
  const token = c.req.header("Authorization");
  if (!token) {
    return c.json({ message: "authentication failed" }, Status.fail);
  }
  try {
    const verifyToken = await verify(token, JWT_SECRET);
    if (!verifyToken) {
      return c.json({ message: "invalid token" }, Status.fail);
    }
    c.set("userId", verifyToken.userId);
    await next();
  } catch (error) {}
});

app.get("/", async (c) => {
  return c.json({ message: "hello world" });
});

app.post("/signup", async (c) => {
  const prisma = new PrismaClient({
    datasourceUrl: c.env?.DATABASE_URL,
  }).$extends(withAccelerate());

  const body = await c.req.json();
  const { success } = userSchemaSignUp.safeParse(body);
  if (!success) {
    return c.json({ message: "Invalid inputs" }, Status.badrequest);
  }
  const { name, email, password } = body;
  const existingUser = await prisma.user.findFirst({
    where: {
      email: email,
    },
  });
  if (existingUser) {
    return c.json({ message: "User already exists" }, Status.fail);
  }
  try {
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password,
      },
    });
    const token = await sign({ userId: user.id }, JWT_SECRET);
    return c.json(
      { token, message: "User created successfully" },
      Status.success
    );
  } catch (error) {
    return c.json({ message: "Failed to create user" }, Status.fail);
  }
});

app.post("/signin", async (c) => {
  const prisma = new PrismaClient({
    datasourceUrl: c.env?.DATABASE_URL,
  }).$extends(withAccelerate());
  const body = await c.req.json();
  const { success } = userSchemaSignIn.safeParse(body);
  if (!success) {
    return c.json({ message: "Invalid inputs" }, Status.badrequest);
  }
  const { email, password } = body;

  try {
    const user = await prisma.user.findFirst({
      where: {
        email,
        password,
      },
    });
    if (!user) {
      return c.json({ message: "Invalid email or password" }, Status.fail);
    }
    const token = await sign({ userId: user.id }, JWT_SECRET);
    return c.json(
      { token, message: "User logedIn successfully" },
      Status.success
    );
  } catch (error) {
    return c.json({ message: "Failed to signin user" }, Status.fail);
  }
});

app.get("/posts", userMiddleware, async (c) => {
  const prisma = new PrismaClient({
    datasourceUrl: c.env?.DATABASE_URL,
  }).$extends(withAccelerate());

  try {
    const blogPosts = await prisma.blog.findMany({
      include: {
        tag: true,
      },
    });
    return c.json(blogPosts, Status.success);
  } catch (error) {
    return c.json(
      { message: "Internal server error cannot fetch Posts right now" },
      Status.fail
    );
  }
});

app.post("/posts", userMiddleware, async (c) => {
  const prisma = new PrismaClient({
    datasourceUrl: c.env?.DATABASE_URL,
  }).$extends(withAccelerate());

  const formBody = await c.req.json();
  const { success } = blogPostSchema.safeParse(formBody);
  if (!success) {
    return c.json(
      { message: "please fill all the fields successfully" },
      Status.badrequest
    );
  }
  const { userId, title, body, tags } = formBody;
  try {
    const transactionResult = await prisma.$transaction(async (prisma) => {
      const blog = await prisma.blog.create({
        data: {
          userId,
          title,
          body,
          tag: {
            create: {
              tag: tags,
            },
          },
        },
        include: {
          tag: true,
        },
      });

      return { blog };
    });
    return c.json(
      {
        transactionResult,
      },
      Status.success
    );
  } catch (error) {
    return c.json(
      {
        message: "Failed to create a blogPost",
      },
      Status.fail
    );
  }
});

app.get("/posts/:id", userMiddleware, async (c) => {
  const prisma = new PrismaClient({
    datasourceUrl: c.env?.DATABASE_URL,
  }).$extends(withAccelerate());

  const postId = parseInt(c.req.param("id"));
  if (!postId) {
    return c.json(
      {
        message: "Please provide a valid id",
      },
      Status.badrequest
    );
  }
  try {
    const blog = await prisma.blog.findUnique({
      where: {
        id: postId,
      },
      include: {
        tag: true,
      },
    });
    if (!blog) {
      return c.json(
        {
          message: "Blog not found",
        },
        Status.notfound
      );
    }
    return c.json(blog, Status.success);
  } catch (error) {
    return c.json(
      {
        message: "internal Serever Error",
      },
      Status.fail
    );
  }
});

app.put("/posts/:id", userMiddleware, async (c) => {
  const prisma = new PrismaClient({
    datasourceUrl: c.env?.DATABASE_URL,
  }).$extends(withAccelerate());

  const formBody = await c.req.json();
  const { success } = updateBlogPostSchema.safeParse(formBody);
  if (!success) {
    return c.json(
      {
        messge: "could not Update Blod",
      },
      Status.badrequest
    );
  }

  const postId = parseInt(c.req.param("id"));
  const { title, body, tags } = formBody;
  if (!postId) {
    return c.json(
      {
        message: "Please provide a valid id",
      },
      Status.badrequest
    );
  }

  try {
    const blogPost = await prisma.blog.findUnique({
      where: { id: postId },
      include: {
        tag: true,
      },
    });
    if (!blogPost) {
      return c.json(
        {
          message: "Blog post not found",
        },
        Status.notfound
      );
    }
    const blogTags = blogPost.tag
    const tagss = blogTags.map(value=>{return value.id})

    const updateBlogTransaction = await prisma.$transaction(async()=>{
      
      const blogTag = await prisma.tags.update({
        where: { id: tagss[0] },
        data: {tag:tags}
      })
      const blog = await prisma.blog.update({
        where: { id: postId },
        data: {
          title,
          body,
        },
        include:{
          tag:true
        }
      });
      return {blog}
    })
    
    return c.json(updateBlogTransaction, Status.success);
  } catch (error) {
    return c.json(
      {
        message: "internal Serever Error",
      },
      Status.fail
    );
  }
});

app.delete("/posts/:id", userMiddleware, async (c) => {
  const prisma = new PrismaClient({
    datasourceUrl: c.env?.DATABASE_URL,
  }).$extends(withAccelerate());

  const postId = parseInt(c.req.param("id"));
  if (!postId) {
    return c.json(
      {
        message: "Please provide a valid id",
      },
      Status.badrequest
    );
  }

  try {
    const blog = await prisma.blog.delete({
      where: { id: postId },
    });
    return c.json(
      {
        message: "blog post deleted successfully",
      },
      Status.success
    );
  } catch (error) {
    return c.json(
      {
        message: "internal Serever Error",
      },
      Status.fail
    );
  }
});

export default app;
