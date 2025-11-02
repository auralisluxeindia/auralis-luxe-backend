import express from 'express';
import {
  createCategory,
  getCategories,
  updateCategory,
  deleteCategory
} from '../controllers/productController.js';
import { authenticate, authorizePermission } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.get('/available-categories', getCategories);

router.post(
  '/available-categories',
  authenticate,
  authorizePermission('create_categories'),
  createCategory
);

router.put(
  '/edit-category/:id',
  authenticate,
  authorizePermission('edit_categories'),
  updateCategory
);

router.delete(
  '/delete-category/:id',
  authenticate,
  authorizePermission('delete_categories'),
  deleteCategory
);

export default router;