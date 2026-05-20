import { Product } from './product.entity';
import { Request } from './request.entity';
export declare class Farmer {
    id: string;
    name: string;
    location: string;
    imageUrl: string | null;
    createdAt: Date;
    products: Product[];
    requests: Request[];
}
//# sourceMappingURL=farmer.entity.d.ts.map