import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { overviewService, wasteService } from '../services/api';
import { exportSheetsToExcel } from '../utils/excelExport';
import ExportButtons from './ExportButtons';
import Footer from './Footer';

const formatCurrency = (amount) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
}).format(amount || 0);

// Turn "2024-03" into "Mar 2024" (or "Mar" when short)
const formatPeriod = (period, short = false) => {
  const [year, month] = period.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', {
    month: short ? 'short' : 'long',
    year: short ? '2-digit' : 'numeric',
    timeZone: 'UTC'
  });
};

// Below this share of the month the straight-line projection is too rough to trust much
const EARLY_MONTH_FRACTION = 0.15;

const Change = ({ current, previous }) => {
  if (previous == null || previous === 0) return <span className="text-gray-400">No data for last month</span>;
  const diff = current - previous;
  const percent = (diff / previous) * 100;
  const up = diff > 0;
  return (
    <span className={up ? 'text-red-600' : 'text-green-600'}>
      {up ? '▲' : '▼'} {formatCurrency(Math.abs(diff))} ({Math.abs(percent).toFixed(1)}%)
    </span>
  );
};

// Ranked list with a proportional bar behind each row
const RankedList = ({ title, rows, emptyText, subtitle }) => {
  const max = Math.max(...rows.map(row => row.amount), 0);
  return (
    <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
      <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
      {subtitle && <p className="text-xs text-gray-500 mb-3">{subtitle}</p>}
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500 py-6 text-center">{emptyText}</p>
      ) : (
        <ol className="space-y-3 mt-3">
          {rows.map((row, index) => (
            <li key={row.key}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-gray-900" title={row.name}>
                  <span className="text-gray-400 mr-2">{index + 1}.</span>{row.name}
                  {row.product && row.product !== row.name && <span className="ml-2 text-xs text-gray-400">{row.product}</span>}
                </span>
                <span className="font-medium text-gray-900 whitespace-nowrap">{formatCurrency(row.amount)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-gray-100">
                <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${max ? (row.amount / max) * 100 : 0}%` }}></div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

const Overview = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [waste, setWaste] = useState(null);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const reportRef = useRef(null);

  useEffect(() => {
    const fetchOverview = async () => {
      setLoading(true);
      setError(null);
      try {
        setData(await overviewService.getOverview());
      } catch (fetchError) {
        console.error('Error fetching overview:', fetchError);
        setError('Failed to load the overview. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    // Savings summary loads separately so a slow waste check doesn't hold up the page
    const fetchWaste = async () => {
      try {
        setWaste(await wasteService.getUnusedResources());
      } catch (fetchError) {
        console.error('Error fetching unused resources:', fetchError);
        setWaste({ failed: true });
      }
    };

    fetchOverview();
    fetchWaste();
  }, [refreshCounter]);

  // 90-day default matches the Waste Finder's default snapshot age
  const wasteItems = waste?.items ? waste.items.filter(item => item.category !== 'Old snapshot' || item.sourceGone || item.ageDays >= 90) : [];
  const potentialSavings = wasteItems.reduce((sum, item) => sum + item.monthlyCost, 0);

  const chartData = data
    ? data.history.map(month => ({
        month: formatPeriod(month.period, true),
        Invoiced: month.current ? 0 : Number(month.amount.toFixed(2)),
        'So far': month.current ? Number(month.amount.toFixed(2)) : 0,
        'Projected rest': month.current ? Number(Math.max(0, month.projected - month.amount).toFixed(2)) : 0
      }))
    : [];

  const earlyInMonth = data && data.elapsedFraction < EARLY_MONTH_FRACTION;
  
  const exportFilename = () => `overview_${data?.period || new Date().toISOString().slice(0, 7)}`;
  
  const rankedSheet = (name, rows) => ({
    name,
    columns: [
      { header: 'Rank', key: 'rank', width: 6 },
      { header: 'Name', key: 'name', width: 36 },
      { header: 'Service', key: 'product', width: 22 },
      { header: 'Cost So Far', key: 'amount', width: 14, currency: true }
    ],
    rows: rows.map((row, index) => ({ rank: index + 1, ...row }))
  });
  
  const exportExcel = () => exportSheetsToExcel([
    {
      name: 'Summary',
      columns: [
        { header: 'Metric', key: 'metric', width: 32 },
        { header: 'Value', key: 'value', width: 16, currency: true }
      ],
      rows: [
        { metric: `Spent so far (${formatPeriod(data.period)})`, value: data.monthToDate },
        { metric: 'Projected month-end', value: data.projected },
        { metric: data.lastMonth ? `Last month (${formatPeriod(data.lastMonth.period)})` : 'Last month', value: data.lastMonth?.amount ?? null },
        { metric: 'Same point last month', value: data.lastMonthToDate },
        { metric: 'Potential savings per month (Waste Finder)', value: waste?.items ? potentialSavings : null }
      ]
    },
    {
      name: 'Monthly Spend',
      columns: [
        { header: 'Month', key: 'month', width: 16 },
        { header: 'Amount', key: 'amount', width: 14, currency: true },
        { header: 'Projected', key: 'projected', width: 14, currency: true },
        { header: 'Status', key: 'status', width: 16 }
      ],
      rows: data.history.map(month => ({
        month: formatPeriod(month.period),
        amount: month.amount,
        projected: month.current ? month.projected : null,
        status: month.current ? 'In progress' : 'Invoiced'
      }))
    },
    rankedSheet('Top Resources', data.topResources),
    rankedSheet('Top Projects', data.topProjects),
    rankedSheet('Spend by Service', data.byCategory)
  ], exportFilename());

  return (
    <div className="flex flex-col min-h-screen">
      <div ref={reportRef} className="flex-grow w-full min-w-0 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-2">Overview</h1>
            <p className="text-gray-600">
              {data ? `How ${formatPeriod(data.period)} is going so far.` : 'How this month is going so far.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {data && <ExportButtons onExcel={exportExcel} pdfTarget={reportRef} filename={exportFilename} pdfOrientation="portrait" />}
            <button
              data-html2canvas-ignore="true"
              onClick={() => setRefreshCounter(count => count + 1)}
              disabled={loading}
              className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors disabled:opacity-50"
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
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
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
              <div className="bg-blue-50 p-3 sm:p-4 rounded-lg">
                <p className="text-xs sm:text-sm text-blue-700 mb-1">Spent So Far</p>
                <p className="text-xl sm:text-2xl font-bold text-blue-900">{formatCurrency(data.monthToDate)}</p>
                <p className="text-xs text-blue-700 mt-1">{Math.round(data.elapsedFraction * 100)}% of the month gone</p>
              </div>
              <div className="bg-indigo-50 p-3 sm:p-4 rounded-lg">
                <p className="text-xs sm:text-sm text-indigo-700 mb-1">Projected Month-End</p>
                <p className="text-xl sm:text-2xl font-bold text-indigo-900">{formatCurrency(data.projected)}</p>
                <p className="text-xs text-indigo-700 mt-1">{earlyInMonth ? 'Rough: early in the month' : 'At the current daily rate'}</p>
              </div>
              <div className="bg-gray-100 p-3 sm:p-4 rounded-lg">
                <p className="text-xs sm:text-sm text-gray-700 mb-1">Last Month</p>
                <p className="text-xl sm:text-2xl font-bold text-gray-900">{data.lastMonth ? formatCurrency(data.lastMonth.amount) : '—'}</p>
                <p className="text-xs text-gray-600 mt-1">{data.lastMonth ? formatPeriod(data.lastMonth.period) : 'No invoice yet'}</p>
              </div>
              <div className="bg-white border border-gray-200 p-3 sm:p-4 rounded-lg">
                <p className="text-xs sm:text-sm text-gray-700 mb-1">Projected vs Last Month</p>
                <p className="text-base sm:text-lg font-bold"><Change current={data.projected} previous={data.lastMonth?.amount} /></p>
                {data.lastMonthToDate != null && (
                  <p className="text-xs text-gray-600 mt-1">
                    Same point last month: {formatCurrency(data.lastMonthToDate)}
                  </p>
                )}
              </div>
            </div>

            <Link
              to="/waste"
              className="block mb-6 p-4 rounded-lg border border-amber-200 bg-amber-50 hover:bg-amber-100 transition-colors"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-amber-900">Potential savings</p>
                  <p className="text-sm text-amber-800">
                    {!waste
                      ? 'Checking for unused resources...'
                      : waste.failed
                        ? 'Could not check for unused resources.'
                        : wasteItems.length === 0
                          ? 'No unused resources found.'
                          : `${wasteItems.length} resource${wasteItems.length === 1 ? '' : 's'} look unused.`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {waste?.items && wasteItems.length > 0 && (
                    <span className="text-xl sm:text-2xl font-bold text-amber-900">{formatCurrency(potentialSavings)}/mo</span>
                  )}
                  <span className="text-sm text-amber-900 font-medium whitespace-nowrap">Open Waste Finder →</span>
                </div>
              </div>
            </Link>

            <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-1">Monthly Spend</h2>
              <p className="text-xs text-gray-500 mb-4">Last 12 invoices, plus this month so far and its projected remainder.</p>
              <div className="h-64 sm:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                    <YAxis tickFormatter={(value) => `$${value}`} tick={{ fontSize: 11 }} width={60} />
                    <Tooltip formatter={(value, name) => [formatCurrency(value), name]} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Invoiced" stackId="spend" fill="#0069ff" />
                    <Bar dataKey="So far" stackId="spend" fill="#10b981" />
                    <Bar dataKey="Projected rest" stackId="spend" fill="#a7f3d0" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 mb-8">
              <RankedList
                title="Top 5 Resources"
                subtitle="Most expensive this month so far"
                rows={data.topResources}
                emptyText="No charges yet this month."
              />
              <RankedList
                title="Top 5 Projects"
                subtitle="Most expensive this month so far"
                rows={data.topProjects}
                emptyText="No charges yet this month."
              />
              <RankedList
                title="Spend by Service"
                subtitle="This month so far"
                rows={data.byCategory}
                emptyText="No charges yet this month."
              />
            </div>

            <p className="text-xs text-gray-500 mb-4">
              Spend so far comes from your DigitalOcean balance and this month's running invoice. The projection assumes the rest of the month costs the same per day as it has so far.
              {' '}Last updated {new Date(data.generatedAt).toLocaleTimeString()}.
            </p>
          </>
        ) : null}
      </div>

      <Footer />
    </div>
  );
};

export default Overview;
