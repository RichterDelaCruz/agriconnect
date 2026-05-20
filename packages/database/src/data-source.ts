import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Distributor } from './entities/distributor.entity';
import { Farmer } from './entities/farmer.entity';
import { Product } from './entities/product.entity';
import { Request } from './entities/request.entity';
import { RequestItem } from './entities/request-item.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_NAME ?? 'agriconnect',
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
  entities: [Distributor, Farmer, Product, Request, RequestItem],
  migrations: [__dirname + '/migrations/**/*.{ts,js}'],
  subscribers: [],
});
