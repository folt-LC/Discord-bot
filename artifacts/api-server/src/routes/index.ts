import { Router, type IRouter } from "express";
import healthRouter from "./health";
import botControlRouter from "./bot-control";

const router: IRouter = Router();

router.use(healthRouter);
router.use(botControlRouter);

export default router;
