import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { networkService } from '../services/api';
import { exportRowsToExcel } from '../utils/excelExport';
import ExportButtons from './ExportButtons';
import Footer from './Footer';

const RESOURCE_TYPES = ['Droplet', 'Reserved IP', 'Load Balancer', 'Database', 'Kubernetes'];

const TYPE_STYLES = {
  'Droplet': 'bg-blue-100 text-blue-800',
  'Reserved IP': 'bg-purple-100 text-purple-800',
  'Load Balancer': 'bg-teal-100 text-teal-800',
  'Database': 'bg-amber-100 text-amber-800',
  'Kubernetes': 'bg-indigo-100 text-indigo-800'
};

const SCOPE_STYLES = {
  public: 'bg-green-100 text-green-800',
  private: 'bg-gray-200 text-gray-800'
};

// --- IPv4 / CIDR helpers so searches like "10.122.0.0/20" match every address in that range ---

const ipv4ToInt = (ip) => {
  const parts = String(ip).split('.');
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((acc, part) => (acc * 256) + Number(part), 0);
};

const parseCidr = (text) => {
  const match = String(text).trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (!match) return null;
  const base = ipv4ToInt(match[1]);
  const bits = Number(match[2]);
  if (base === null || bits > 32) return null;
  const size = 2 ** (32 - bits);
  const start = Math.floor(base / size) * size;
  return { start, end: start + size - 1 };
};

const compareIps = (a, b) => {
  const aInt = ipv4ToInt(a);
  const bInt = ipv4ToInt(b);
  if (aInt !== null && bInt !== null) return aInt - bInt;
  if (aInt !== null) return -1;
  if (bInt !== null) return 1;
  return String(a || '').localeCompare(String(b || ''));
};

// Text that the search box matches against for a single address row
const searchableText = (row) => [
  row.ip,
  row.host,
  row.resourceName,
  row.resourceType,
  row.region,
  row.regionName,
  row.project?.name,
  row.vpc?.name,
  row.vpc?.ipRange,
  row.status,
  row.note,
  row.assignedTo?.name,
  row.scope,
  row.reserved ? 'reserved' : '',
  row.version === 6 ? 'ipv6' : 'ipv4',
  ...(row.tags || [])
].filter(Boolean).join(' ').toLowerCase();

const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for browsers that block the async clipboard API
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
};

// Bold the part of `text` that matches the search query
const Highlight = ({ text, query }) => {
  if (!text) return null;
  const value = String(text);
  if (!query) return value;
  const index = value.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return value;
  return (
    <>
      {value.slice(0, index)}
      <mark className="bg-yellow-200 text-inherit rounded-sm">{value.slice(index, index + query.length)}</mark>
      {value.slice(index + query.length)}
    </>
  );
};

const CopyButton = ({ value, onCopied, label }) => (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      copyText(value);
      onCopied(value);
    }}
    className="inline-flex items-center justify-center p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 flex-shrink-0"
    title={`Copy ${label || value}`}
    aria-label={`Copy ${label || value}`}
  >
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  </button>
);

