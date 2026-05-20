export interface CreateRequestItemDto {
  productId: string;
  quantity: number;
}

export interface CreateRequestDto {
  distributorId: string;
  farmerIds: string[];
  items: CreateRequestItemDto[];
}
