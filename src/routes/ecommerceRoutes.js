import express from 'express';
import { authenticate, authorizeRole } from '../middlewares/authMiddleware.js';
import {
  addToWishlist, removeFromWishlist, getWishlist,
  addToCart, updateCartItem, removeCartItem, getCart,
  createOrderFromCart, getUserOrders, getOrderDetails, listAllOrders,
  recordProductView
} from '../controllers/productController.js';

const router = express.Router();

router.post('/wishlist', authenticate, addToWishlist);
router.delete('/wishlist', authenticate, removeFromWishlist);
router.get('/wishlist', authenticate, getWishlist);
router.post('/cart', authenticate, addToCart);
router.put('/cart', authenticate, updateCartItem);
router.delete('/cart', authenticate, removeCartItem);
router.get('/cart', authenticate, getCart);
router.post('/orders', authenticate, createOrderFromCart);
router.get('/orders', authenticate, getUserOrders);
router.get('/orders/:id', authenticate, getOrderDetails);

router.get('/admin/orders', authenticate, authorizeRole(['super_admin','admin']), listAllOrders);

router.post('/product/view', recordProductView);

export default router;