const Badge = ({ className, children }) => (
  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap ${className}`}>{children}</span>
);

// IP (or hostname when DNS couldn't resolve it) with copy buttons and badges
const AddressCell = ({ row, query, onCopied }) => (
  <div className="min-w-0">
    {row.ip ? (
      <div className="flex items-center gap-1">
        <span className="font-mono text-sm text-gray-900 break-all"><Highlight text={row.ip} query={query} /></span>
        <CopyButton value={row.ip} onCopied={onCopied} />
      </div>
    ) : null}
    {row.host && (
      <div className="flex items-center gap-1">
        <span className={`font-mono break-all ${row.ip ? 'text-xs text-gray-500' : 'text-sm text-gray-900'}`}>
          <Highlight text={row.port ? `${row.host}:${row.port}` : row.host} query={query} />
        </span>
        <CopyButton value={row.port ? `${row.host}:${row.port}` : row.host} onCopied={onCopied} label="host" />
      </div>
    )}
    <div className="flex flex-wrap gap-1 mt-1">
      <Badge className={SCOPE_STYLES[row.scope]}>{row.scope === 'public' ? 'Public' : 'Private'}</Badge>
      {row.version === 6 && <Badge className="bg-sky-100 text-sky-800">IPv6</Badge>}
      {row.reserved && <Badge className="bg-purple-100 text-purple-800">Reserved</Badge>}
      {row.idle && <Badge className="bg-red-100 text-red-700">Idle · billed</Badge>}
    </div>
  </div>
);

const ResourceCell = ({ row, query }) => (
  <div className="min-w-0">
    <div className="flex items-center gap-1 flex-wrap">
      <Badge className={TYPE_STYLES[row.resourceType]}>{row.resourceType}</Badge>
      {row.url ? (
        <a href={row.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-gray-900 hover:text-blue-600 hover:underline break-all" title="Open in DigitalOcean">
          <Highlight text={row.resourceName} query={query} /> <span className="text-gray-400">↗</span>
        </a>
      ) : (
        <span className="text-sm font-medium text-gray-900 break-all"><Highlight text={row.resourceName} query={query} /></span>
      )}
    </div>
    {row.note && <div className="text-xs text-gray-500 mt-0.5"><Highlight text={row.note} query={query} /></div>}
  </div>
);

// Group address rows by resource for the "By Resource" view. Assigned reserved IPs join their droplet.
const groupByResource = (rows) => {
  const groups = new Map();

  rows.forEach(row => {
    const ownerKey = row.resourceType === 'Reserved IP' && row.assignedTo
      ? `Droplet-${row.assignedTo.id}`
      : `${row.resourceType}-${row.resourceId}`;

    if (!groups.has(ownerKey)) {
      groups.set(ownerKey, {
        key: ownerKey,
        resourceType: row.resourceType === 'Reserved IP' && row.assignedTo ? 'Droplet' : row.resourceType,
        resourceName: row.resourceType === 'Reserved IP' && row.assignedTo ? row.assignedTo.name : row.resourceName,
        url: row.resourceType === 'Reserved IP' && row.assignedTo ? null : row.url,
        regionName: row.regionName,
        project: row.project,
        vpc: row.vpc,
        status: row.status,
        note: row.resourceType === 'Reserved IP' ? row.note : '',
        publicV4: [],
        privateV4: [],
        ipv6: [],
        reservedIps: [],
        hosts: []
      });
    }

    const group = groups.get(ownerKey);
    // A droplet row seen after its reserved IP fills in the droplet's own details
    if (row.resourceType !== 'Reserved IP' && group.resourceType === row.resourceType) {
      group.url = row.url;
      group.regionName = row.regionName;
      group.project = row.project || group.project;
      group.vpc = row.vpc || group.vpc;
      group.status = row.status;
      if (!group.note) group.note = row.note;
    }

    if (row.reserved) group.reservedIps.push(row);
    else if (row.version === 6) group.ipv6.push(row);
    else if (row.scope === 'private') group.privateV4.push(row);
    else group.publicV4.push(row);
    if (row.host) group.hosts.push(row);
  });

  return [...groups.values()].sort((a, b) => a.resourceName.localeCompare(b.resourceName));
};

// Label for an address in the combined list, e.g. "Public", "Private", "IPv6", "Reserved"
const addressLabel = (row) => {
  if (row.reserved) return { text: 'Reserved', className: 'bg-purple-100 text-purple-800' };
  if (row.version === 6) return { text: 'IPv6', className: 'bg-sky-100 text-sky-800' };
  if (row.scope === 'private') return { text: 'Private', className: SCOPE_STYLES.private };
  return { text: 'Public', className: SCOPE_STYLES.public };
};

// All of a resource's addresses in one column: public, private, IPv6, then reserved
const IpStack = ({ group, query, onCopied }) => {
  const rows = [...group.publicV4, ...group.privateV4, ...group.ipv6, ...group.reservedIps];
  if (rows.length === 0) return <span className="text-gray-300">—</span>;
  
  return (
    <div className="space-y-1">
      {rows.map(row => {
        const value = row.ip || (row.port ? `${row.host}:${row.port}` : row.host);
        if (!value) return null;
        const label = addressLabel(row);
        return (
          <div key={row.key} className="flex items-center gap-2 min-w-0">
            <Badge className={`${label.className} w-16 justify-center`}>{label.text}</Badge>
            <span className="font-mono text-sm text-gray-900 break-all"><Highlight text={value} query={query} /></span>
            <CopyButton value={value} onCopied={onCopied} />
            {row.idle && <Badge className="bg-red-100 text-red-700">Idle · billed</Badge>}
          </div>
        );
      })}
    </div>
  );
};

const IpAddresses = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const reportRef = useRef(null);
  const [error, setError] = useState(null);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const [toast, setToast] = useState(null);
  const searchRef = useRef(null);
  const toastTimer = useRef(null);

  // Filters live in the URL so a filtered view can be bookmarked or shared.
  // The search text is kept in local state so typing stays instant; it is copied to the URL after a short pause.
  const [query, setQuery] = useState(() => searchParams.get('q') || '');
  const scope = searchParams.get('scope') || 'all';
  const view = searchParams.get('view') || 'resource';
  const typeFilter = searchParams.get('type') || 'all';
  const versionFilter = searchParams.get('version') || 'all';
  const regionFilter = searchParams.get('region') || 'all';
  const projectFilter = searchParams.get('project') || 'all';
  const reservedOnly = searchParams.get('reserved') === '1';
  const idleOnly = searchParams.get('idle') === '1';

  const updateParam = useCallback((key, value, defaultValue = 'all') => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (value === defaultValue || value === '' || value === null || value === false) next.delete(key);
      else next.set(key, value === true ? '1' : value);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    const fetchAddresses = async () => {
      setLoading(true);
      setError(null);
      try {
        setData(await networkService.getIpAddresses());
      } catch (fetchError) {
        console.error('Error fetching IP addresses:', fetchError);
        setError('Failed to load IP addresses. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchAddresses();
  }, [refreshCounter]);

  // Press "/" anywhere to jump to the search box, Escape to clear it
  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = document.activeElement?.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => updateParam('q', query.trim() ? query : '', ''), 300);
    return () => clearTimeout(timer);
  }, [query, updateParam]);
  
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const showCopied = useCallback((value) => {
    setToast(`Copied ${value}`);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  }, []);

  const addresses = useMemo(() => data?.addresses || [], [data]);

  const regionOptions = useMemo(() => {
    const names = {};
    addresses.forEach(row => { if (row.region) names[row.region] = row.regionName || row.region; });
    return Object.entries(names).sort((a, b) => a[1].localeCompare(b[1]));
  }, [addresses]);

  const projectOptions = useMemo(() => {
    const names = {};
    addresses.forEach(row => { if (row.project) names[row.project.id] = row.project.name; });
    return Object.entries(names).sort((a, b) => a[1].localeCompare(b[1]));
  }, [addresses]);

  // Everything except the scope/type quick filters, so the summary cards show counts within the other filters
  const baseFiltered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    const cidr = parseCidr(trimmed);

    return addresses.filter(row => {
      if (versionFilter !== 'all' && String(row.version) !== versionFilter) return false;
      if (regionFilter !== 'all' && row.region !== regionFilter) return false;
      if (projectFilter !== 'all' && (projectFilter === 'none' ? row.project : row.project?.id !== projectFilter)) return false;
      if (idleOnly && !row.idle) return false;
      if (!trimmed) return true;
      if (cidr) {
        const value = ipv4ToInt(row.ip);
        return value !== null && value >= cidr.start && value <= cidr.end;
      }
      // Every word must match somewhere, e.g. "prod private blr1"
      const text = searchableText(row);
      return trimmed.split(/\s+/).every(word => text.includes(word));
    });
  }, [addresses, query, versionFilter, regionFilter, projectFilter, idleOnly]);

  const filtered = useMemo(() => baseFiltered
    .filter(row => scope === 'all' || row.scope === scope)
    .filter(row => !reservedOnly || row.reserved)
    .filter(row => typeFilter === 'all' || row.resourceType === typeFilter)
    .sort((a, b) => a.resourceName.localeCompare(b.resourceName) || compareIps(a.ip, b.ip)),
  [baseFiltered, scope, reservedOnly, typeFilter]);

  const grouped = useMemo(() => groupByResource(filtered), [filtered]);

  const counts = useMemo(() => ({
    total: baseFiltered.length,
    public: baseFiltered.filter(row => row.scope === 'public').length,
    private: baseFiltered.filter(row => row.scope === 'private').length,
    reserved: baseFiltered.filter(row => row.reserved).length,
    idle: baseFiltered.filter(row => row.idle).length
  }), [baseFiltered]);

  const typeCounts = useMemo(() => {
    const result = {};
    baseFiltered
      .filter(row => scope === 'all' || row.scope === scope)
      .filter(row => !reservedOnly || row.reserved)
      .forEach(row => { result[row.resourceType] = (result[row.resourceType] || 0) + 1; });
    return result;
  }, [baseFiltered, scope, reservedOnly]);

  const isFiltered = query || scope !== 'all' || typeFilter !== 'all' || versionFilter !== 'all' ||
    regionFilter !== 'all' || projectFilter !== 'all' || reservedOnly || idleOnly;
  
  // VPCs with their private address count among the addresses shown; with filters on, only VPCs that have matches
  const visibleVpcs = (data?.vpcs || [])
    .map(vpc => ({ vpc, privateCount: filtered.filter(row => row.vpc?.id === vpc.id && row.scope === 'private').length }))
    .filter(({ privateCount }) => privateCount > 0 || !isFiltered);

  const clearFilters = () => {
    setQuery('');
    setSearchParams(view === 'resource' ? {} : { view }, { replace: true });
  };

  const copyAllIps = () => {
    const ips = [...new Set(filtered.map(row => row.ip).filter(Boolean))];
    if (ips.length === 0) return;
    copyText(ips.join('\n'));
    setToast(`Copied ${ips.length} IP address${ips.length === 1 ? '' : 'es'}`);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  };

  const exportFilename = () => `ip-addresses_${new Date().toISOString().slice(0, 10)}`;
  
  const exportExcel = () => exportRowsToExcel(
    'IP Addresses',
    [
      { header: 'IP Address', key: 'ip', width: 40 },
      { header: 'Hostname', key: 'host', width: 50 },
      { header: 'Port', key: 'port', width: 8 },
      { header: 'Scope', key: 'scope', width: 10 },
      { header: 'Version', key: 'version', width: 9 },
      { header: 'Reserved', key: 'reserved', width: 10 },
      { header: 'Resource Type', key: 'resourceType', width: 15 },
      { header: 'Resource', key: 'resourceName', width: 30 },
      { header: 'Region', key: 'regionName', width: 16 },
      { header: 'Project', key: 'project', width: 22 },
      { header: 'VPC', key: 'vpc', width: 22 },
      { header: 'VPC Range', key: 'vpcRange', width: 18 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Tags', key: 'tags', width: 30 },
      { header: 'Notes', key: 'note', width: 40 }
    ],
    filtered.map(row => ({
      ip: row.ip || '',
      host: row.host || '',
      port: row.port || '',
      scope: row.scope === 'public' ? 'Public' : 'Private',
      version: row.version === 6 ? 'IPv6' : 'IPv4',
      reserved: row.reserved ? (row.idle ? 'Yes (idle)' : 'Yes') : '',
      resourceType: row.resourceType,
      resourceName: row.resourceName,
      regionName: row.regionName,
      project: row.project?.name || '',
      vpc: row.vpc?.name || '',
      vpcRange: row.vpc?.ipRange || '',
      status: row.status,
      tags: (row.tags || []).join(', '),
      note: row.note
    })),
    exportFilename()
  );

  const SummaryCard = ({ label, value, active, onClick, className, sub }) => (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-3 sm:p-4 rounded-lg border-2 transition-colors ${className} ${active ? 'border-blue-500' : 'border-transparent hover:border-gray-300'}`}
    >
      <p className="text-xs sm:text-sm mb-1 opacity-80">{label}</p>
      <p className="text-xl sm:text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs mt-1">{sub}</p>}
    </button>
  );

  const selectClass = 'block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-white text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500';

  return (
    <div className="flex flex-col min-h-screen">
      <div ref={reportRef} className="flex-grow w-full min-w-0 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-2">IP Addresses</h1>
            <p className="text-gray-600">Every public, private and reserved IP across droplets, load balancers, databases and Kubernetes.</p>
          </div>
          <div className="flex flex-wrap gap-2">
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
          <div className="bg-white rounded-lg shadow-md p-6 flex flex-col justify-center items-center h-64">
            <svg className="animate-spin h-10 w-10 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="mt-4 text-sm text-gray-500">Collecting IPs from droplets, load balancers, databases and more...</p>
          </div>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 mb-6">
              <SummaryCard
                label="All Addresses"
                value={counts.total}
                active={scope === 'all' && !reservedOnly}
                onClick={() => setSearchParams(prev => {
                  const next = new URLSearchParams(prev);
                  next.delete('scope');
                  next.delete('reserved');
                  return next;
                }, { replace: true })}
                className="bg-blue-50 text-blue-900"
              />
              <SummaryCard
                label="Public"
                value={counts.public}
                active={scope === 'public'}
                onClick={() => updateParam('scope', scope === 'public' ? 'all' : 'public')}
                className="bg-green-50 text-green-900"
              />
              <SummaryCard
                label="Private"
                value={counts.private}
                active={scope === 'private'}
                onClick={() => updateParam('scope', scope === 'private' ? 'all' : 'private')}
                className="bg-gray-100 text-gray-900"
              />
              <SummaryCard
                label="Reserved"
                value={counts.reserved}
                active={reservedOnly}
                onClick={() => updateParam('reserved', !reservedOnly, false)}
                className="bg-purple-50 text-purple-900"
              />
              <SummaryCard
                label="Idle Reserved"
                value={counts.idle}
                active={idleOnly}
                onClick={() => updateParam('idle', !idleOnly, false)}
                className={counts.idle > 0 ? 'bg-red-50 text-red-900' : 'bg-gray-50 text-gray-600'}
                sub={counts.idle > 0 ? 'Unassigned, still billed' : 'None'}
              />
            </div>

            <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-6">
              <div className="relative mb-4">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
                </svg>
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
                  autoFocus
                  placeholder="Search IP, CIDR (10.122.0.0/20), name, tag, project, region..."
                  className="block w-full pl-10 pr-16 py-3 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  aria-label="Search IP addresses"
                />
                <kbd className="hidden sm:block absolute right-3 top-1/2 -translate-y-1/2 px-2 py-0.5 text-xs text-gray-500 border border-gray-300 rounded bg-gray-50">/</kbd>
              </div>

              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  onClick={() => updateParam('type', 'all')}
                  className={`px-3 py-1 rounded-full text-sm border ${typeFilter === 'all' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                >
                  All types
                </button>
                {RESOURCE_TYPES.map(type => (
                  <button
                    key={type}
                    onClick={() => updateParam('type', typeFilter === type ? 'all' : type)}
                    className={`px-3 py-1 rounded-full text-sm border ${typeFilter === type ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                  >
                    {type} <span className="opacity-70">({typeCounts[type] || 0})</span>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <select aria-label="Filter by region" value={regionFilter} onChange={(e) => updateParam('region', e.target.value)} className={selectClass}>
                  <option value="all">All regions</option>
                  {regionOptions.map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}
                </select>
                <select aria-label="Filter by project" value={projectFilter} onChange={(e) => updateParam('project', e.target.value)} className={selectClass}>
                  <option value="all">All projects</option>
                  {projectOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                  <option value="none">No project</option>
                </select>
                <select aria-label="Filter by IP version" value={versionFilter} onChange={(e) => updateParam('version', e.target.value)} className={selectClass}>
                  <option value="all">IPv4 and IPv6</option>
                  <option value="4">IPv4 only</option>
                  <option value="6">IPv6 only</option>
                </select>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-8">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="inline-flex rounded-md border border-gray-300 overflow-hidden" role="group" aria-label="View">
                    <button
                      onClick={() => updateParam('view', 'ip', 'resource')}
                      className={`px-3 py-1.5 text-sm ${view === 'ip' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                    >
                      By IP
                    </button>
                    <button
                      onClick={() => updateParam('view', 'resource', 'resource')}
                      className={`px-3 py-1.5 text-sm border-l border-gray-300 ${view === 'resource' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                    >
                      By Resource
                    </button>
                  </div>
                  <p className="text-sm text-gray-600">
                    {view === 'ip' ? `${filtered.length} address${filtered.length === 1 ? '' : 'es'}` : `${grouped.length} resource${grouped.length === 1 ? '' : 's'}`}
                    {isFiltered && (
                      <button onClick={clearFilters} className="ml-2 text-blue-600 hover:underline">Clear filters</button>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={copyAllIps}
                    disabled={filtered.length === 0}
                    className="px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    Copy IPs
                  </button>
                  <ExportButtons
                    onExcel={exportExcel}
                    pdfTarget={reportRef}
                    filename={exportFilename}
                    disabled={filtered.length === 0}
                  />
                </div>
              </div>

              {filtered.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <p>No IP addresses match your search.</p>
                  {isFiltered && <button onClick={clearFilters} className="mt-2 text-blue-600 hover:underline">Clear filters</button>}
                </div>
              ) : view === 'ip' ? (
                <>
                  {/* Card list on phones */}
                  <div className="md:hidden divide-y divide-gray-200">
                    {filtered.map(row => (
                      <div key={row.key} className="py-3 space-y-2">
                        <AddressCell row={row} query={query} onCopied={showCopied} />
                        <ResourceCell row={row} query={query} />
                        <div className="text-xs text-gray-500 flex flex-wrap gap-x-3 gap-y-1">
                          <span><Highlight text={row.regionName} query={query} /></span>
                          {row.project && <span>📁 <Highlight text={row.project.name} query={query} /></span>}
                          {row.vpc && <span>VPC <Highlight text={row.vpc.name} query={query} /> ({row.vpc.ipRange})</span>}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Table on tablets and desktops */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IP Address</th>
                          <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Resource</th>
                          <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Region</th>
                          <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Project</th>
                          <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">VPC</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {filtered.map(row => (
                          <tr key={row.key} className={`align-top ${row.idle ? 'bg-red-50' : 'hover:bg-gray-50'}`}>
                            <td className="px-3 py-3"><AddressCell row={row} query={query} onCopied={showCopied} /></td>
                            <td className="px-3 py-3"><ResourceCell row={row} query={query} /></td>
                            <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap"><Highlight text={row.regionName} query={query} /></td>
                            <td className="px-3 py-3 text-sm text-gray-600">{row.project ? <Highlight text={row.project.name} query={query} /> : <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-3 text-sm text-gray-600">
                              {row.vpc ? (
                                <>
                                  <div><Highlight text={row.vpc.name} query={query} /></div>
                                  <div className="text-xs text-gray-400 font-mono">{row.vpc.ipRange}</div>
                                </>
                              ) : <span className="text-gray-300">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <>
                  {/* Card list on phones */}
                  <div className="md:hidden divide-y divide-gray-200">
                    {grouped.map(group => (
                      <div key={group.key} className="py-3 space-y-2">
                        <ResourceCell row={group} query={query} />
                        <IpStack group={group} query={query} onCopied={showCopied} />
                        <div className="text-xs text-gray-500">{group.regionName}{group.project ? ` · ${group.project.name}` : ''}</div>
                      </div>
                    ))}
                  </div>

                  {/* Table on tablets and desktops */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full min-w-[760px] divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Resource</th>
                          <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IP Addresses</th>
                          <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">VPC</th>
                          <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Region / Project</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {grouped.map(group => (
                          <tr key={group.key} className="align-top hover:bg-gray-50">
                            <td className="px-3 py-3"><ResourceCell row={group} query={query} /></td>
                            <td className="px-3 py-3"><IpStack group={group} query={query} onCopied={showCopied} /></td>
                            <td className="px-3 py-3 text-sm text-gray-600">
                              {group.vpc ? (
                                <>
                                  <div><Highlight text={group.vpc.name} query={query} /></div>
                                  <div className="text-xs text-gray-400 font-mono">{group.vpc.ipRange}</div>
                                </>
                              ) : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-600">
                              <div className="whitespace-nowrap">{group.regionName}</div>
                              {group.project && <div className="text-xs text-gray-400">{group.project.name}</div>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              <p className="mt-4 text-xs text-gray-500">
                Tip: press <kbd className="px-1 border border-gray-300 rounded">/</kbd> to search, <kbd className="px-1 border border-gray-300 rounded">Esc</kbd> to clear. Search a CIDR like 10.122.0.0/20 to find every address in that range. Filters are kept in the page URL, so you can bookmark or share a view.
                {' '}Last updated {new Date(data.fetchedAt).toLocaleTimeString()}.
              </p>
            </div>

            {visibleVpcs.length > 0 && (
              <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-8">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">VPC Networks</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {visibleVpcs.map(({ vpc, privateCount }) => {
                    return (
                      <button
                        key={vpc.id}
                        type="button"
                        onClick={() => { setQuery(vpc.ipRange); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        className="text-left p-3 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors"
                        title="Show addresses in this range"
                      >
                        <div className="font-medium text-gray-900 break-all">{vpc.name}</div>
                        <div className="text-sm font-mono text-gray-600">{vpc.ipRange}</div>
                        <div className="text-xs text-gray-500 mt-1">{vpc.regionName} · {privateCount} private address{privateCount === 1 ? '' : 'es'}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>

      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-gray-900 text-white text-sm rounded-lg shadow-lg max-w-[calc(100vw-2rem)] truncate" role="status">
          {toast}
        </div>
      )}

      <Footer />
    </div>
  );
};

export default IpAddresses;
