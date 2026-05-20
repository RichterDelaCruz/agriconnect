import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Farmer } from './farmer.entity';
import { RequestItem } from './request-item.entity';

@Entity('product')
@Index('idx_product_farmer_price', ['farmer', 'price'])
@Index('idx_active_products', { synchronize: false })
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  farmerId: string;

  @ManyToOne(() => Farmer, (farmer) => farmer.products, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'farmerId' })
  farmer: Farmer;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  price: number;

  @Column({ type: 'int', default: 0 })
  stockQuantity: number;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  imageUrl: string | null;

  @OneToMany(() => RequestItem, (item) => item.product)
  requestItems: RequestItem[];
}
