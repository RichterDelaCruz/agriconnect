export interface PaginationQueryDto {
  limit?: number;
  cursor?: number;
}

export interface PaginatedResponseDto<T> {
  data: T[];
  nextCursor: number | null;
  hasNextPage: boolean;
}
