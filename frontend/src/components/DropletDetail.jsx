import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { dropletService } from '../services/api';
import { exportDropletCostsToExcel } from '../utils/dropletExport';
import { exportElementToPdf } from '../utils/pdfExport';
import Footer from './Footer';

const SOURCE_LABELS = {
  invoice: { label: 'Invoiced', className: 'bg-green-100 text-green-800' },
  preview: { label: 'Month to date', className: 'bg-blue-100 text-blue-800' },
  estimate: { label: 'Estimated', className: 'bg-yellow-100 text-yellow-800' }
};

// Only finalized invoices count as invoiced; the current month's running total and estimates do not
const isInvoiced = (cost) => cost.source === 'invoice';

// Split a month's total across the payment methods that paid its invoice
const paidWithFor = (month) => (month.payments || [{ method: 'Unknown', fraction: 1 }])
  .map(payment => ({ method: payment.method, amount: month.amount * payment.fraction }))
  .filter(payment => payment.amount > 0.005);

// Labels that aren't real payment methods get a muted style
const PENDING_METHODS = ['Not yet invoiced', 'Unpaid', 'Unknown'];

// Colors cycle when more droplets are selected than there are colors
const CHART_COLORS = ['#0069ff', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1'];

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
};

// Turn "2024-03" into "Mar 2024"
const formatPeriod = (period) => {
  const [year, month] = period.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC'
  });
};

