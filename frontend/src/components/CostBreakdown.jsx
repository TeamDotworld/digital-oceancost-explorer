import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { exportSheetsToExcel } from '../utils/excelExport';
import ExportButtons from './ExportButtons';

// Safe date parsing function to handle cross-browser compatibility
function safeParseDate(dateString) {
  if (!dateString) return null;
  
  // Try standard parsing first
  const date = new Date(dateString);
  if (!isNaN(date.getTime())) return date;
  
  // If that fails, try more specific formats
  try {
    // For format like "2025-04-01 00:00:00 +0000"
    if (typeof dateString === 'string') {
      // Replace space with T and standardize timezone for better browser compatibility
      const dateWithT = dateString.replace(' ', 'T');
      const newDate = new Date(dateWithT);
      if (!isNaN(newDate.getTime())) return newDate;
      
      // Try with explicit timezone handling
      const cleanedDate = dateString.replace(/(\+\d{4})$/, 'Z');
      const dateWithTZ = cleanedDate.replace(' ', 'T');
      const tzDate = new Date(dateWithTZ);
      if (!isNaN(tzDate.getTime())) return tzDate;
      
      // If still failing, try more aggressive approach - just use the date part
      const parts = dateString.split(' ');
      if (parts.length >= 2) {
        const [year, month, day] = parts[0].split('-').map(Number);
        // JS months are 0-indexed
        return new Date(year, month - 1, day);
      }
    }
  } catch (e) {
    console.error('Error in safeParseDate:', e);
  }
  
  return null;
}

