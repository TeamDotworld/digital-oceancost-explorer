import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { billingService } from '../services/api';
import { exportRowsToExcel } from '../utils/excelExport';
import ExportButtons from './ExportButtons';
import Footer from './Footer';

const formatCurrency = (amount) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
}).format(amount || 0);

const formatDate = (date) => new Date(date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

// Turn "2024-03" into "Mar 2024"
const formatPeriod = (period) => {
  if (!period) return 'Unknown month';
  const [year, month] = period.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
};

const describePaidFor = (payment) => payment.appliedTo.length === 0
  ? 'Account balance'
  : payment.appliedTo.map(applied => `${formatPeriod(applied.period)} (${formatCurrency(applied.amount)})`).join(', ');

const CardIcon = ({ className = 'w-5 h-5' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="2" y="5" width="20" height="14" rx="2" strokeWidth={2} />
    <path strokeWidth={2} d="M2 10h20" />
  </svg>
);

const Payments = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const reportRef = useRef(null);

  // The selected card and year live in the URL so other pages can link straight to a card's history
  const methodFilter = searchParams.get('method') || 'all';
  const yearFilter = searchParams.get('year') || 'all';

  const updateParam = useCallback((key, value) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (value === 'all') next.delete(key);
      else next.set(key, value);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    const fetchPayments = async () => {
      setLoading(true);
      setError(null);
      try {
        setData(await billingService.getPayments());
      } catch (fetchError) {
        console.error('Error fetching payments:', fetchError);
        setError('Failed to load payment history. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    fetchPayments();
  }, [refreshCounter]);

  const payments = useMemo(() => data?.payments || [], [data]);

  const years = useMemo(() => [...new Set(payments.map(payment => new Date(payment.date).getFullYear()))].sort((a, b) => b - a), [payments]);

  // Year and search apply to the method cards too, so the cards (and the PDF) match the table
  const searched = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return payments
      .filter(payment => yearFilter === 'all' || String(new Date(payment.date).getFullYear()) === yearFilter)
      .filter(payment => {
        if (words.length === 0) return true;
        const text = [payment.method, payment.description, payment.receiptId, formatDate(payment.date), describePaidFor(payment), payment.amount.toFixed(2)]
          .join(' ').toLowerCase();
        return words.every(word => text.includes(word));
      });
  }, [payments, yearFilter, query]);

  const methodTotals = useMemo(() => {
    const totals = {};
    searched.forEach(payment => {
      if (!totals[payment.method]) totals[payment.method] = { total: 0, count: 0, lastUsed: payment.date };
      totals[payment.method].total += payment.amount;
      totals[payment.method].count++;
      if (new Date(payment.date) > new Date(totals[payment.method].lastUsed)) totals[payment.method].lastUsed = payment.date;
    });
    return totals;
  }, [searched]);

  const filtered = useMemo(() => searched.filter(payment =>
    methodFilter === 'all' || payment.method === methodFilter
  ), [searched, methodFilter]);
  
  const searchedTotal = searched.reduce((sum, payment) => sum + payment.amount, 0);

  const filteredTotal = filtered.reduce((sum, payment) => sum + payment.amount, 0);

  // Charges per calendar month for the chart, oldest first
  const chartData = useMemo(() => {
    const byMonth = {};
    filtered.forEach(payment => {
      const date = new Date(payment.date);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      byMonth[key] = (byMonth[key] || 0) + payment.amount;
    });
    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, amount]) => ({ month: formatPeriod(month), amount: Number(amount.toFixed(2)) }));
  }, [filtered]);

  const exportFilename = () => {
    const label = methodFilter === 'all' ? 'all-methods' : methodFilter.replace(/[^\w.-]+/g, '_');
    return `payments_${label}${yearFilter === 'all' ? '' : `_${yearFilter}`}_${new Date().toISOString().slice(0, 10)}`;
  };
  
  const exportExcel = () => exportRowsToExcel(
    'Payments',
    [
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Payment Method', key: 'method', width: 22 },
      { header: 'Type', key: 'type', width: 10 },
      { header: 'Amount (USD)', key: 'amount', width: 14 },
      { header: 'Paid For', key: 'paidFor', width: 40 },
      { header: 'Description', key: 'description', width: 36 },
      { header: 'Receipt', key: 'receiptId', width: 18 }
    ],
    [
      ...filtered.map(payment => ({
        date: new Date(payment.date),
        method: payment.method,
        type: payment.type,
        amount: Number(payment.amount.toFixed(2)),
        paidFor: describePaidFor(payment),
        description: payment.description,
        receiptId: payment.receiptId || ''
      })),
      { date: 'Total', amount: Number(filteredTotal.toFixed(2)) }
    ],
    exportFilename()
  );
  
  const methods = data?.methods || [];
  const selectedMethod = methodFilter === 'all' ? null : methodFilter;

  return (
    <div className="flex flex-col min-h-screen">
      <div ref={reportRef} className="flex-grow w-full min-w-0 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-2">Payments</h1>
            <p className="text-gray-600">Every charge by card or payment method. Click a card to see its full history.</p>
          </div>
          <button
            data-html2canvas-ignore="true"
            onClick={() => setRefreshCounter(count => count + 1)}
            disabled={loading}
            className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors disabled:opacity-50"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {error && <div className="mb-6 p-4 bg-red-100 text-red-700 rounded-md">{error}</div>}

        {loading && !data ? (
          <div className="bg-white rounded-lg shadow-md p-6 flex justify-center items-center h-64">
            <svg className="animate-spin h-10 w-10 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        ) : data ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
              <button
                type="button"
                onClick={() => updateParam('method', 'all')}
                className={`text-left p-4 rounded-lg border-2 bg-white shadow-sm transition-colors ${!selectedMethod ? 'border-blue-500' : 'border-transparent hover:border-gray-300'}`}
              >
                <p className="text-sm text-gray-600 mb-1">All payment methods</p>
                <p className="text-xl sm:text-2xl font-bold text-gray-900">{formatCurrency(searchedTotal)}</p>
                <p className="text-xs text-gray-500 mt-1">{searched.length} charge{searched.length === 1 ? '' : 's'}</p>
              </button>
              {methods.map(method => {
                const totals = methodTotals[method.method];
                const active = selectedMethod === method.method;
                // Cards with no charges in the current year/search are hidden (the selected one always stays)
                if (!totals && !active) return null;
                return (
                  <button
                    key={method.method}
                    type="button"
                    onClick={() => updateParam('method', active ? 'all' : method.method)}
                    className={`text-left p-4 rounded-lg border-2 transition-colors ${method.type === 'Payment' ? 'bg-gradient-to-br from-slate-700 to-slate-900 text-white' : 'bg-green-50 text-green-900'} ${active ? 'border-blue-500 ring-2 ring-blue-200' : 'border-transparent hover:border-gray-300'}`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="font-mono text-sm sm:text-base tracking-wide">{method.method}</span>
                      <CardIcon className="w-5 h-5 opacity-70" />
                    </div>
                    <p className="text-xl sm:text-2xl font-bold">{formatCurrency(totals?.total || 0)}</p>
                    <p className="text-xs opacity-80 mt-1">
                      {totals ? `${totals.count} charge${totals.count === 1 ? '' : 's'} · last ${formatDate(totals.lastUsed)}` : 'No charges match the filters'}
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-6">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 mb-4">
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
                  </svg>
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
                    placeholder="Search amount, month, receipt..."
                    className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    aria-label="Search payments"
                  />
                </div>
                <select
                  aria-label="Filter by year"
                  value={yearFilter}
                  onChange={(e) => updateParam('year', e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-md bg-white text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="all">All years</option>
                  {years.map(year => <option key={year} value={year}>{year}</option>)}
                </select>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-gray-600">
                  <span className="font-semibold text-gray-900">{selectedMethod || 'All payment methods'}</span>
                  {' · '}{filtered.length} charge{filtered.length === 1 ? '' : 's'}
                  {' · '}<span className="font-semibold text-gray-900">{formatCurrency(filteredTotal)}</span>
                  {(selectedMethod || yearFilter !== 'all' || query) && (
                    <button
                      onClick={() => { setQuery(''); setSearchParams({}, { replace: true }); }}
                      className="ml-2 text-blue-600 hover:underline"
                    >
                      Clear filters
                    </button>
                  )}
                </p>
                <ExportButtons
                  onExcel={exportExcel}
                  pdfTarget={reportRef}
                  filename={exportFilename}
                  disabled={filtered.length === 0}
                />
              </div>
            </div>

            {chartData.length > 1 && (
              <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-6">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">Charges per Month</h2>
                <div className="h-56 sm:h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                      <YAxis tickFormatter={(value) => `$${value}`} tick={{ fontSize: 11 }} width={60} />
                      <Tooltip formatter={(value) => [formatCurrency(value), 'Charged']} />
                      <Bar dataKey="amount" fill="#0069ff" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-8">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">Charge History</h2>

              {filtered.length === 0 ? (
                <p className="text-center py-12 text-gray-500">No charges match your filters.</p>
              ) : (
                <>
                  {/* Card list on phones */}
                  <div className="md:hidden divide-y divide-gray-200">
                    {filtered.map((payment, index) => (
                      <div key={`${payment.date}-${index}`} className="py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-gray-900">{formatDate(payment.date)}</p>
                            <button onClick={() => updateParam('method', payment.method)} className="text-sm text-blue-600 hover:underline font-mono">
                              {payment.method}
                            </button>
                          </div>
                          <p className="font-semibold text-gray-900 whitespace-nowrap">{formatCurrency(payment.amount)}</p>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">Paid for: {describePaidFor(payment)}</p>
                      </div>
                    ))}
                  </div>

                  {/* Table on tablets and desktops */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full min-w-[720px] divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                          <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Payment Method</th>
                          <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Paid For</th>
                          <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reference</th>
                          <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {filtered.map((payment, index) => (
                          <tr key={`${payment.date}-${index}`} className="hover:bg-gray-50 align-top">
                            <td className="px-3 py-3 text-sm text-gray-900 whitespace-nowrap">{formatDate(payment.date)}</td>
                            <td className="px-3 py-3 text-sm">
                              <button
                                onClick={() => updateParam('method', payment.method)}
                                className="inline-flex items-center gap-1.5 text-blue-600 hover:underline font-mono"
                                title={`Show only ${payment.method}`}
                              >
                                <CardIcon className="w-4 h-4 text-gray-400" />
                                {payment.method}
                              </button>
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-600">
                              {payment.appliedTo.length === 0 ? (
                                <span className="text-gray-400">Account balance</span>
                              ) : payment.appliedTo.map(applied => (
                                <div key={applied.invoiceUuid}>
                                  {formatPeriod(applied.period)} invoice
                                  {payment.appliedTo.length > 1 && <span className="text-gray-400"> · {formatCurrency(applied.amount)}</span>}
                                </div>
                              ))}
                            </td>
                            <td className="px-3 py-3 text-xs text-gray-500">
                              <div>{payment.description}</div>
                              {payment.receiptId && <div className="font-mono">Receipt {payment.receiptId}</div>}
                            </td>
                            <td className="px-3 py-3 text-sm font-semibold text-gray-900 text-right whitespace-nowrap">{formatCurrency(payment.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-gray-50">
                        <tr>
                          <td colSpan={4} className="px-3 py-3 text-sm font-semibold text-gray-900">Total</td>
                          <td className="px-3 py-3 text-sm font-semibold text-gray-900 text-right">{formatCurrency(filteredTotal)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              )}

              <p className="mt-4 text-xs text-gray-500">
                Card details come from DigitalOcean's billing history (brand and last 4 digits only). "Paid For" matches each payment to the oldest unpaid invoice, as DigitalOcean doesn't link them directly.
              </p>
            </div>
          </>
        ) : null}
      </div>

      <Footer />
    </div>
  );
};

export default Payments;
