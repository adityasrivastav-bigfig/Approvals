import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, Clock, Loader2, Moon, RefreshCw, Search, Send, Sun, X } from 'lucide-react';

const FETCH_URL = 'https://n.lovenspire.com/webhook/de9ca73d-8790-4e92-8ae2-3773ed3ca2fa';
const UPDATE_URL = 'https://n.lovenspire.com/webhook/8f3d1499-4d62-4a86-8e74-c06440d9c675';

const SYNC_INTERVAL_MINUTES = 2;
const SYNC_INTERVAL_MS = SYNC_INTERVAL_MINUTES * 60 * 1000;

const STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVE', label: 'Approve' },
  { value: 'REJECT', label: 'Reject' },
  { value: 'ERROR', label: 'Needs review' },
  { value: 'STATUS', label: 'Status' },
  { value: 'DONE', label: 'Done' },
];

const STATUS_ALIASES = {
  APPROVED: 'APPROVE',
  APPROVE: 'APPROVE',
  REJECTED: 'REJECT',
  REJECT: 'REJECT',
  ERROR: 'ERROR',
  DONE: 'DONE',
  PENDING: 'PENDING',
  STATUS: 'STATUS',
};

const STATUS_STYLES = {
  PENDING: { bg: '#FFF7E0', text: '#9A5B00', border: '#F4C04A' },
  APPROVE: { bg: '#E7F8EE', text: '#166534', border: '#7AD49A' },
  REJECT: { bg: '#FFE4E6', text: '#9F1239', border: '#FDA4AF' },
  ERROR: { bg: '#FDE8E8', text: '#A11A1A', border: '#F0A1A1' },
  DONE: { bg: '#E8F3FF', text: '#1D4E89', border: '#9EC9F5' },
  STATUS: { bg: '#EEF2F7', text: '#4B5563', border: '#CBD5E1' },
};

function normalizeStatus(status, fallback = 'PENDING') {
  const value = (status ?? '').toString().trim().toUpperCase();
  if (!value) return fallback;
  return STATUS_ALIASES[value] || value;
}

function statusStyle(status) {
  return STATUS_STYLES[normalizeStatus(status)] || STATUS_STYLES.PENDING;
}

function isEmptyValue(value) {
  return value === null || value === undefined || value === '';
}

function formatCellValue(value) {
  if (isEmptyValue(value)) {
    return { text: '', title: '' };
  }

  const raw =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : JSON.stringify(value);

  const compact = raw.replace(/\s+/g, ' ').trim();
  return {
    text: compact.length > 120 ? `${compact.slice(0, 117)}...` : compact,
    title: compact,
  };
}

function formatCountdown(ms) {
  if (ms <= 0) return '0:00';
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function isNumericColumn(rows, col) {
  const vals = rows.map((r) => r[col]).filter((v) => !isEmptyValue(v));
  if (vals.length === 0) return false;
  return vals.every((v) => !Number.isNaN(Number(v)));
}

function rowSearchText(row, columns) {
  return columns
    .map((col) => {
      const value = row[col];
      if (isEmptyValue(value)) return '';
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
      }
      return JSON.stringify(value);
    })
    .join(' ')
    .toLowerCase();
}

function getColumnFill(rows, col) {
  const filled = rows.filter((row) => !isEmptyValue(row[col])).length;
  return rows.length === 0 ? 0 : filled / rows.length;
}

function isIdColumn(col) {
  return col.toLowerCase() === 'id';
}

function hasMeaningfulDisplayData(row, columns, statusField) {
  return columns.some((col) => col !== statusField && !isIdColumn(col) && !isEmptyValue(row[col]));
}

