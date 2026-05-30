import { Router } from "express";
import {
  getBooks,
  getBookDetails,
  getFilterOptions,
  getLibraries,
  getNewBookCount,
  getSearchSuggestions,
  getSeriesDetail,
  triggerScan,
  stopScan,
  getCover,
} from "../controllers/libraryController";
import { authenticate, authorizeAdmin } from "../middleware/authMiddleware";

const router = Router();

router.get("/", authenticate, getBooks);
router.get("/libraries", authenticate, getLibraries);
router.get("/filters", authenticate, getFilterOptions);
router.get("/new-count", authenticate, getNewBookCount);
router.get("/search/suggestions", authenticate, getSearchSuggestions);
router.get("/series/:seriesId", authenticate, getSeriesDetail);
router.get("/cover/:name", getCover);
router.get("/:id", authenticate, getBookDetails);
router.post("/scan", authenticate, authorizeAdmin, triggerScan);
router.post("/scan/stop", authenticate, authorizeAdmin, stopScan);

export default router;
