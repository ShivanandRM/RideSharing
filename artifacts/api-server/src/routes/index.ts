import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import ridesRouter from "./rides";
import driversRouter from "./drivers";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(ridesRouter);
router.use(driversRouter);
router.use(adminRouter);

export default router;