export default function ApprovalsUI() {
  const [rows, setRows] = useState([]);
  const [columns, setColumns] = useState([]);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rowState, setRowState] = useState({});
  const [syncing, setSyncing] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [msUntilSync, setMsUntilSync] = useState(SYNC_INTERVAL_MS);
  const [darkMode, setDarkMode] = useState(false);

  const pendingRef = useRef({});
  const nextSyncAtRef = useRef(0);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (FETCH_URL.includes('your-backend.example.com')) {
        const mock = Array.from({ length: 200 }, (_, i) => ({
          id: i + 1,
          name: `User ${i + 1}`,
          email: `user${i + 1}@example.com`,
          city: i % 4 === 0 ? '' : ['Mumbai', 'Delhi', 'Bengaluru', 'Pune'][i % 4],
          amount: (Math.random() * 1000).toFixed(2),
          status: ['PENDING', 'APPROVED', 'REJECTED', 'DONE'][i % 4],
        }));
        setRows(mock);
        setColumns(Object.keys(mock[0] || {}));
        setPage(0);
        return;
      }

      const res = await fetch(FETCH_URL);
      if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : data.rows || data.data || [];
      if (!Array.isArray(list)) throw new Error('Unexpected response shape from backend');
      setRows(list);
      setColumns(list.length > 0 ? Object.keys(list[0]) : []);
      setPage(0);
    } catch (e) {
      setError(`Could not load data (${e.message})`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    nextSyncAtRef.current = Date.now() + SYNC_INTERVAL_MS;
    const timer = setTimeout(() => {
      void loadData();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadData]);

  const statusField = useMemo(
    () => columns.find((c) => c.toLowerCase() === 'status') || 'status',
    [columns]
  );

  const baseColumns = useMemo(() => {
    return columns.filter((col) => col !== statusField && getColumnFill(rows, col) > 0);
  }, [columns, rows, statusField]);

  const numericCols = useMemo(
    () => new Set(baseColumns.filter((col) => isNumericColumn(rows, col))),
    [rows, baseColumns]
  );

  const rowKey = (row, idx) => row.id ?? row.email ?? row.Email ?? String(idx);

  const filteredRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return rows.filter((row) => {
      if (!hasMeaningfulDisplayData(row, columns, statusField)) return false;
      const status = normalizeStatus(row[statusField], '');
      const matchesStatus = filterStatus === 'ALL' ? true : status === filterStatus;
      if (!matchesStatus) return false;
      if (!term) return true;
      return rowSearchText(row, [statusField, ...baseColumns]).includes(term);
    });
  }, [rows, columns, statusField, filterStatus, searchTerm, baseColumns]);

  const orderedRows = useMemo(() => {
    const order = { PENDING: 0, APPROVE: 1, REJECT: 2, ERROR: 3, DONE: 4, STATUS: 5 };
    return [...filteredRows].sort((a, b) => {
      const sa = normalizeStatus(a[statusField]);
      const sb = normalizeStatus(b[statusField]);
      return (order[sa] ?? 99) - (order[sb] ?? 99);
    });
  }, [filteredRows, statusField]);

  const totalPages = Math.max(1, Math.ceil(orderedRows.length / pageSize));
  const displayedRows = useMemo(() => {
    const start = page * pageSize;
    return orderedRows.slice(start, start + pageSize);
  }, [orderedRows, page, pageSize]);

  const visibleColumns = useMemo(() => {
    const sourceRows = displayedRows.length > 0 ? displayedRows : orderedRows;
    return baseColumns.filter((col) => getColumnFill(sourceRows, col) > 0);
  }, [baseColumns, displayedRows, orderedRows]);

  const summary = useMemo(() => {
    const counts = { total: rows.length, pending: 0, approve: 0, reject: 0, error: 0, done: 0, status: 0 };
    rows.forEach((row) => {
      const s = normalizeStatus(row[statusField], '');
      if (!s) return;
      if (s === 'PENDING') counts.pending += 1;
      else if (s === 'APPROVE') counts.approve += 1;
      else if (s === 'REJECT') counts.reject += 1;
      else if (s === 'ERROR') counts.error += 1;
      else if (s === 'DONE') counts.done += 1;
      else if (s === 'STATUS') counts.status += 1;
    });
    return counts;
  }, [rows, statusField]);

  const quickSearchHint = useMemo(() => {
    const sample = baseColumns.filter((c) => !numericCols.has(c)).slice(0, 3);
    return sample.length > 0 ? sample.join(', ') : 'any visible field';
  }, [baseColumns, numericCols]);

  const queueStatusChange = (row, idx, newStatus) => {
    const key = rowKey(row, idx);
    const updatedRow = { ...row, [statusField]: newStatus };
    setRows((prev) => prev.map((item, i) => (rowKey(item, i) === key ? updatedRow : item)));
    const wasQueued = Object.prototype.hasOwnProperty.call(pendingRef.current, key);
    pendingRef.current[key] = updatedRow;
    if (!wasQueued) setQueuedCount((count) => count + 1);
    setRowState((prev) => ({ ...prev, [key]: 'queued' }));
  };

  const flushQueue = useCallback(async () => {
    const pending = pendingRef.current;
    const keys = Object.keys(pending);
    nextSyncAtRef.current = Date.now() + SYNC_INTERVAL_MS;
    if (keys.length === 0) return;

    const batch = keys.map((k) => pending[k]);
    setSyncing(true);
    setRowState((prev) => {
      const next = { ...prev };
      keys.forEach((k) => (next[k] = 'syncing'));
      return next;
    });

    try {
      const res = await fetch(UPDATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: batch }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);

      keys.forEach((k) => delete pendingRef.current[k]);
      setQueuedCount(Object.keys(pendingRef.current).length);
      setRowState((prev) => {
        const next = { ...prev };
        keys.forEach((k) => (next[k] = 'synced'));
        return next;
      });
      setTimeout(() => {
        setRowState((prev) => {
          const next = { ...prev };
          keys.forEach((k) => delete next[k]);
          return next;
        });
      }, 1500);
    } catch (e) {
      setError(`Sync failed (${e.message}). Will retry at the next interval.`);
      setRowState((prev) => {
        const next = { ...prev };
        keys.forEach((k) => (next[k] = 'error'));
        return next;
      });
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(flushQueue, SYNC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [flushQueue]);

  useEffect(() => {
    const tick = setInterval(() => {
      setMsUntilSync(Math.max(0, nextSyncAtRef.current - Date.now()));
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  const clearFilters = () => {
    setSearchTerm('');
    setFilterStatus('ALL');
    setPage(0);
  };

  const showPendingOnly = () => {
    setFilterStatus('PENDING');
    setPage(0);
  };

  return (
    <div className={`approvals-page ${darkMode ? 'approval-dark' : ''} min-h-screen bg-[#F5F7FB] text-slate-900`}>
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="approval-hero mb-5 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="approval-hero-strip h-2 bg-[linear-gradient(90deg,#0F766E_0%,#2563EB_45%,#F59E0B_100%)]" />
          <div className="approval-hero-content flex flex-col gap-4 p-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex rounded-md bg-teal-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-teal-800">
              Approvals dashboard
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Approvals</h1>
            <p className="mt-2 text-sm text-slate-600">
              Search, review, and update records without needing to understand the backend data.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <span>{rows.length} rows</span>
              {queuedCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-amber-900">
                  <Clock size={12} /> {queuedCount} queued | next sync in {formatCountdown(msUntilSync)}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setDarkMode((mode) => !mode)}
              aria-pressed={darkMode}
              title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              className="theme-toggle inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              {darkMode ? <Sun size={14} /> : <Moon size={14} />}
              {darkMode ? 'Light mode' : 'Dark mode'}
            </button>
            <button
              onClick={flushQueue}
              disabled={syncing || queuedCount === 0}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {syncing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Sync now
            </button>
            <button
              onClick={loadData}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Refresh
            </button>
          </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="approval-stats mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <SummaryCard label="Total rows" value={summary.total} tone="slate" />
          <SummaryCard label="Pending" value={summary.pending} tone="amber" />
          <SummaryCard label="Approved" value={summary.approve} tone="emerald" />
          <SummaryCard label="Rejected" value={summary.reject} tone="rose" />
          <SummaryCard label="Needs review" value={summary.error} tone="rose" />
          <SummaryCard label="Done" value={summary.done} tone="sky" />
        </div>

        <div className="approval-filters mb-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="approval-filter-row flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex-1">
              <label className="mb-2 block text-sm font-medium text-slate-700">Find a row</label>
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setPage(0);
                  }}
                  placeholder={`Search by ${quickSearchHint}`}
                  className="w-full rounded-lg border border-slate-200 bg-white py-3 pl-10 pr-10 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                />
                {searchTerm && (
                  <button
                    onClick={() => {
                      setSearchTerm('');
                      setPage(0);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    aria-label="Clear search"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={showPendingOnly}
                className="rounded-lg border border-amber-300 bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-200"
              >
                Review pending
              </button>
              <button
                onClick={clearFilters}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Clear filters
              </button>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Showing {visibleColumns.length} populated fields for the current page.
          </p>
        </div>

        <div className="approval-table-card overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#EAF3F1]">
                  <th className="sticky left-0 z-30 w-36 border-b border-r border-teal-200 bg-teal-800 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-white">
                    Status
                  </th>
                  {visibleColumns.map((col) => (
                    <th
                      key={col}
                      className={`border-b border-r border-teal-100 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-teal-950 ${
                        numericCols.has(col) ? 'text-right' : 'text-left'
                      }`}
                    >
                      {col}
                    </th>
                  ))}
                  <th className="border-b border-slate-200 px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={visibleColumns.length + 2} className="px-4 py-16 text-center text-sm text-slate-400">
                      {loading ? 'Loading...' : 'No rows to show.'}
                    </td>
                  </tr>
                )}

                {rows.length > 0 && displayedRows.length === 0 && (
                  <tr>
                    <td colSpan={visibleColumns.length + 2} className="px-4 py-16 text-center text-sm text-slate-500">
                      No records match the current filters.
                    </td>
                  </tr>
                )}

                {displayedRows.map((row, idx) => {
                  const key = rowKey(row, idx);
                  const currentStatus = normalizeStatus(row[statusField]);
                  const style = statusStyle(currentStatus);
                  const state = rowState[key];

                  return (
                    <tr
                      key={key}
                      className="transition-colors hover:bg-[#F1FAF7]"
                      style={{
                        backgroundColor: state === 'synced' ? '#F0FDF4' : idx % 2 === 0 ? '#FFFFFF' : '#FAFBFD',
                      }}
                    >
                      <td className="sticky left-0 z-20 border-b border-r border-slate-100 bg-inherit px-2 py-2 align-top">
                        <div className="relative w-[118px]">
                          <select
                            value={currentStatus}
                            onChange={(e) => queueStatusChange(row, idx, e.target.value)}
                            style={{
                              backgroundColor: style.bg,
                              color: style.text,
                              borderColor: style.border,
                            }}
                            className="w-full appearance-none rounded-lg border px-3 py-2 text-xs font-semibold shadow-sm outline-none focus:ring-2 focus:ring-teal-200"
                          >
                            {STATUS_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>

                      {visibleColumns.map((col) => {
                        const cell = formatCellValue(row[col]);
                        const empty = cell.text === '';
                        return (
                          <td
                            key={col}
                            title={cell.title}
                            className={`border-b border-r border-slate-100 px-4 py-2 align-top text-slate-700 ${
                              numericCols.has(col) ? 'text-right font-mono tabular-nums' : 'text-left'
                            }`}
                          >
                            {empty ? null : (
                              <div
                                className={`max-w-[260px] truncate leading-5 ${
                                  numericCols.has(col) ? 'ml-auto inline-block text-right' : 'block'
                                }`}
                              >
                                {cell.text}
                              </div>
                            )}
                          </td>
                        );
                      })}

                      <td className="whitespace-nowrap border-b border-slate-100 px-2 py-2 text-center">
                        {state === 'queued' && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700">
                            <Clock size={12} /> queued
                          </span>
                        )}
                        {state === 'syncing' && <Loader2 size={14} className="inline animate-spin text-slate-400" />}
                        {state === 'synced' && <Check size={14} className="inline text-emerald-600" />}
                        {state === 'error' && <AlertCircle size={14} className="inline text-red-600" />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 px-1">
          <StatusSummary
            rows={rows}
            statusField={statusField}
            filterStatus={filterStatus}
            setFilterStatus={(s) => {
              setFilterStatus(s);
              setPage(0);
            }}
          />

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
            >
              Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
            <span className="text-sm text-slate-500">
              Page {page + 1} of {totalPages}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-500">Rows per page:</label>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(0);
              }}
              className="page-size-select rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm"
            >
              {[25, 50, 100, 250].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <span className="text-sm text-slate-400">Showing: {orderedRows.length}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, tone }) {
  const tones = {
    slate: 'border-slate-300 bg-white text-slate-900 shadow-[inset_0_4px_0_#64748B]',
    amber: 'border-amber-300 bg-amber-50 text-amber-950 shadow-[inset_0_4px_0_#F59E0B]',
    emerald: 'border-emerald-300 bg-emerald-50 text-emerald-950 shadow-[inset_0_4px_0_#10B981]',
    rose: 'border-rose-300 bg-rose-50 text-rose-950 shadow-[inset_0_4px_0_#F43F5E]',
    sky: 'border-sky-300 bg-sky-50 text-sky-950 shadow-[inset_0_4px_0_#0EA5E9]',
  };

  return (
    <div className={`rounded-lg border px-4 py-3 ${tones[tone] || tones.slate}`}>
      <div className="text-xs font-semibold uppercase tracking-[0.16em] opacity-70">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function StatusSummary({ rows, statusField, filterStatus, setFilterStatus }) {
  const counts = useMemo(() => {
    const c = { PENDING: 0, APPROVE: 0, REJECT: 0, ERROR: 0, DONE: 0, STATUS: 0 };
    rows.forEach((r) => {
      const s = normalizeStatus(r[statusField], '');
      if (!s) return;
      if (c[s] !== undefined) c[s] += 1;
    });
    return c;
  }, [rows, statusField]);

  const buttons = [
    { key: 'ALL', label: 'All', count: rows.filter((r) => !isEmptyValue(r[statusField])).length },
    { key: 'PENDING', label: 'Pending', count: counts.PENDING },
    { key: 'APPROVE', label: 'Approve', count: counts.APPROVE },
    { key: 'REJECT', label: 'Reject', count: counts.REJECT },
    { key: 'ERROR', label: 'Needs review', count: counts.ERROR },
    { key: 'DONE', label: 'Done', count: counts.DONE },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {buttons.map((b) => (
        <button
          key={b.key}
          onClick={() => setFilterStatus(b.key)}
          className={`rounded-full border px-3 py-2 text-sm shadow-sm transition-all ${
            filterStatus === b.key
              ? 'border-slate-900 bg-slate-900 text-white shadow-md'
              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          {b.label} <span className={filterStatus === b.key ? 'ml-2 text-white/70' : 'ml-2 text-slate-400'}>{b.count}</span>
        </button>
      ))}
    </div>
  );
}
