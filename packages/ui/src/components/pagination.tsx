import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './button';
import { useUiT } from '../lib/i18n.js';

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  showFirstLast?: boolean;
  showPrevNext?: boolean;
  maxVisiblePages?: number;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  showFirstLast = true,
  showPrevNext = true,
  maxVisiblePages = 5,
  className,
  size = 'md'
}: PaginationProps) {
  const { t } = useUiT();
  // Calculate which page numbers to show
  const getVisiblePages = () => {
    if (totalPages <= maxVisiblePages) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    const half = Math.floor(maxVisiblePages / 2);
    let start = Math.max(1, currentPage - half);
    let end = Math.min(totalPages, start + maxVisiblePages - 1);

    if (end - start + 1 < maxVisiblePages) {
      start = Math.max(1, end - maxVisiblePages + 1);
    }

    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  };

  const visiblePages = getVisiblePages();
  const showStartEllipsis = visiblePages[0] > 2;
  const showEndEllipsis = visiblePages[visiblePages.length - 1] < totalPages - 1;

  const buttonSize = {
    sm: 'h-8 w-8 text-xs',
    md: 'h-9 w-9 text-sm',
    lg: 'h-10 w-10 text-base'
  }[size];

  if (totalPages <= 1) {
    return null;
  }

  return (
    <nav
      role="navigation"
      aria-label={t('pagination.navigation')}
      className={cn('flex items-center justify-center space-x-1', className)}
    >
      {/* First page */}
      {showFirstLast && currentPage > 1 && (
        <Button
          variant="outline"
          size="icon"
          className={buttonSize}
          onClick={() => onPageChange(1)}
          aria-label={t('pagination.goToFirstPage')}
        >
          1
        </Button>
      )}

      {/* Previous page */}
      {showPrevNext && (
        <Button
          variant="outline"
          size="icon"
          className={buttonSize}
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          aria-label={t('pagination.goToPreviousPage')}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
      )}

      {/* Start ellipsis */}
      {showStartEllipsis && (
        <Button
          variant="ghost"
          size="icon"
          className={buttonSize}
          disabled
          aria-hidden="true"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      )}

      {/* Page numbers */}
      {visiblePages.map((page) => (
        <Button
          key={page}
          variant={page === currentPage ? "default" : "outline"}
          size="icon"
          className={buttonSize}
          onClick={() => onPageChange(page)}
          aria-label={t('pagination.goToPage', { page })}
          aria-current={page === currentPage ? "page" : undefined}
        >
          {page}
        </Button>
      ))}

      {/* End ellipsis */}
      {showEndEllipsis && (
        <Button
          variant="ghost"
          size="icon"
          className={buttonSize}
          disabled
          aria-hidden="true"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      )}

      {/* Next page */}
      {showPrevNext && (
        <Button
          variant="outline"
          size="icon"
          className={buttonSize}
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          aria-label={t('pagination.goToNextPage')}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      )}

      {/* Last page */}
      {showFirstLast && currentPage < totalPages && (
        <Button
          variant="outline"
          size="icon"
          className={buttonSize}
          onClick={() => onPageChange(totalPages)}
          aria-label={t('pagination.goToLastPage')}
        >
          {totalPages}
        </Button>
      )}
    </nav>
  );
}

export interface PaginationInfoProps {
  currentPage: number;
  pageSize: number;
  totalItems: number;
  className?: string;
}

export function PaginationInfo({
  currentPage,
  pageSize,
  totalItems,
  className
}: PaginationInfoProps) {
  const { t } = useUiT();
  const startItem = Math.min((currentPage - 1) * pageSize + 1, totalItems);
  const endItem = Math.min(currentPage * pageSize, totalItems);

  return (
    <div className={cn('text-sm text-muted-foreground', className)}>
      {t('pagination.showingEntries', { start: startItem, end: endItem, total: totalItems })}
    </div>
  );
}