const SourceBadge = ({ source }) => {
  const { label, className } = SOURCE_LABELS[source];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${className}`}>
      {label}
    </span>
  );
};

const DropletDetail = () => {
  const [searchParams] = useSearchParams();
  const idsParam = searchParams.get('ids') || '';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hiddenIds, setHiddenIds] = useState([]);
  const [fromPeriod, setFromPeriod] = useState('');
  const [toPeriod, setToPeriod] = useState('');
  const [exporting, setExporting] = useState(null);
  const reportRef = useRef(null);

  useEffect(() => {
    const dropletIds = idsParam.split(',').filter(Boolean);

    if (dropletIds.length === 0) {
      setError('No droplets selected.');
      setLoading(false);
      return;
    }

    const fetchMonthlyCosts = async () => {
      setLoading(true);
      setError(null);

      try {
        const result = await dropletService.getMonthlyCosts(dropletIds);
        setData(result);
      } catch (error) {
        console.error('Error fetching droplet cost history:', error);
        setError('Failed to load droplet cost history. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchMonthlyCosts();
  }, [idsParam]);

  // Reset filters whenever a different set of droplets is loaded
  useEffect(() => {
    setHiddenIds([]);
    setFromPeriod('');
    setToPeriod('');
  }, [idsParam]);

  const allPeriods = useMemo(() => (data ? data.monthlyCosts.map(month => month.period) : []), [data]);

  // Keep each droplet's color stable while others are filtered out
  const colorFor = (dropletId) => {
    const index = data ? data.droplets.findIndex(droplet => droplet.id === dropletId) : 0;
    return CHART_COLORS[index % CHART_COLORS.length];
  };

  // Apply the droplet and month-range filters, recomputing all totals
  const view = useMemo(() => {
    if (!data) return null;

    const start = fromPeriod || allPeriods[0];
    const end = toPeriod || allPeriods[allPeriods.length - 1];
    const droplets = data.droplets.filter(droplet => !hiddenIds.includes(droplet.id));
    const visibleIds = droplets.map(droplet => String(droplet.id));

    const monthlyCosts = data.monthlyCosts
      .filter(month => month.period >= start && month.period <= end)
      .map(month => {
        const monthDroplets = Object.fromEntries(
          Object.entries(month.droplets).filter(([id]) => visibleIds.includes(id))
        );
        const costs = Object.values(monthDroplets);
        return {
          ...month,
          droplets: monthDroplets,
          amount: costs.reduce((sum, cost) => sum + cost.amount, 0),
          invoicedAmount: costs.filter(isInvoiced).reduce((sum, cost) => sum + cost.amount, 0)
        };
      })
      .filter(month => Object.keys(month.droplets).length > 0);

    const totalCost = monthlyCosts.reduce((sum, month) => sum + month.amount, 0);
    const invoicedCost = monthlyCosts.reduce((sum, month) => sum + month.invoicedAmount, 0);
    
    return {
      droplets: droplets.map(droplet => {
        const costs = monthlyCosts.map(month => month.droplets[droplet.id]).filter(Boolean);
        const dropletTotal = costs.reduce((sum, cost) => sum + cost.amount, 0);
        const dropletInvoiced = costs.filter(isInvoiced).reduce((sum, cost) => sum + cost.amount, 0);
        return {
          ...droplet,
          totalCost: dropletTotal,
          invoicedCost: dropletInvoiced,
          uninvoicedCost: dropletTotal - dropletInvoiced
        };
      }),
      monthlyCosts: monthlyCosts.map(month => ({
        ...month,
        uninvoicedAmount: month.amount - month.invoicedAmount,
        paidWith: paidWithFor(month)
      })),
      paymentTotals: Object.entries(monthlyCosts.reduce((totals, month) => {
        paidWithFor(month).forEach(payment => {
          totals[payment.method] = (totals[payment.method] || 0) + payment.amount;
        });
        return totals;
      }, {}))
        .map(([method, amount]) => ({ method, amount }))
        .sort((a, b) => b.amount - a.amount),
      totalCost,
      invoicedCost,
      uninvoicedCost: totalCost - invoicedCost,
      start,
      end
    };
  }, [data, hiddenIds, fromPeriod, toPeriod, allPeriods]);

  const isFiltered = hiddenIds.length > 0 || fromPeriod !== '' || toPeriod !== '';

  const toggleDroplet = (dropletId) => {
    setHiddenIds(prev => {
      if (prev.includes(dropletId)) return prev.filter(id => id !== dropletId);
      // Always keep at least one droplet visible
      if (data && prev.length >= data.droplets.length - 1) return prev;
      return [...prev, dropletId];
    });
  };

  const resetFilters = () => {
    setHiddenIds([]);
    setFromPeriod('');
    setToPeriod('');
  };

  const exportFilename = () => {
    const base = view.droplets.length === 1
      ? view.droplets[0].name.replace(/[^\w.-]+/g, '_')
      : `${view.droplets.length}-droplets`;
    return `droplet-costs_${base}_${view.start}_to_${view.end}`;
  };

  const handleExportExcel = async () => {
    setExporting('excel');
    try {
      await exportDropletCostsToExcel({
        droplets: view.droplets,
        months: view.monthlyCosts,
        totalCost: view.totalCost,
        invoicedCost: view.invoicedCost,
        uninvoicedCost: view.uninvoicedCost,
        paymentTotals: view.paymentTotals,
        formatPeriod,
        filename: exportFilename()
      });
    } catch (exportError) {
      console.error('Excel export failed:', exportError);
      alert('Excel export failed. Please try again.');
    } finally {
      setExporting(null);
    }
  };

  const handleExportPdf = async () => {
    setExporting('pdf');
    try {
      await exportElementToPdf(reportRef.current, exportFilename());
    } catch (exportError) {
      console.error('PDF export failed:', exportError);
      alert('PDF export failed. Please try again.');
    } finally {
      setExporting(null);
    }
  };

  const isSingle = view && view.droplets.length === 1;
  const singleDroplet = isSingle ? view.droplets[0] : null;

  // One bar segment per droplet, keyed by droplet ID
  const chartData = view
    ? view.monthlyCosts.map(month => {
        const row = { month: formatPeriod(month.period) };
        view.droplets.forEach(droplet => {
          row[droplet.id] = Number((month.droplets[droplet.id]?.amount || 0).toFixed(2));
        });
        return row;
      })
    : [];

  // Newest month first in the table
  const tableRows = view ? [...view.monthlyCosts].reverse() : [];
  const hasEstimates = view && view.monthlyCosts.some(month =>
    Object.values(month.droplets).some(cost => cost.source === 'estimate')
  );
  const dropletNames = view
    ? Object.fromEntries(view.droplets.map(droplet => [droplet.id, droplet.name]))
    : {};
  const earliestCreated = view
    ? new Date(Math.min(...view.droplets.map(droplet => new Date(droplet.created_at).getTime())))
    : null;
  const currentMonthlyRate = view
    ? view.droplets.reduce((sum, droplet) => sum + droplet.monthly_price, 0)
    : 0;

  return (
    <div className="flex flex-col min-h-screen">
      <div className="flex-grow w-full min-w-0 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <Link to="/droplets" className="text-sm text-blue-600 hover:underline">
          &larr; Back to Droplet Costs
        </Link>

        {loading ? (
          <div className="flex flex-col justify-center items-center h-64">
            <svg className="animate-spin h-10 w-10 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="mt-4 text-sm text-gray-500">Loading cost history from your invoices...</p>
          </div>
        ) : error ? (
          <div className="mt-6 p-4 bg-red-100 text-red-700 rounded-md">{error}</div>
        ) : data ? (
          <div ref={reportRef}>
            <div className="mt-4 mb-8">
              {isSingle ? (
                <>
                  <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-2 break-words">{singleDroplet.name}</h1>
                  <p className="text-gray-600">
                    {singleDroplet.size} &middot; {singleDroplet.regionName} &middot; {singleDroplet.vcpus} vCPU, {singleDroplet.memory / 1024} GB RAM, {singleDroplet.disk} GB disk
                  </p>
                  {singleDroplet.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {singleDroplet.tags.map(tag => (
                        <span key={tag} className="inline-flex items-center px-1 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-2 break-words">{view.droplets.length} Droplets</h1>
                  <p className="text-gray-600">Combined monthly cost history for the selected droplets.</p>
                </>
              )}
              <p className="text-sm text-gray-500 mt-2">
                Period: {formatPeriod(view.start)} &ndash; {formatPeriod(view.end)}
                {isFiltered && <span className="ml-2 text-blue-700">(filtered)</span>}
              </p>
            </div>
            
            <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-6" data-html2canvas-ignore="true">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <h2 className="text-xl font-semibold text-gray-800">Filters</h2>
                <div className="flex flex-wrap gap-2">
                  {isFiltered && (
                    <button
                      onClick={resetFilters}
                      className="px-3 py-1 text-sm text-gray-700 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                    >
                      Reset Filters
                    </button>
                  )}
                  <button
                    onClick={handleExportExcel}
                    disabled={exporting !== null}
                    className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 transition-colors disabled:opacity-50"
                  >
                    {exporting === 'excel' ? 'Exporting...' : 'Export Excel'}
                  </button>
                  <button
                    onClick={handleExportPdf}
                    disabled={exporting !== null}
                    className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition-colors disabled:opacity-50"
                  >
                    {exporting === 'pdf' ? 'Exporting...' : 'Export PDF'}
                  </button>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="from-month" className="block text-sm font-medium text-gray-700 mb-2">From Month</label>
                  <select
                    id="from-month"
                    value={fromPeriod || allPeriods[0]}
                    onChange={(e) => setFromPeriod(e.target.value === allPeriods[0] ? '' : e.target.value)}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  >
                    {allPeriods
                      .filter(period => !toPeriod || period <= toPeriod)
                      .map(period => <option key={period} value={period}>{formatPeriod(period)}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="to-month" className="block text-sm font-medium text-gray-700 mb-2">To Month</label>
                  <select
                    id="to-month"
                    value={toPeriod || allPeriods[allPeriods.length - 1]}
                    onChange={(e) => setToPeriod(e.target.value === allPeriods[allPeriods.length - 1] ? '' : e.target.value)}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  >
                    {allPeriods
                      .filter(period => !fromPeriod || period >= fromPeriod)
                      .map(period => <option key={period} value={period}>{formatPeriod(period)}</option>)}
                  </select>
                </div>
              </div>
              
              {data.droplets.length > 1 && (
                <div className="mt-4">
                  <p className="block text-sm font-medium text-gray-700 mb-2">Droplets</p>
                  <div className="flex flex-wrap gap-2">
                    {data.droplets.map(droplet => {
                      const visible = !hiddenIds.includes(droplet.id);
                      return (
                        <button
                          key={droplet.id}
                          onClick={() => toggleDroplet(droplet.id)}
                          className={`inline-flex items-center px-2 py-1 rounded border text-sm transition-colors ${visible ? 'border-gray-300 bg-white text-gray-800' : 'border-gray-200 bg-gray-50 text-gray-400 line-through'}`}
                        >
                          <span className="inline-block w-3 h-3 rounded-sm mr-2" style={{ backgroundColor: visible ? colorFor(droplet.id) : '#d1d5db' }}></span>
                          {droplet.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              
              <p className="mt-4 text-xs text-gray-500">Exports include only what the filters currently show.</p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4 mb-6">
              <div className="bg-blue-50 p-4 rounded-lg">
                <p className="text-sm text-blue-700 mb-1">{isSingle ? 'Created' : 'Earliest Created'}</p>
                <p className="text-xl sm:text-2xl font-bold text-blue-900">{earliestCreated.toLocaleDateString()}</p>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <p className="text-sm text-green-700 mb-1">{isFiltered ? 'Total Cost (Filtered)' : 'Total Cost to Date'}</p>
                <p className="text-xl sm:text-2xl font-bold text-green-900">{formatCurrency(view.totalCost)}</p>
              </div>
              <div className="bg-teal-50 p-4 rounded-lg">
                <p className="text-sm text-teal-700 mb-1">Invoiced</p>
                <p className="text-xl sm:text-2xl font-bold text-teal-900">{formatCurrency(view.invoicedCost)}</p>
              </div>
              <div className="bg-amber-50 p-4 rounded-lg">
                <p className="text-sm text-amber-700 mb-1">Not Invoiced</p>
                <p className="text-xl sm:text-2xl font-bold text-amber-900">{formatCurrency(view.uninvoicedCost)}</p>
                <p className="text-xs text-amber-700 mt-1">Month to date + estimated</p>
              </div>
              <div className="bg-indigo-50 p-4 rounded-lg">
                <p className="text-sm text-indigo-700 mb-1">Months Covered</p>
                <p className="text-xl sm:text-2xl font-bold text-indigo-900">{view.monthlyCosts.length}</p>
              </div>
              <div className="bg-purple-50 p-4 rounded-lg">
                <p className="text-sm text-purple-700 mb-1">Current Rate</p>
                <p className="text-xl sm:text-2xl font-bold text-purple-900">{formatCurrency(currentMonthlyRate)}/mo</p>
              </div>
            </div>

            {view.paymentTotals.length > 0 && (
              <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-8">
                <h2 className="text-xl font-semibold text-gray-800 mb-1">Paid With</h2>
                <p className="text-xs text-gray-500 mb-4">Total cost by the payment method that paid each month's invoice.</p>
                <div className="space-y-3">
                  {view.paymentTotals.map(payment => {
                    const share = view.totalCost > 0 ? (payment.amount / view.totalCost) * 100 : 0;
                    const pending = PENDING_METHODS.includes(payment.method);
                    return (
                      <div key={payment.method}>
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className={`inline-flex items-center gap-1.5 font-medium ${pending ? 'text-gray-400' : 'text-gray-900'}`}>
                            {!pending && (
                              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <rect x="2" y="5" width="20" height="14" rx="2" strokeWidth={2} />
                                <path strokeWidth={2} d="M2 10h20" />
                              </svg>
                            )}
                            {pending ? payment.method : (
                              <Link to={`/payments?method=${encodeURIComponent(payment.method)}`} className="hover:text-blue-600 hover:underline" title="See every charge on this payment method">
                                {payment.method}
                              </Link>
                            )}
                          </span>
                          <span className="whitespace-nowrap">
                            <span className="font-semibold text-gray-900">{formatCurrency(payment.amount)}</span>
                            <span className="ml-2 text-xs text-gray-500">{share.toFixed(1)}%</span>
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-gray-100">
                          <div className={`h-1.5 rounded-full ${pending ? 'bg-gray-300' : 'bg-blue-500'}`} style={{ width: `${share}%` }}></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-4 text-xs text-gray-500">
                  DigitalOcean doesn't link payments to invoices directly, so payments and credits from your billing history are matched to the oldest unpaid invoice first.
                </p>
              </div>
            )}
            
            {!isSingle && (
              <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-8">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">Selected Droplets</h2>
                <div className="overflow-x-auto">
                  <table className="min-w-[640px] w-full whitespace-nowrap divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                        <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Region</th>
                        <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Slug</th>
                        <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                        <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Rate</th>
                        <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Invoiced</th>
                        <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Not Invoiced</th>
                        <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {view.droplets.map(droplet => (
                        <tr key={droplet.id}>
                          <td className="px-3 py-3 text-sm font-medium text-gray-900">
                            <span className="inline-block w-3 h-3 rounded-sm mr-2 align-middle" style={{ backgroundColor: colorFor(droplet.id) }}></span>
                            <Link to={`/droplets/details?ids=${droplet.id}`} className="hover:underline">{droplet.name}</Link>
                          </td>
                          <td className="px-3 py-3 text-sm text-gray-500">{droplet.regionName}</td>
                          <td className="px-3 py-3 text-sm text-gray-500">{droplet.size}</td>
                          <td className="px-3 py-3 text-sm text-gray-500">{new Date(droplet.created_at).toLocaleDateString()}</td>
                          <td className="px-3 py-3 text-sm text-gray-500 text-right">{formatCurrency(droplet.monthly_price)}/mo</td>
                          <td className="px-3 py-3 text-sm text-gray-500 text-right">{formatCurrency(droplet.invoicedCost)}</td>
                          <td className="px-3 py-3 text-sm text-gray-500 text-right">{formatCurrency(droplet.uninvoicedCost)}</td>
                          <td className="px-3 py-3 text-sm text-gray-900 text-right">{formatCurrency(droplet.totalCost)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50">
                      <tr>
                        <td colSpan={4} className="px-3 py-3 text-sm font-semibold text-gray-900">Total</td>
                        <td className="px-3 py-3 text-sm font-semibold text-gray-900 text-right">{formatCurrency(currentMonthlyRate)}/mo</td>
                        <td className="px-3 py-3 text-sm font-semibold text-gray-900 text-right">{formatCurrency(view.invoicedCost)}</td>
                        <td className="px-3 py-3 text-sm font-semibold text-gray-900 text-right">{formatCurrency(view.uninvoicedCost)}</td>
                        <td className="px-3 py-3 text-sm font-semibold text-gray-900 text-right">{formatCurrency(view.totalCost)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-8">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">Monthly Cost</h2>
              <div className="h-64 sm:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis tickFormatter={(value) => `$${value}`} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(value, name) => [formatCurrency(value), name]} />
                    {!isSingle && <Legend />}
                    {view.droplets.map(droplet => (
                      <Bar
                        key={droplet.id}
                        dataKey={droplet.id}
                        name={droplet.name}
                        stackId="cost"
                        fill={colorFor(droplet.id)}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-8">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">Month-wise Breakdown</h2>
              <div className="overflow-x-auto">
                <table className="min-w-[640px] w-full whitespace-nowrap divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Month</th>
                      <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Breakdown</th>
                      {isSingle && (
                        <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source</th>
                      )}
                      <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Paid With</th>
                      <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Invoiced</th>
                      <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Not Invoiced</th>
                      <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {tableRows.map(month => {
                      const monthDroplets = Object.entries(month.droplets);
                      const singleCost = isSingle ? month.droplets[singleDroplet.id] : null;
                      const productBreakdown = singleCost ? Object.entries(singleCost.breakdown) : [];

                      return (
                        <tr key={month.period}>
                          <td className="px-3 py-3 text-sm font-medium text-gray-900 align-top">{formatPeriod(month.period)}</td>
                          <td className="px-3 py-3 text-sm text-gray-500">
                            {isSingle ? (
                              productBreakdown.length > 0
                                ? productBreakdown.map(([product, amount]) => (
                                    <div key={product}>{product}: {formatCurrency(amount)}</div>
                                  ))
                                : <span className="text-gray-400">-</span>
                            ) : (
                              monthDroplets.map(([dropletId, cost]) => (
                                <div key={dropletId} className="flex items-center gap-2 py-0.5">
                                  <span>{dropletNames[dropletId]}: {formatCurrency(cost.amount)}</span>
                                  <SourceBadge source={cost.source} />
                                </div>
                              ))
                            )}
                          </td>
                          {isSingle && (
                            <td className="px-3 py-3 text-sm align-top">
                              {singleCost && <SourceBadge source={singleCost.source} />}
                            </td>
                          )}
                          <td className="px-3 py-3 text-sm align-top">
                            {month.paidWith.map(payment => (
                              <div key={payment.method} className={PENDING_METHODS.includes(payment.method) ? 'text-gray-400' : 'text-gray-700'}>
                                {payment.method}
                                {month.paidWith.length > 1 && <span className="text-gray-400"> · {formatCurrency(payment.amount)}</span>}
                              </div>
                            ))}
                          </td>
                          <td className="px-3 py-3 text-sm text-gray-500 text-right align-top">{formatCurrency(month.invoicedAmount)}</td>
                          <td className="px-3 py-3 text-sm text-gray-500 text-right align-top">{formatCurrency(month.uninvoicedAmount)}</td>
                          <td className="px-3 py-3 text-sm text-gray-900 text-right align-top">{formatCurrency(month.amount)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-gray-50">
                    <tr>
                      <td colSpan={isSingle ? 4 : 3} className="px-3 py-3 text-sm font-semibold text-gray-900">Total</td>
                      <td className="px-3 py-3 text-sm font-semibold text-gray-900 text-right">{formatCurrency(view.invoicedCost)}</td>
                      <td className="px-3 py-3 text-sm font-semibold text-gray-900 text-right">{formatCurrency(view.uninvoicedCost)}</td>
                      <td className="px-3 py-3 text-sm font-semibold text-gray-900 text-right">{formatCurrency(view.totalCost)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {hasEstimates && (
                <p className="mt-4 text-xs text-gray-500">
                  Estimated months had no matching invoice line items, so they are calculated from the droplet's current hourly rate (capped at 672 hours per month).
                </p>
              )}
            </div>
          </div>
        ) : null}
      </div>

      <Footer />
    </div>
  );
};

export default DropletDetail;
