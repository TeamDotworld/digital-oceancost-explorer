import React, { useState, useEffect, useRef } from 'react';
import { invoiceService } from '../services/api';
import CostBreakdown from './CostBreakdown';
import Footer from './Footer';
import Papa from 'papaparse';

const Dashboard = () => {
  const [billingPeriods, setBillingPeriods] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState(null);
  const [loading, setLoading] = useState(true);
  const [invoiceData, setInvoiceData] = useState(null);
  const [error, setError] = useState(null);
  const reportRef = useRef(null);
  
  useEffect(() => {
    const fetchBillingPeriods = async () => {
      try {
        const periods = await invoiceService.getBillingPeriods();
        setBillingPeriods(periods);
        
        // Select the most recent period by default
        if (periods.length > 0) {
          setSelectedPeriod(periods[0].id);
        }
        
        setLoading(false);
      } catch (error) {
        console.error('Error fetching billing periods:', error);
        setError('Failed to load billing periods. Please try again.');
        setLoading(false);
      }
    };
    
    fetchBillingPeriods();
  }, []);
  
  useEffect(() => {
    const fetchInvoiceData = async () => {
      if (!selectedPeriod) return;
      
      setLoading(true);
      setError(null);
      
      try {
        const csvData = await invoiceService.getInvoiceData(selectedPeriod);
        
        // Parse CSV data
        Papa.parse(csvData, {
          header: true,
          dynamicTyping: true,
          skipEmptyLines: true,
          complete: (results) => {
            console.log('CSV parsing complete. First row:', results.data[0]);
            
            // Check if we have valid data
            if (results.data.length === 0 || !results.data[0]) {
              setError('The invoice data appears to be empty or invalid.');
              setLoading(false);
              return;
            }
            
            // Check required fields
            const requiredFields = ['product', 'start', 'end', 'USD'];
            const missingFields = requiredFields.filter(field => 
              !results.meta.fields.includes(field)
            );
            
            if (missingFields.length > 0) {
              console.warn('Warning: Some expected fields are missing:', missingFields);
              console.log('Available fields:', results.meta.fields);
            }
            
            setInvoiceData(results.data);
            setLoading(false);
          },
          error: (error) => {
            console.error('Error parsing CSV:', error);
            setError('Failed to parse invoice data: ' + error.message);
            setLoading(false);
          }
        });
      } catch (error) {
        console.error('Error fetching invoice data:', error);
        setError('Failed to load invoice data. Please try again.');
        setLoading(false);
      }
    };
    
    fetchInvoiceData();
  }, [selectedPeriod]);
  
  const handlePeriodChange = (e) => {
    setSelectedPeriod(e.target.value);
  };
  
  return (
    <div className="flex flex-col min-h-screen">
      <div ref={reportRef} className="flex-grow w-full min-w-0 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-2 sm:mb-4">DigitalOcean Historical Costs</h1>
          <p className="text-gray-600">View and analyze your DigitalOcean costs by service type and billing period</p>
        </div>
        
        {error && (
          <div className="mb-6 p-4 bg-red-100 text-red-700 rounded-md">
            {error}
          </div>
        )}
        
        <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-8">
          <div className="mb-4">
            <label htmlFor="period-select" className="block text-sm font-medium text-gray-700 mb-2">
              Select Billing Period
            </label>
            
            {loading && !selectedPeriod ? (
              <div className="animate-pulse h-10 bg-gray-200 rounded w-full"></div>
            ) : (
              <select
                id="period-select"
                value={selectedPeriod || ''}
                onChange={handlePeriodChange}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                disabled={loading || billingPeriods.length === 0}
              >
                {billingPeriods.length === 0 ? (
                  <option value="">No billing periods available</option>
                ) : (
                  billingPeriods.map((period) => (
                    <option key={period.id} value={period.id}>
                      {period.description} - ${period.amount || '0.00'}
                      {period.status === 'PENDING' ? ' (Pending)' : ''}
                    </option>
                  ))
                )}
              </select>
            )}
          </div>
        </div>
        
        {loading && selectedPeriod ? (
          <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
            <div className="flex justify-center items-center h-64">
              <svg className="animate-spin h-10 w-10 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
          </div>
        ) : invoiceData && invoiceData.length > 0 ? (
          <CostBreakdown
            invoiceData={invoiceData}
            reportRef={reportRef}
            periodLabel={billingPeriods.find(period => String(period.id) === String(selectedPeriod))?.period}
          />
        ) : selectedPeriod && !loading ? (
          <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 text-center">
            <p className="text-gray-600">No invoice data available for this period.</p>
          </div>
        ) : null}
      </div>
      
      <Footer />
    </div>
  );
};

export default Dashboard;