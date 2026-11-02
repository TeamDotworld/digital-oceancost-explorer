import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { dropletService } from '../services/api';
import { exportSheetsToExcel } from '../utils/excelExport';
import ExportButtons from './ExportButtons';
import MultiSelect from './MultiSelect';

// Matches the backend limit for the monthly cost history endpoint
const MAX_SELECTED_DROPLETS = 50;

const LiveDropletCosts = () => {
  const [dropletData, setDropletData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Each filter holds any number of values; an empty list means "all"
  const [selectedRegions, setSelectedRegions] = useState([]);
  const [selectedTags, setSelectedTags] = useState([]);
  const [selectedSlugs, setSelectedSlugs] = useState([]);
  const [selectedProjects, setSelectedProjects] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef(null);
  const [excludeK8sWorkers, setExcludeK8sWorkers] = useState(false);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [sortField, setSortField] = useState(null);
  const [sortDirection, setSortDirection] = useState('asc');
  const [selectedIds, setSelectedIds] = useState([]);
  const reportRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchDropletData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const data = await dropletService.getLiveCosts();
        setDropletData(data);
        setLoading(false);
      } catch (error) {
        console.error('Error fetching droplet data:', error);
        setError('Failed to load droplet data. Please try again.');
        setLoading(false);
      }
    };
    
    fetchDropletData();
    
    // Set up auto-refresh every 5 minutes
    const refreshInterval = setInterval(() => {
      setRefreshCounter(prev => prev + 1);
    }, 5 * 60 * 1000);
    
    return () => clearInterval(refreshInterval);
  }, [refreshCounter]);
  
  // Press "/" anywhere on the page to jump to the search box
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
  
  const hasActiveFilters = searchQuery.trim() !== '' || selectedRegions.length > 0 || selectedTags.length > 0 ||
    selectedSlugs.length > 0 || selectedProjects.length > 0;
  
  const clearAllFilters = () => {
    setSearchQuery('');
    setSelectedRegions([]);
    setSelectedTags([]);
    setSelectedSlugs([]);
    setSelectedProjects([]);
  };

  const handleExcludeK8sWorkersChange = (e) => {
    setExcludeK8sWorkers(e.target.checked);
  };
  
  const handleManualRefresh = () => {
    setRefreshCounter(prev => prev + 1);
  };
  
  const toggleDropletSelection = (dropletId) => {
    setSelectedIds(prev =>
      prev.includes(dropletId)
        ? prev.filter(id => id !== dropletId)
        : prev.length < MAX_SELECTED_DROPLETS ? [...prev, dropletId] : prev
    );
  };

  const toggleSelectAll = (droplets) => {
    const visibleIds = droplets.map(droplet => droplet.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.includes(id));

    if (allSelected) {
      setSelectedIds(prev => prev.filter(id => !visibleIds.includes(id)));
    } else {
      setSelectedIds(prev => [...new Set([...prev, ...visibleIds])].slice(0, MAX_SELECTED_DROPLETS));
    }
  };

  const openDetails = (dropletIds) => {
    navigate(`/droplets/details?ids=${dropletIds.join(',')}`);
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };
  
  const getSortedDroplets = (droplets) => {
    if (!sortField) return droplets;
    
    return [...droplets].sort((a, b) => {
      let aValue, bValue;
      
      switch (sortField) {
        case 'rate':
          aValue = a.hourly_price;
          bValue = b.hourly_price;
          break;
        case 'projectedCost':
          aValue = a.projected_cost;
          bValue = b.projected_cost;
          break;
        case 'fullMonthCost':
          aValue = a.full_month_cost;
          bValue = b.full_month_cost;
          break;
        default:
          return 0;
      }
      
      if (sortDirection === 'asc') {
        return aValue - bValue;
      } else {
        return bValue - aValue;
      }
    });
  };
  
  const SortIcon = ({ field }) => {
    if (sortField !== field) {
      return (
        <svg className="w-4 h-4 ml-1 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      );
    }
    
    return sortDirection === 'asc' ? (
      <svg className="w-4 h-4 ml-1 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      </svg>
    ) : (
      <svg className="w-4 h-4 ml-1 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    );
  };
  
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };
  
  const getFilteredDroplets = () => {
    if (!dropletData || !dropletData.droplets) return [];
    
    let filtered = dropletData.droplets;
    
    // Search: every word must appear in the droplet's name, project, region, tags, slug or ID
    const words = searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length > 0) {
      filtered = filtered.filter(droplet => {
        const text = [
          droplet.name,
          droplet.id,
          droplet.project?.name,
          droplet.region,
          droplet.regionName,
          droplet.size,
          ...(droplet.tags || [])
        ].filter(Boolean).join(' ').toLowerCase();
        return words.every(word => text.includes(word));
      });
    }
    
    // Within a filter any selected value matches; across filters all must match
    if (selectedRegions.length > 0) {
      filtered = filtered.filter(droplet => selectedRegions.includes(droplet.region));
    }
    
    if (selectedTags.length > 0) {
      filtered = filtered.filter(droplet =>
        droplet.tags && droplet.tags.some(tag => selectedTags.includes(tag))
      );
    }
    
    if (selectedSlugs.length > 0) {
      filtered = filtered.filter(droplet => selectedSlugs.includes(droplet.size));
    }

    if (selectedProjects.length > 0) {
      filtered = filtered.filter(droplet =>
        selectedProjects.includes(droplet.project ? droplet.project.id : 'none')
      );
    }

    // Exclude DOKS worker nodes if option is enabled
    if (excludeK8sWorkers) {
      filtered = filtered.filter(droplet => 
        !droplet.tags || !droplet.tags.includes('k8s:worker')
      );
    }
    
    return filtered;
  };
  
  const getRegionOptions = () => {
    if (!dropletData || !dropletData.regionSummary) return [];
    
    return Object.entries(dropletData.regionSummary).map(([regionSlug, data]) => ({
      slug: regionSlug,
      name: data.regionName,
      count: data.count,
      cost: data.totalCost,
      fullMonthCost: data.fullMonthCost
    }));
  };
  
  const getTagOptions = () => {
    if (!dropletData || !dropletData.tagSummary) return [];
    
    return Object.entries(dropletData.tagSummary).map(([tag, data]) => ({
      name: tag,
      count: data.count,
      cost: data.totalCost,
      fullMonthCost: data.fullMonthCost
    }));
  };
  
  const getProjectOptions = () => {
    if (!dropletData || !dropletData.projectSummary) return [];

    return Object.entries(dropletData.projectSummary)
      .map(([projectId, data]) => ({
        id: projectId,
        name: data.name,
        count: data.count,
        cost: data.totalCost
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  const getSlugOptions = () => {
    if (!dropletData || !dropletData.droplets) return [];
    
    const slugCounts = {};
    const slugCosts = {};
    const slugFullMonthCosts = {};
    
    dropletData.droplets.forEach(droplet => {
      if (!slugCounts[droplet.size]) {
        slugCounts[droplet.size] = 0;
        slugCosts[droplet.size] = 0;
        slugFullMonthCosts[droplet.size] = 0;
      }
      slugCounts[droplet.size]++;
      slugCosts[droplet.size] += droplet.projected_cost;
      slugFullMonthCosts[droplet.size] += droplet.full_month_cost;
    });
    
    return Object.entries(slugCounts).map(([slug, count]) => ({
      slug: slug,
      count: count,
      cost: slugCosts[slug],
      fullMonthCost: slugFullMonthCosts[slug]
    }));
  };
  
  const getK8sWorkerCount = () => {
    if (!dropletData || !dropletData.droplets) return 0;
    
    return dropletData.droplets.filter(droplet => 
      droplet.tags && droplet.tags.includes('k8s:worker')
    ).length;
  };
  
  const getK8sWorkerCost = () => {
    if (!dropletData || !dropletData.droplets) return 0;
    
    return dropletData.droplets
      .filter(droplet => droplet.tags && droplet.tags.includes('k8s:worker'))
      .reduce((sum, droplet) => sum + droplet.projected_cost, 0);
  };
  
  const filteredDroplets = getSortedDroplets(getFilteredDroplets());
  const regionOptions = getRegionOptions();
  const tagOptions = getTagOptions();
  const slugOptions = getSlugOptions();
  const projectOptions = getProjectOptions();
  const filteredCost = filteredDroplets.reduce((sum, droplet) => sum + droplet.projected_cost, 0);
  const filteredHourlyRate = filteredDroplets.reduce((sum, droplet) => sum + droplet.hourly_price, 0);
  const isFiltered = hasActiveFilters || excludeK8sWorkers;
  const filteredFullMonthCost = filteredDroplets.reduce((sum, droplet) => sum + droplet.full_month_cost, 0);
  const k8sWorkerCount = getK8sWorkerCount();
  const k8sWorkerCost = getK8sWorkerCost();
  
  const exportFilename = () => `droplet-costs_${new Date().toISOString().slice(0, 10)}`;
  
  // Exports exactly the droplets the current filters show
  const exportExcel = () => exportSheetsToExcel([{
    name: 'Droplet Costs',
    columns: [
      { header: 'Name', key: 'name', width: 32 },
      { header: 'Project', key: 'project', width: 22 },
      { header: 'Region', key: 'region', width: 16 },
      { header: 'Tags', key: 'tags', width: 30 },
      { header: 'Slug', key: 'size', width: 16 },
      { header: 'vCPUs', key: 'vcpus', width: 8 },
      { header: 'Memory (GB)', key: 'memory', width: 12 },
      { header: 'Disk (GB)', key: 'disk', width: 10 },
      { header: 'Created', key: 'created', width: 14 },
      { header: 'Rate / Hour', key: 'hourly', width: 12, currency: true },
      { header: 'Projected Cost', key: 'projected', width: 15, currency: true },
      { header: 'Full Month Cost', key: 'fullMonth', width: 15, currency: true }
    ],
    rows: filteredDroplets.map(droplet => ({
      name: droplet.name,
      project: droplet.project?.name || '',
      region: droplet.regionName,
      tags: (droplet.tags || []).join(', '),
      size: droplet.size,
      vcpus: droplet.vcpus,
      memory: droplet.memory / 1024,
      disk: droplet.disk,
      created: new Date(droplet.created_at),
      hourly: droplet.hourly_price,
      projected: droplet.projected_cost,
      fullMonth: droplet.full_month_cost
    })),
    totalRow: { name: `Total (${filteredDroplets.length} droplets)`, projected: filteredCost, fullMonth: filteredFullMonthCost }
  }], exportFilename());
  
  // Tooltip components
  const Tooltip = ({ children, tooltip, wide, position = 'top' }) => (
    <div className="relative flex items-center group">
      {children}
      <div className={`hidden sm:block absolute max-w-[calc(100vw-2rem)] ${position === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'} left-1/2 transform -translate-x-1/2 px-3 py-2 bg-gray-800 text-white text-sm rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-[100] ${wide ? 'w-[19rem]' : 'w-64'}`}>
        {tooltip}
      </div>
    </div>
  );
  
  return (
    <div ref={reportRef} className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-8">
      <div className="flex flex-wrap justify-between items-center gap-2 mb-6">
        <h2 className="text-xl font-semibold text-gray-800">Live Droplet Costs</h2>
        <button
          data-html2canvas-ignore="true"
          onClick={handleManualRefresh}
          className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
          disabled={loading}
        >
          {loading ? 'Refreshing...' : 'Refresh Data'}
        </button>
      </div>
      
      {error && (
        <div className="mb-6 p-4 bg-red-100 text-red-700 rounded-md">
          {error}
        </div>
      )}
      
      {loading ? (
        <div className="flex justify-center items-center h-64">
          <svg className="animate-spin h-10 w-10 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
      ) : dropletData ? (
        <>
          {/* Cards always describe the droplets the filters currently show, so the page and its PDF match */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
            <div className="bg-blue-50 p-4 rounded-lg">
              <p className="text-sm text-blue-700 mb-1">{isFiltered ? 'Droplets Shown' : 'Total Droplets'}</p>
              <p className="text-xl sm:text-2xl font-bold text-blue-900">{filteredDroplets.length}</p>
              {isFiltered && <p className="text-xs text-blue-700 mt-1">of {dropletData.count} total</p>}
            </div>
            <div className="bg-green-50 p-4 rounded-lg">
              <Tooltip tooltip="Cost projected for the remainder of the current month based on hourly rates, accounting for droplet creation dates." wide={true}>
                <p className="text-sm text-green-700 mb-1 cursor-help">
                  Projected Cost <span className="text-xs">ⓘ</span>
                </p>
              </Tooltip>
              <p className="text-xl sm:text-2xl font-bold text-green-900">{formatCurrency(filteredCost)}</p>
              {isFiltered && <p className="text-xs text-green-700 mt-1">of {formatCurrency(dropletData.totalCost)} total</p>}
            </div>
            <div className="bg-indigo-50 p-4 rounded-lg">
              <Tooltip tooltip="Cost if these droplets were to run for a full month (672 hours) at their hourly rates, which is how DigitalOcean caps monthly billing." wide={true}>
                <p className="text-sm text-indigo-700 mb-1 cursor-help">
                  Full Month Cost <span className="text-xs">ⓘ</span>
                </p>
              </Tooltip>
              <p className="text-xl sm:text-2xl font-bold text-indigo-900">{formatCurrency(filteredFullMonthCost)}</p>
              {isFiltered && <p className="text-xs text-indigo-700 mt-1">of {formatCurrency(dropletData.totalFullMonthCost)} total</p>}
            </div>
            <div className="bg-purple-50 p-4 rounded-lg">
              <p className="text-sm text-purple-700 mb-1">Hourly Rate</p>
              <p className="text-xl sm:text-2xl font-bold text-purple-900">{formatCurrency(filteredHourlyRate)}/hr</p>
              <p className="text-xs text-purple-700 mt-1">{isFiltered ? 'for the droplets shown' : 'for all droplets'}</p>
            </div>
          </div>
          
          <div className="mb-6">
            <div className="flex items-center mb-4">
              <input
                id="exclude-k8s-workers"
                type="checkbox"
                checked={excludeK8sWorkers}
                onChange={handleExcludeK8sWorkersChange}
                className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label htmlFor="exclude-k8s-workers" className="ml-2 block text-sm text-gray-900">
                Exclude DOKS worker nodes ({k8sWorkerCount} nodes, {formatCurrency(k8sWorkerCost)})
              </label>
            </div>
            
            <div className="relative mb-4">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
              </svg>
              <input
                ref={searchRef}
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setSearchQuery(''); }}
                placeholder="Search droplets by name, project, region, tag, slug or ID..."
                className="block w-full pl-10 pr-12 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                aria-label="Search droplets"
              />
              <kbd className="hidden sm:block absolute right-3 top-1/2 -translate-y-1/2 px-2 py-0.5 text-xs text-gray-500 border border-gray-300 rounded bg-gray-50" data-html2canvas-ignore="true">/</kbd>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label htmlFor="project-select" className="block text-sm font-medium text-gray-700 mb-2">
                  Filter by Project
                </label>
                <MultiSelect
                  id="project-select"
                  allLabel="All Projects"
                  selected={selectedProjects}
                  onChange={setSelectedProjects}
                  options={projectOptions.map(project => ({
                    value: project.id,
                    label: project.name,
                    hint: `${project.count} droplets · ${formatCurrency(project.cost)}`
                  }))}
                />
              </div>

              <div>
                <label htmlFor="region-select" className="block text-sm font-medium text-gray-700 mb-2">
                  Filter by Region
                </label>
                <MultiSelect
                  id="region-select"
                  allLabel="All Regions"
                  selected={selectedRegions}
                  onChange={setSelectedRegions}
                  options={regionOptions.map(region => ({
                    value: region.slug,
                    label: region.name,
                    hint: `${region.count} droplets · ${formatCurrency(region.cost)}`
                  }))}
                />
              </div>
              
              <div>
                <label htmlFor="tag-select" className="block text-sm font-medium text-gray-700 mb-2">
                  Filter by Tag
                </label>
                <MultiSelect
                  id="tag-select"
                  allLabel="All Tags"
                  selected={selectedTags}
                  onChange={setSelectedTags}
                  options={tagOptions.map(tag => ({
                    value: tag.name,
                    label: tag.name,
                    hint: `${tag.count} droplets · ${formatCurrency(tag.cost)}`
                  }))}
                />
              </div>
              
              <div>
                <label htmlFor="slug-select" className="block text-sm font-medium text-gray-700 mb-2">
                  Filter by Slug
                </label>
                <MultiSelect
                  id="slug-select"
                  allLabel="All Slugs"
                  selected={selectedSlugs}
                  onChange={setSelectedSlugs}
                  options={slugOptions.map(slug => ({
                    value: slug.slug,
                    label: slug.slug,
                    hint: `${slug.count} droplets · ${formatCurrency(slug.cost)}`
                  }))}
                />
              </div>
            </div>
            
            {hasActiveFilters && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-gray-600">
                <span>Showing {filteredDroplets.length} of {dropletData.count} droplets</span>
                <button type="button" onClick={clearAllFilters} className="text-blue-600 hover:underline" data-html2canvas-ignore="true">
                  Clear all filters
                </button>
              </div>
            )}
          </div>
          
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <p className="text-sm text-gray-600">
              {selectedIds.length > 0
                ? `${selectedIds.length} droplet${selectedIds.length > 1 ? 's' : ''} selected`
                : 'Select droplets to view their monthly cost history together'}
              {selectedIds.length >= MAX_SELECTED_DROPLETS && ` (max ${MAX_SELECTED_DROPLETS})`}
            </p>
            <div className="flex flex-wrap gap-2">
              <ExportButtons
                onExcel={exportExcel}
                pdfTarget={reportRef}
                filename={exportFilename}
                disabled={filteredDroplets.length === 0}
              />
              {selectedIds.length > 0 && (
                <button
                  data-html2canvas-ignore="true"
                  onClick={() => setSelectedIds([])}
                  className="px-3 py-1 text-sm text-gray-700 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                >
                  Clear
                </button>
              )}
              <button
                data-html2canvas-ignore="true"
                onClick={() => openDetails(selectedIds)}
                disabled={selectedIds.length === 0}
                className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                View Details{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] divide-y divide-gray-200 table-fixed">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-3 py-2 w-8">
                    <input
                      type="checkbox"
                      aria-label="Select all droplets"
                      checked={filteredDroplets.length > 0 && filteredDroplets.every(droplet => selectedIds.includes(droplet.id))}
                      onChange={() => toggleSelectAll(filteredDroplets)}
                      className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                  </th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/5">Name</th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/12">Region</th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/6">Tags</th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/12">
                    <Tooltip tooltip={<>Droplet size slug. <a href="https://slugs.do-api.dev/" target="_blank" rel="noopener noreferrer" className="text-blue-300 underline">View all slugs info</a></>} position="bottom">
                      <span className="cursor-help">Slug <span className="text-xs">ⓘ</span></span>
                    </Tooltip>
                  </th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/12">Created</th>
                  <th 
                    scope="col" 
                    className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/12 cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('rate')}
                  >
                    <div className="flex items-center">
                      Rate
                      <SortIcon field="rate" />
                    </div>
                  </th>
                  <th 
                    scope="col" 
                    className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/12 cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('projectedCost')}
                  >
                    <div className="flex items-center">
                      Projected Cost
                      <SortIcon field="projectedCost" />
                    </div>
                  </th>
                  <th 
                    scope="col" 
                    className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/12 cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('fullMonthCost')}
                  >
                    <div className="flex items-center">
                      Full Month Cost
                      <SortIcon field="fullMonthCost" />
                    </div>
                  </th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/12">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredDroplets.map((droplet) => (
                  <tr key={droplet.id} className={selectedIds.includes(droplet.id) ? 'bg-blue-50' : undefined}>
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${droplet.name}`}
                        checked={selectedIds.includes(droplet.id)}
                        onChange={() => toggleDropletSelection(droplet.id)}
                        className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-3 py-3 text-sm font-medium text-gray-900 truncate max-w-xs">
                      {droplet.name}
                      {droplet.project && (
                        <div className="text-xs font-normal text-gray-500 truncate">{droplet.project.name}</div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-500">{droplet.regionName}</td>
                    <td className="px-3 py-3 text-sm text-gray-500">
                      {droplet.tags && droplet.tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {droplet.tags.map(tag => {
                            // Check if tag is a k8s UUID tag
                            const isK8sUuidTag = tag.match(/^k8s:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
                            
                            if (isK8sUuidTag) {
                              // Truncate the UUID part
                              const shortTag = tag.substring(0, 8) + '...';
                              return (
                                <Tooltip key={tag} tooltip={tag} wide={true}>
                                  <span className="inline-flex items-center px-1 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 cursor-help">
                                    {shortTag}
                                  </span>
                                </Tooltip>
                              );
                            }
                            
                            return (
                              <span key={tag} className="inline-flex items-center px-1 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                {tag}
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        <span className="text-gray-400">None</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-500">
                      {droplet.size}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-500">
                      {new Date(droplet.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-500">
                      {formatCurrency(droplet.hourly_price)}/hr
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-900">
                      {formatCurrency(droplet.projected_cost)}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-900">
                      {formatCurrency(droplet.full_month_cost)}
                    </td>
                    <td className="px-3 py-3 text-sm">
                      <Link
                        to={`/droplets/details?ids=${droplet.id}`}
                        className="px-2 py-1 bg-blue-50 text-blue-700 rounded hover:bg-blue-100 transition-colors whitespace-nowrap"
                      >
                        Details
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          <div className="mt-4 text-right text-xs text-gray-500">
            Last updated: {new Date().toLocaleTimeString()}
          </div>
        </>
      ) : (
        <div className="text-center py-8">
          <p className="text-gray-600">No droplet data available.</p>
        </div>
      )}
    </div>
  );
};

export default LiveDropletCosts; 