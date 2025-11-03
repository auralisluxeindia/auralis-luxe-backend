import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { pool } from './config/db.js';
import { createTables } from './models/userModel.js';
import { createProductTables } from './models/productModel.js';
import authRoutes from './routes/authRoutes.js';
import productRoutes from './routes/productRoutes.js';
import ecommerceRoutes from './routes/ecommerceRoutes.js';


dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

createTables();
createProductTables();

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/ecom', ecommerceRoutes);

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Auralis Luxe Backend is running 🚀',
  });
});

app.get('/api/db-test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ connected: true, time: result.rows[0].now });
  } catch (error) {
    console.error(error);
    res.status(500).json({ connected: false, error: error.message });
  }
});

export default app;