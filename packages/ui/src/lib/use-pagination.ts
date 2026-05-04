import * as React from "react"

export interface UsePaginationOptions {
  defaultPageSize?: number
  /** Reset to page 1 whenever the input array's length changes. Default true. */
  resetOnLengthChange?: boolean
}

export interface UsePaginationResult<T> {
  page: number
  pageSize: number
  totalPages: number
  totalItems: number
  setPage: (page: number) => void
  setPageSize: (size: number) => void
  /** The slice of `items` for the current page. */
  pageItems: T[]
  /** 1-based first item index on the current page (for "Showing X to Y" copy). */
  pageStart: number
  /** 1-based last item index on the current page. */
  pageEnd: number
}

/**
 * Client-side pagination over an in-memory array. Pair with
 * `<Pagination>` for the controls and `<PaginationInfo>` for the
 * "Showing X to Y of Z" line.
 *
 * For lists that grow past a few hundred items this should move
 * server-side — see the deferred ticket in UI-GUIDE.md. The hook's
 * shape is API-compatible with what a server-paged version would
 * return, so the swap is mechanical.
 */
export function usePagination<T>(
  items: readonly T[],
  options: UsePaginationOptions = {},
): UsePaginationResult<T> {
  const { defaultPageSize = 25, resetOnLengthChange = true } = options
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(defaultPageSize)

  // Reset to page 1 when the list shrinks past where we are, or whenever
  // the length changes (configurable). Avoids the empty-page-after-delete
  // foot-gun.
  const lengthRef = React.useRef(items.length)
  React.useEffect(() => {
    if (!resetOnLengthChange) return
    if (lengthRef.current !== items.length) {
      lengthRef.current = items.length
      setPage(1)
    }
  }, [items.length, resetOnLengthChange])

  const totalItems = items.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const pageStart = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1
  const pageEnd = Math.min(safePage * pageSize, totalItems)
  const pageItems = React.useMemo(
    () => items.slice(pageStart === 0 ? 0 : pageStart - 1, pageEnd),
    [items, pageStart, pageEnd],
  )

  const setPageSizeStable = React.useCallback((size: number) => {
    setPageSize(size)
    setPage(1)
  }, [])

  return {
    page: safePage,
    pageSize,
    totalPages,
    totalItems,
    setPage,
    setPageSize: setPageSizeStable,
    pageItems,
    pageStart,
    pageEnd,
  }
}
