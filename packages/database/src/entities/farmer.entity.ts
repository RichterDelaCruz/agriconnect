import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Product } from './product.entity';
import { Request } from './request.entity';

@Entity('farmer')
@Index('idx_farmer_location', ['location'])
export class Farmer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 255 })
  location: string;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  imageUrl: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => Product, (product) => product.farmer)
  products: Product[];

  @OneToMany(() => Request, (request) => request.farmer)
  requests: Request[];
}
