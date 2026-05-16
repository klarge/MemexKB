import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import articlesRouter from "./articles";
import usersRouter from "./users";
import groupsRouter from "./groups";
import adminRouter from "./admin";
import imagesRouter from "./images";
import tokensRouter from "./tokens";
import templatesRouter from "./templates";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(tokensRouter);
router.use(articlesRouter);
router.use(usersRouter);
router.use(groupsRouter);
router.use(adminRouter);
router.use(imagesRouter);
router.use(templatesRouter);

export default router;
