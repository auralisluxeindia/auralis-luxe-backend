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
  searchProducts,
  bulkUploadProducts,
  getTrendingProducts,
  updateUserProfile,
  generateProductReport
} from '../controllers/productController.js';
import { authenticate, authorizePermission } from '../middlewares/authMiddleware.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get('/available-categories', getCategories); // Done
router.post(
  '/available-categories',
  authenticate,
  authorizePermission('create_categories'),
  createCategory
); // Done
router.post(
  "/generate-report",
  authenticate,
  authorizePermission("view_reports"),
  generateProductReport
);
router.put(
  '/edit-category/:id',
  authenticate,
  authorizePermission('edit_categories'),
  updateCategory
); // Done
router.delete(
  '/delete-category/:id',
  authenticate,
  authorizePermission('delete_categories'),
  deleteCategory
); // Done
router.post(
  '/upload-category-image',
  authenticate,
  authorizePermission('create_categories'),
  uploadCategoryImage
); // Done

router.get('/user-details', authenticate, getUserDetails);
router.put('/update-user-details', authenticate, updateUserProfile);

router.get('/trending', getTrendingProducts);
router.get('/search', searchProducts);

router.get('/', listProducts); // Done

router.get('/:slug', getProductBySlug); // Done

router.post(
  '/',
  authenticate,
  authorizePermission('create_products'),
  upload.array('images', 8),
  createProduct
); // Done
router.put(
  '/edit/:id',
  authenticate,
  authorizePermission('edit_products'),
  upload.array('images', 8),
  updateProduct
); // Done
router.delete(
  '/delete/:id',
  authenticate,
  authorizePermission('delete_products'),
  deleteProduct
); // Done

router.post(
  '/bulk-upload',
  authenticate,
  authorizePermission('create_products'),
  upload.single('file'),
  bulkUploadProducts
); // Done

export default router;