const CostBreakdown = ({ invoiceData, reportRef, periodLabel }) => {
  const [chartData, setChartData] = useState([]);
  const [serviceTypes, setServiceTypes] = useState([]);
  const [totalCosts, setTotalCosts] = useState({});
  
  useEffect(() => {
    if (!invoiceData || invoiceData.length === 0) return;
    
    // Define service types to exclude
    const excludedServiceTypes = [
      "Premier Support Subscription", 
      "Discounts", 
      "Commitment Deal Surcharge"
    ];
    
    // Filter out excluded service types
    const filteredData = invoiceData.filter(row => 
      !excludedServiceTypes.includes(row.product) && row.product // Make sure product exists
    );
    
    // Process the data for the chart
    const dailyCosts = processDailyServiceCosts(filteredData);
    
    // Extract unique service types
    const uniqueServiceTypes = new Set();
    filteredData.forEach(row => {
      if (row.product) uniqueServiceTypes.add(row.product);
    });
    const serviceTypesArray = Array.from(uniqueServiceTypes);
    
    // Convert the daily costs object to an array for the chart
    const processedChartData = Object.keys(dailyCosts).map(date => {
      const entry = { date };
      
      // Add cost for each service type
      serviceTypesArray.forEach(serviceType => {
        entry[serviceType] = dailyCosts[date][serviceType] || 0;
      });
      
      // Calculate total for the day
      entry.total = serviceTypesArray.reduce(
        (sum, type) => sum + (dailyCosts[date][type] || 0), 
        0
      );
      
      return entry;
    });
    
    // Sort the chart data by date
    processedChartData.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // Calculate total costs by service type
    const calculatedTotalCosts = {};
    serviceTypesArray.forEach(type => {
      calculatedTotalCosts[type] = processedChartData.reduce(
        (sum, item) => sum + (item[type] || 0), 
        0
      );
    });
    
    // Ensure total cost is calculated properly
    calculatedTotalCosts.total = serviceTypesArray.reduce(
      (sum, type) => sum + (calculatedTotalCosts[type] || 0),
      0
    );
    
    setChartData(processedChartData);
    setServiceTypes(serviceTypesArray);
    setTotalCosts(calculatedTotalCosts);
  }, [invoiceData]);
  
  // Function to process data into daily costs by service type
  function processDailyServiceCosts(data) {
    const dailyCosts = {};
    
    // Define service types to exclude
    const excludedServiceTypes = [
      "Premier Support Subscription", 
      "Discounts", 
      "Commitment Deal Surcharge"
    ];
    
    data.forEach(row => {
      if (!row.start || !row.end || !row.USD || excludedServiceTypes.includes(row.product)) {
        return;
      }
      
      // Parse start and end dates using the safe date parsing function
      let startDate, endDate;
      try {
        startDate = safeParseDate(row.start);
        endDate = safeParseDate(row.end);
        
        // Skip if invalid dates
        if (!startDate || !endDate) {
          console.warn('Skipping row with invalid dates:', row);
          return;
        }
      } catch (error) {
        console.warn('Error parsing dates:', error, row);
        return;
      }
      
      // Calculate number of days in the period (ensure at least 1 day)
      const dayDiff = Math.max(1, Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)));
      
      // Parse USD amount (remove $ and convert to number)
      let totalCost = 0;
      try {
        totalCost = parseFloat(String(row.USD).replace(/[$,]/g, '')) || 0;
      } catch (error) {
        console.warn('Error parsing USD value:', error, row);
      }
      
      // Calculate cost per day
      const costPerDay = totalCost / dayDiff;
      
      // Get service type
      const serviceType = row.product || 'Unknown';
      
      // Iterate through each day in the period
      let currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        const dateKey = currentDate.toISOString().split('T')[0];
        
        if (!dailyCosts[dateKey]) {
          dailyCosts[dateKey] = {};
        }
        
        if (!dailyCosts[dateKey][serviceType]) {
          dailyCosts[dateKey][serviceType] = 0;
        }
        
        dailyCosts[dateKey][serviceType] += costPerDay;
        
        // Move to next day
        currentDate.setDate(currentDate.getDate() + 1);
      }
    });
    
    return dailyCosts;
  }
  
  // Define colors for different service types
  const COLORS = [
    '#8884d8', '#82ca9d', '#ffc658', '#ff8042', '#a4de6c',
    '#d0ed57', '#83a6ed', '#8dd1e1', '#a4262c', '#ec407a'
  ];

  // Safe formatter function for numbers
  const formatCurrency = (value) => {
    if (value === undefined || value === null) return '$0.00';
    return `$${Number(value).toFixed(2)}`;
  };
  
  // Safe percentage calculator
  const calculatePercentage = (value, total) => {
    if (!value || !total || total === 0) return '0.0';
    return ((value / total) * 100).toFixed(1);
  };
  
  const exportFilename = () => `historical-costs_${(periodLabel || 'period').replace(/[^\w.-]+/g, '_')}`;
  
  // Summary by service plus the full daily table, matching what the page shows
  const exportExcel = () => exportSheetsToExcel([
    {
      name: 'Summary by Service',
      columns: [
        { header: 'Service Type', key: 'service', width: 32 },
        { header: 'Total Cost', key: 'total', width: 14, currency: true },
        { header: 'Percentage', key: 'percent', width: 12 }
      ],
      rows: serviceTypes.map(type => ({
        service: type,
        total: totalCosts[type],
        percent: `${calculatePercentage(totalCosts[type], totalCosts.total)}%`
      })),
      totalRow: { service: 'Total', total: totalCosts.total, percent: '100%' }
    },
    {
      name: 'Daily Costs',
      columns: [
        { header: 'Date', key: 'date', width: 14 },
        ...serviceTypes.map(type => ({ header: type, key: type, width: 16, currency: true })),
        { header: 'Total', key: 'total', width: 14, currency: true }
      ],
      rows: chartData,
      totalRow: { date: 'Total', ...totalCosts }
    }
  ], exportFilename());
  
  // If no data, show message
  if (chartData.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 text-center">
        <p className="text-gray-600">No cost data to display. This could be because there are no billable services in this period, or all services have been filtered out.</p>
      </div>
    );
  }
  
  return (
    <div>
      {reportRef && (
        <div className="flex justify-end mb-4">
          <ExportButtons onExcel={exportExcel} pdfTarget={reportRef} filename={exportFilename} />
        </div>
      )}
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Daily Costs by Service Type</h2>
        <p className="mb-4 text-gray-600">Excluding Premier Support Subscription, Discounts, and Commitment Deal Surcharge</p>
        <div className="bg-white p-4 rounded-lg shadow">
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 70 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="date" 
                angle={-45} 
                textAnchor="end" 
                height={70}
                tick={{ fontSize: 12 }}
              />
              <YAxis 
                label={{ value: 'Cost (USD)', angle: -90, position: 'insideLeft' }} 
                tick={{ fontSize: 12 }}
              />
              <Tooltip 
                formatter={(value) => formatCurrency(value)}
                labelFormatter={(label) => `Date: ${label}`}
              />
              <Legend />
              {serviceTypes.map((serviceType, index) => (
                <Bar 
                  key={serviceType}
                  dataKey={serviceType}
                  stackId="a"
                  fill={COLORS[index % COLORS.length]}
                  name={serviceType}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      
      {/* Summary Table */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Summary by Service Type</h2>
        <div className="overflow-x-auto bg-white rounded-lg shadow">
          <table className="min-w-full">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-3 sm:px-6 py-3 text-left text-sm font-medium text-gray-700">Service Type</th>
                <th className="px-3 sm:px-6 py-3 text-right text-sm font-medium text-gray-700">Total Cost</th>
                <th className="px-3 sm:px-6 py-3 text-right text-sm font-medium text-gray-700">Percentage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {serviceTypes.map(type => (
                <tr key={type} className="hover:bg-gray-50">
                  <td className="px-3 sm:px-6 py-3 sm:py-4 text-sm text-gray-900">{type}</td>
                  <td className="px-3 sm:px-6 py-3 sm:py-4 text-sm text-right text-gray-900">
                    {formatCurrency(totalCosts[type])}
                  </td>
                  <td className="px-3 sm:px-6 py-3 sm:py-4 text-sm text-right text-gray-900">
                    {calculatePercentage(totalCosts[type], totalCosts.total)}%
                  </td>
                </tr>
              ))}
              <tr className="bg-gray-50 font-semibold">
                <td className="px-3 sm:px-6 py-3 sm:py-4 text-sm text-gray-900">Total</td>
                <td className="px-3 sm:px-6 py-3 sm:py-4 text-sm text-right text-gray-900">
                  {formatCurrency(totalCosts.total)}
                </td>
                <td className="px-3 sm:px-6 py-3 sm:py-4 text-sm text-right text-gray-900">100%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      
      {/* Daily Breakdown Table */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Daily Cost Details</h2>
        <div className="overflow-x-auto bg-white rounded-lg shadow">
          <table className="min-w-full">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-3 sm:px-6 py-3 text-left text-sm font-medium text-gray-700">Date</th>
                {serviceTypes.map(type => (
                  <th key={type} className="px-3 sm:px-6 py-3 text-right text-sm font-medium text-gray-700">
                    {type}
                  </th>
                ))}
                <th className="px-3 sm:px-6 py-3 text-right text-sm font-medium text-gray-700">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {chartData.map(day => (
                <tr key={day.date} className="hover:bg-gray-50">
                  <td className="px-3 sm:px-6 py-3 sm:py-4 text-sm text-gray-900">{day.date}</td>
                  {serviceTypes.map(type => (
                    <td key={type} className="px-3 sm:px-6 py-3 sm:py-4 text-sm text-right text-gray-900">
                      {formatCurrency(day[type])}
                    </td>
                  ))}
                  <td className="px-3 sm:px-6 py-3 sm:py-4 text-sm text-right font-semibold text-gray-900">
                    {formatCurrency(day.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default CostBreakdown;