"use client";
/**
 * The list of fault reports on a page: one page at a time from the server,
 * with the filter applied there. Used by the resident's, the technician's
 * and the administrator's page.
 */
import { useCallback, useEffect, useState } from "react";
import { EMPTY_SUMMARY } from "./report-list";
import { fetchReportCounts, fetchReportPage, type Report, type ReportCounts, type ReportListFilter } from "./reports";

const LOAD_ERROR = "The reports could not be loaded. Please refresh the page.";

export function useReportList(enabled: boolean, filter: ReportListFilter) {
  // The filter as text: the list is read again only when the filter really changes.
  const key = JSON.stringify(filter);
  const [list, setList] = useState<{ key: string | null; reports: Report[]; nextCursor: string | null }>({ key: null, reports: [], nextCursor: null });
  const [summary, setSummary] = useState<ReportCounts>(EMPTY_SUMMARY);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    fetchReportPage(JSON.parse(key) as ReportListFilter, null)
      .then((page) => {
        if (!active) return;
        setList({ key, reports: page.reports, nextCursor: page.nextCursor });
        if (page.summary) setSummary(page.summary);
        setError("");
      })
      .catch(() => active && setError(LOAD_ERROR));
    return () => {
      active = false;
    };
  }, [enabled, key, version]);

  const refreshCounts = useCallback(() => {
    fetchReportCounts().then(setSummary).catch(() => {});
  }, []);

  /** Append the next page. */
  const loadMore = useCallback(async () => {
    if (!list.nextCursor || list.key === null) return;
    setLoadingMore(true);
    try {
      const page = await fetchReportPage(JSON.parse(list.key) as ReportListFilter, list.nextCursor);
      setList((current) => (current.key === list.key ? { ...current, reports: [...current.reports, ...page.reports], nextCursor: page.nextCursor } : current));
    } catch {
      setError(LOAD_ERROR);
    } finally {
      setLoadingMore(false);
    }
  }, [list.key, list.nextCursor]);

  /** Put a changed report in the place of its older copy, and read the counts again. */
  const replace = useCallback(
    (updated: Report) => {
      setList((current) => ({ ...current, reports: current.reports.map((r) => (r.id === updated.id ? updated : r)) }));
      refreshCounts();
    },
    [refreshCounts],
  );

  /** Read the first page again, for example after a new report was submitted. */
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  return {
    reports: list.reports,
    summary,
    nextCursor: list.nextCursor,
    /** True until the first page has arrived. */
    loading: enabled && list.key === null && !error,
    loadingMore,
    error,
    loadMore,
    replace,
    reload,
  };
}
