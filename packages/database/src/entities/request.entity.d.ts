import { Distributor } from './distributor.entity';
import { Farmer } from './farmer.entity';
import { RequestItem } from './request-item.entity';
export declare enum RequestStatus {
    PENDING = "PENDING",
    ACCEPTED = "ACCEPTED",
    REJECTED = "REJECTED"
}
export declare class Request {
    id: string;
    distributorId: string;
    distributor: Distributor;
    farmerId: string;
    farmer: Farmer;
    status: RequestStatus;
    createdAt: Date;
    items: RequestItem[];
}
//# sourceMappingURL=request.entity.d.ts.map