import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Distributor } from './distributor.entity';
import { Farmer } from './farmer.entity';
import { RequestItem } from './request-item.entity';

export enum RequestStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
}

@Entity('request')
@Index('idx_request_farmer', ['farmer'])
@Index('idx_request_distributor', ['distributor'])
export class Request {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  distributorId: string;

  @ManyToOne(() => Distributor, (d) => d.requests, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'distributorId' })
  distributor: Distributor;

  @Column({ type: 'uuid' })
  farmerId: string;

  @ManyToOne(() => Farmer, (f) => f.requests, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'farmerId' })
  farmer: Farmer;

  @Column({
    type: 'enum',
    enum: RequestStatus,
    default: RequestStatus.PENDING,
  })
  status: RequestStatus;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => RequestItem, (item) => item.request, { cascade: true })
  items: RequestItem[];
}
