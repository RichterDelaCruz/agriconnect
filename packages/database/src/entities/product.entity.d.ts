import { Farmer } from './farmer.entity';
import { RequestItem } from './request-item.entity';
export declare class Product {
    id: string;
    farmerId: string;
    farmer: Farmer;
    name: string;
    price: number;
    stockQuantity: number;
    imageUrl: string | null;
    requestItems: RequestItem[];
}
//# sourceMappingURL=product.entity.d.ts.map