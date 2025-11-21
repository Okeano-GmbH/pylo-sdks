export const paginationDataStr = `pagination {
  current_page
  has_more_pages
  per_page
  total
  last_page
}
`;

export interface PaginationData {
  current_page: number;
  has_more_pages: boolean;
  per_page: number;
  total: number;
  last_page: number;
}
