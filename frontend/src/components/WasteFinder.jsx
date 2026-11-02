import React, { useState, useEffect, useMemo, useRef } from 'react';
import { wasteService } from '../services/api';
import { exportRowsToExcel } from '../utils/excelExport';
import ExportButtons from './ExportButtons';
import Footer from './Footer';

const CATEGORIES = [
  { name: 'Powered-off droplet', style: 'bg-red-100 text-red-800', card: 'bg-red-50 text-red-900' },
  { name: 'Unattached volume', style: 'bg-amber-100 text-amber-800', card: 'bg-amber-50 text-amber-900' },
  { name: 'Old snapshot', style: 'bg-blue-100 text-blue-800', card: 'bg-blue-50 text-blue-900' },
  { name: 'Idle reserved IP', style: 'bg-purple-100 text-purple-800', card: 'bg-purple-50 text-purple-900' },
  { name: 'Empty load balancer', style: 'bg-teal-100 text-teal-800', card: 'bg-teal-50 text-teal-900' }
];
const CATEGORY_STYLE = Object.fromEntries(CATEGORIES.map(category => [category.name, category.style]));

const COST_SOURCES = {
  invoice: { label: 'Invoiced', className: 'bg-green-100 text-green-800', help: 'Billed amount on your last invoice' },
  price: { label: 'Plan price', className: 'bg-gray-100 text-gray-700', help: 'Monthly price of its plan (not on the last invoice yet)' },
  estimate: { label: 'Estimate', className: 'bg-yellow-100 text-yellow-800', help: 'Estimated from DigitalOcean list prices (not on the last invoice yet)' }
};

const SNAPSHOT_AGE_OPTIONS = [30, 60, 90, 180, 365];

const formatCurrency = (amount) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
}).format(amount || 0);

