import Router from "koa-router";
import auth from "@server/middlewares/authentication";
import validate from "@server/middlewares/validate";
import type { APIContext } from "@server/types";
import * as T from "./schema";

const router = new Router();

router.post(
  "demo.info",
  auth(),
  validate(T.DemoInfoSchema),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;

    ctx.body = {
      data: {
        message: "Hello from demo plugin,",
        teamName: user.team.name,
        userName: user.name,
      },
    };
  }
);

export default router;
