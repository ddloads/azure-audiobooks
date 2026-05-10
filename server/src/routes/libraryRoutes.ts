import { Router } from "express";
import {
  getBooks,
  getBookDetails,
  getFilterOptions,
  getLibraries,
  getSearchSuggestions,
  triggerScan,
  stopScan,
  getCover,
} from "../controllers/libraryController";
import { authenticate, authorizeAdmin } from "../middleware/authMiddleware";

const router = Router();

router.get("/", authenticate, getBooks);
router.get("/libraries", authenticate, getLibraries);
router.get("/filters", authenticate, getFilterOptions);
router.get("/search/suggestions", authenticate, getSearchSuggestions);
router.get("/cover/:name", getCover); // Allow public access to covers for simplicity in <img> tags
router.get("/:id", authenticate, getBookDetails);
router.post("/scan", authenticate, authorizeAdmin, triggerScan);
router.post("/scan/stop", authenticate, authorizeAdmin, stopScan);

export default router;