const Badge = ({ className, title, children }) => (
  <span title={title} className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap ${className}`}>{children}</span>
);

const CostCell = ({ item }) => {
  const source = COST_SOURCES[item.costSource];
  return (
    <div className="text-right">
      <div className="font-semibold text-gray-900 whitespace-nowrap">{formatCurrency(item.monthlyCost)}/mo</div>
      <Badge className={`${source.className} mt-1`} title={source.help}>{source.label}</Badge>
    </div>
  );
};

const ResourceName = ({ item }) => (
  <a href={item.url} target="_blank" rel="noopener noreferrer" className="font-medium text-gray-900 hover:text-blue-600 hover:underline break-all" title="Open in DigitalOcean">
    {item.name} <span className="text-gray-400">↗</span>
  </a>
);

const WasteFinder = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const reportRef = useRef(null);
  const [error, setError] = useState(null);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [snapshotAge, setSnapshotAge] = useState(90);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const fetchItems = async () => {
      setLoading(true);
      setError(null);
      try {
        setData(await wasteService.getUnusedResources());
      } catch (fetchError) {
        console.error('Error fetching unused resources:', fetchError);
        setError('Failed to check for unused resources. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    fetchItems();
  }, [refreshCounter]);

  // Snapshots under the chosen age are hidden unless their source was deleted
  const candidates = useMemo(() => (data?.items || []).filter(item =>
    item.category !== 'Old snapshot' || item.sourceGone || item.ageDays >= snapshotAge
  ), [data, snapshotAge]);

  const categoryTotals = useMemo(() => {
    const totals = {};
    candidates.forEach(item => {
      if (!totals[item.category]) totals[item.category] = { count: 0, cost: 0 };
      totals[item.category].count++;
      totals[item.category].cost += item.monthlyCost;
    });
    return totals;
  }, [candidates]);

  const filtered = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return candidates
      .filter(item => categoryFilter === 'all' || item.category === categoryFilter)
      .filter(item => {
        if (words.length === 0) return true;
        const text = [item.name, item.category, item.reason, item.details, item.region].join(' ').toLowerCase();
        return words.every(word => text.includes(word));
      });
  }, [candidates, categoryFilter, query]);

  const totalSavings = candidates.reduce((sum, item) => sum + item.monthlyCost, 0);
  const filteredSavings = filtered.reduce((sum, item) => sum + item.monthlyCost, 0);

  const exportFilename = () => `unused-resources_${new Date().toISOString().slice(0, 10)}`;
  
  const exportExcel = () => exportRowsToExcel(
    'Unused Resources',
    [
      { header: 'Category', key: 'category', width: 22 },
      { header: 'Resource', key: 'name', width: 32 },
      { header: 'Reason', key: 'reason', width: 50 },
      { header: 'Details', key: 'details', width: 30 },
      { header: 'Region', key: 'region', width: 16 },
      { header: 'Created', key: 'created', width: 14 },
      { header: 'Monthly Cost (USD)', key: 'monthlyCost', width: 18 },
      { header: 'Cost Source', key: 'costSource', width: 14 },
      { header: 'Link', key: 'url', width: 50 }
    ],
    filtered.map(item => ({
      ...item,
      created: item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '',
      monthlyCost: Number(item.monthlyCost.toFixed(2)),
      costSource: COST_SOURCES[item.costSource].label
    })),
    exportFilename()
  );

  return (
    <div className="flex flex-col min-h-screen">
      <div ref={reportRef} className="flex-grow w-full min-w-0 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-2">Waste Finder</h1>
            <p className="text-gray-600">Resources you are paying for that look unused, most expensive first.</p>
          </div>
          <button
            data-html2canvas-ignore="true"
            onClick={() => setRefreshCounter(count => count + 1)}
            disabled={loading}
            className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors disabled:opacity-50"
          >
            {loading ? 'Checking...' : 'Check Again'}
          </button>
        </div>

        {error && <div className="mb-6 p-4 bg-red-100 text-red-700 rounded-md">{error}</div>}

        {loading && !data ? (
          <div className="bg-white rounded-lg shadow-md p-6 flex flex-col justify-center items-center h-64">
            <svg className="animate-spin h-10 w-10 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="mt-4 text-sm text-gray-500">Checking droplets, volumes, snapshots, reserved IPs and load balancers...</p>
          </div>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4 mb-6">
              <button
                type="button"
                onClick={() => setCategoryFilter('all')}
                className={`col-span-2 md:col-span-3 xl:col-span-1 text-left p-3 sm:p-4 rounded-lg border-2 bg-green-50 text-green-900 ${categoryFilter === 'all' ? 'border-blue-500' : 'border-transparent hover:border-gray-300'}`}
              >
                <p className="text-xs sm:text-sm opacity-80 mb-1">Potential Savings</p>
                <p className="text-xl sm:text-2xl font-bold">{formatCurrency(totalSavings)}<span className="text-sm font-normal">/mo</span></p>
                <p className="text-xs mt-1">{candidates.length} item{candidates.length === 1 ? '' : 's'} · {formatCurrency(totalSavings * 12)}/yr</p>
              </button>
              {CATEGORIES.map(category => {
                const totals = categoryTotals[category.name] || { count: 0, cost: 0 };
                const active = categoryFilter === category.name;
                return (
                  <button
                    key={category.name}
                    type="button"
                    onClick={() => setCategoryFilter(active ? 'all' : category.name)}
                    className={`text-left p-3 sm:p-4 rounded-lg border-2 ${totals.count ? category.card : 'bg-gray-50 text-gray-500'} ${active ? 'border-blue-500' : 'border-transparent hover:border-gray-300'}`}
                  >
                    <p className="text-xs sm:text-sm opacity-80 mb-1">{category.name}s</p>
                    <p className="text-lg sm:text-xl font-bold">{totals.count}</p>
                    <p className="text-xs mt-1">{formatCurrency(totals.cost)}/mo</p>
                  </button>
                );
              })}
            </div>

            <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-8">
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
                    placeholder="Search name, region, reason..."
                    className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    aria-label="Search unused resources"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <span className="whitespace-nowrap">Snapshots older than</span>
                  <select
                    value={snapshotAge}
                    onChange={(e) => setSnapshotAge(Number(e.target.value))}
                    className="px-3 py-2 border border-gray-300 rounded-md bg-white text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  >
                    {SNAPSHOT_AGE_OPTIONS.map(days => <option key={days} value={days}>{days} days</option>)}
                  </select>
                </label>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <p className="text-sm text-gray-600">
                  {filtered.length} item{filtered.length === 1 ? '' : 's'} · <span className="font-semibold text-gray-900">{formatCurrency(filteredSavings)}/mo</span>
                  {(categoryFilter !== 'all' || query) && (
                    <button onClick={() => { setCategoryFilter('all'); setQuery(''); }} className="ml-2 text-blue-600 hover:underline">Clear filters</button>
                  )}
                </p>
                <ExportButtons
                  onExcel={exportExcel}
                  pdfTarget={reportRef}
                  filename={exportFilename}
                  disabled={filtered.length === 0}
                />
              </div>

              {filtered.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-2xl mb-2">🎉</p>
                  <p className="text-gray-600">{candidates.length === 0 ? 'Nothing looks unused. Nice and tidy!' : 'Nothing matches your filters.'}</p>
                </div>
              ) : (
                <>
                  {/* Card list on phones */}
                  <div className="md:hidden divide-y divide-gray-200">
                    {filtered.map(item => (
                      <div key={item.id} className="py-3 space-y-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <Badge className={CATEGORY_STYLE[item.category]}>{item.category}</Badge>
                            <div><ResourceName item={item} /></div>
                          </div>
                          <CostCell item={item} />
                        </div>
                        <p className="text-sm text-gray-600">{item.reason}</p>
                        <p className="text-xs text-gray-500">{[item.details, item.region].filter(Boolean).join(' · ')}</p>
                      </div>
                    ))}
                  </div>

                  {/* Table on tablets and desktops */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full min-w-[760px] divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Resource</th>
                          <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Why it looks unused</th>
                          <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Region</th>
                          <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                          <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Monthly Cost</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {filtered.map(item => (
                          <tr key={item.id} className="align-top hover:bg-gray-50">
                            <td className="px-3 py-3">
                              <Badge className={CATEGORY_STYLE[item.category]}>{item.category}</Badge>
                              <div className="mt-1 text-sm"><ResourceName item={item} /></div>
                              {item.details && <div className="text-xs text-gray-500">{item.details}</div>}
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-700">{item.reason}</td>
                            <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">{item.region || '—'}</td>
                            <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '—'}</td>
                            <td className="px-3 py-3"><CostCell item={item} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              <p className="mt-4 text-xs text-gray-500">
                <strong>Invoiced</strong> costs are what you were billed for that resource{data.invoicePeriod ? ` on your ${data.invoicePeriod} invoice` : ''}.
                {' '}<strong>Plan price</strong> and <strong>Estimate</strong> are used for resources not on that invoice yet; estimates use DigitalOcean list prices
                {' '}(volumes ${data.listPrices.volumePerGb}/GB, snapshots ${data.listPrices.snapshotPerGb}/GB, idle reserved IPs ${data.listPrices.idleReservedIp}, load balancers ${data.listPrices.loadBalancerNode}/node).
                {' '}Nothing here is changed automatically. Use the ↗ links to review each resource in DigitalOcean.
              </p>
            </div>
          </>
        ) : null}
      </div>

      <Footer />
    </div>
  );
};

export default WasteFinder;
