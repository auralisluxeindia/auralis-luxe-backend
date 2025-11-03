import express from 'express';
import multer from 'multer';
import {
  createCategory,
  getCategories,
  updateCategory,
  deleteCategory,

  createProduct,
  listProducts,
  getProductBySlug,
  updateProduct,
  deleteProduct,
  getUserDetails,
  uploadCategoryImage,
  searchProducts
} from '../controllers/productController.js';
import { authenticate, authorizePermission } from '../middlewares/authMiddleware.js'; 

const router = express.Router();
const upload = multer();

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

router.post("/upload-category-image", authenticate, authorizePermission('create_categories'), uploadCategoryImage);

router.get('/', listProducts); // query: ?page=1&limit=12&sort=price_asc&q=ring&category=necklaces
router.get('/:slug', getProductBySlug);

router.post(
  '/',
  authenticate,
  authorizePermission('create_products'),
  upload.array('images', 8),
  createProduct
);

router.put(
  '/:id',
  authenticate,
  authorizePermission('edit_products'),
  upload.array('images', 8),
  updateProduct
);

router.delete(
  '/:id',
  authenticate,
  authorizePermission('delete_products'),
  deleteProduct
);

router.get('/search', searchProducts);

router.get('/user-details', authenticate, getUserDetails);

export default router;